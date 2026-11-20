import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError } from '@punyts/stateui-mcp';
import type { ToolOutcome, UiToolDefinition } from '@punyts/stateui-mcp';
import type { AgentTokens } from '../accounts/AgentTokens.js';
import { isAgentAsk } from '../accounts/AgentTokens.js';
import type { User } from '../accounts/Accounts.js';
import { Sessions } from '../accounts/Sessions.js';
import { fill, textsOf } from '../http/text.js';
import { languageOf } from '../prefs/Preferences.js';

/** The one button of a sign-in page: a device link's "Continue as", or allowing an agent */
export interface SignInButton {
    readonly id: string;
    readonly label: string;
    /** Posts `token` (the id) and `next` here */
    readonly post?: string;
    /** Or goes here, `{id}` filled in */
    readonly go?: string;
    /** Shown above the button */
    readonly notice?: string;
}

/** The tools an agent works with in a person's workspace, and the instructions that go with them */
export interface AgentWorkspace {
    readonly tools: readonly UiToolDefinition[];
    readonly instructions: string;
    readonly release: () => void;
}

export interface AgentRouteContext {
    readonly tokens: AgentTokens;
    readonly signedIn: (request: IncomingMessage) => Promise<{ readonly user: User; readonly token: string } | undefined>;
    readonly signInPage: (request: IncomingMessage, next: string, error?: string, button?: SignInButton) => Promise<string>;
    readonly sendAppPage: (request: IncomingMessage, response: ServerResponse, html: string, status?: number) => void;
    readonly readForm: (request: IncomingMessage) => Promise<URLSearchParams>;
    readonly readJson: (request: IncomingMessage) => Promise<unknown>;
    readonly sendJson: (response: ServerResponse, status: number, body: unknown) => void;
    readonly redirect: (response: ServerResponse, location: string) => void;
    readonly report: (message: string, fields?: Record<string, unknown>) => void;
    /** Opens the person's own workspace for an agent, or says why it may not work there */
    readonly workspace: (userId: string) => Promise<AgentWorkspace | { readonly refused: string }>;
}

/** A bearer token in `Authorization` */
function bearerOf(request: IncomingMessage): string | undefined {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? '');
    return match?.[1];
}

/**
 * An agent signed in as a person (docs/design/statenet-network.md, S10b): a standalone stateui-mcp asks in the
 * person's browser and then runs the StateUI tools here, in the person's own workspace, as them.
 *
 * - `GET /agent/authorize`: the authorization code flow's ask (`response_type=code`, `code_challenge` with
 *   `code_challenge_method=S256`, a loopback `redirect_uri`, `state`). Signed in, the person sees what the agent asks
 *   and one button.
 * - `GET /agent/allow/<id>`: the button. It sends the browser to the agent's loopback address with the code. A
 *   navigation, not a post: the page's policy lets its script reach only this server. The id is secret, made for
 *   this page and this session, so no other page can allow it.
 * - `POST /agent/token`: trades a code (with `code_verifier`) or a refresh token for an access token and a refresh token.
 * - `GET /agent/tools` and `POST /agent/call` (`{ name, arguments }`), with `Authorization: Bearer <access token>`.
 *
 * Answers true when it handled the request
 */
export function agentRoutes(context: AgentRouteContext) {
    const { tokens } = context;

    /** The person a bearer token acts as, or a 401 answered */
    async function agentOf(request: IncomingMessage, response: ServerResponse): Promise<string | undefined> {
        const found = await tokens.find(bearerOf(request));
        if (found !== undefined) return found.userId;
        response.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
        context.sendJson(response, 401, { error: 'invalid_token', message: 'Sign in again' });
        return undefined;
    }

    async function authorize(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
        const params = url.searchParams;
        const ask = { redirectUri: params.get('redirect_uri') ?? '', challenge: params.get('code_challenge') ?? '', state: params.get('state') ?? '' };
        if (params.get('response_type') !== 'code' || params.get('code_challenge_method') !== 'S256' || !isAgentAsk(ask)) throw new HttpError(400, 'Not a sign-in request an agent may make', 'bad_request');
        const who = await context.signedIn(request);
        if (who === undefined) {
            context.redirect(response, `/signin?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
            return;
        }
        const t = textsOf(languageOf(request.headers['accept-language']));
        const id = await tokens.ask(who.user.id, Sessions.keyOf(who.token), ask);
        context.sendAppPage(request, response, await context.signInPage(request, '/', undefined, { id, label: fill(t['signin.agentAs'], { name: who.user.name }), go: '/agent/allow/{id}', notice: t['signin.agentText'] }));
    }

    async function allow(request: IncomingMessage, response: ServerResponse, id: string): Promise<void> {
        const who = await context.signedIn(request);
        const allowed = who === undefined ? undefined : await tokens.allow(id, Sessions.keyOf(who.token));
        if (who === undefined || allowed === undefined) {
            context.sendAppPage(request, response, await context.signInPage(request, '/', textsOf(languageOf(request.headers['accept-language']))['signin.agentUsed']), 400);
            return;
        }
        context.report('Allowed an agent', { userId: who.user.id });
        const target = new URL(allowed.redirectUri);
        target.searchParams.set('code', allowed.code);
        target.searchParams.set('state', allowed.state);
        context.redirect(response, target.href);
    }

    async function token(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const form = await context.readForm(request);
        const grant = form.get('grant_type');
        const pair =
            grant === 'authorization_code'
                ? await tokens.exchange(form.get('code') ?? undefined, form.get('code_verifier') ?? undefined, form.get('redirect_uri') ?? undefined)
                : grant === 'refresh_token'
                  ? await tokens.refresh(form.get('refresh_token') ?? undefined)
                  : undefined;
        if (pair === undefined) {
            context.sendJson(response, 400, { error: grant === 'authorization_code' || grant === 'refresh_token' ? 'invalid_grant' : 'unsupported_grant_type' });
            return;
        }
        context.sendJson(response, 200, { access_token: pair.accessToken, refresh_token: pair.refreshToken, token_type: 'Bearer', expires_in: pair.expiresIn });
    }

    /** Runs one tool in the person's workspace, as their own agent's tools run there */
    async function call(userId: string, body: unknown): Promise<{ status: number; outcome: ToolOutcome }> {
        const name = typeof body === 'object' && body !== null ? (body as { name?: unknown }).name : undefined;
        const args = typeof body === 'object' && body !== null ? ((body as { arguments?: unknown }).arguments ?? {}) : undefined;
        if (typeof name !== 'string' || typeof args !== 'object' || args === null || Array.isArray(args)) return { status: 400, outcome: { isError: true, body: { error: 'bad-request', message: 'Send { name, arguments }' } } };
        const workspace = await context.workspace(userId);
        if ('refused' in workspace) return { status: 403, outcome: { isError: true, body: { error: 'forbidden', message: workspace.refused } } };
        try {
            const tool = workspace.tools.find((entry) => entry.name === name);
            if (tool === undefined) return { status: 200, outcome: { isError: true, body: { error: 'unknown-tool', message: `Unknown tool: ${name}` } } };
            let outcome: ToolOutcome;
            try {
                outcome = await tool.run(args as Record<string, unknown>);
            } catch (error) {
                outcome = { isError: true, body: { error: 'internal-error', message: error instanceof Error ? error.message : String(error) } };
            }
            // the person's agent, by tool and outcome: never the arguments or the answer
            context.report('Agent tool call', { userId, tool: name, ok: !outcome.isError });
            return { status: 200, outcome };
        } finally {
            workspace.release();
        }
    }

    return async (request: IncomingMessage, response: ServerResponse, method: string, path: string): Promise<boolean> => {
        if (!path.startsWith('/agent/')) return false;
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (method === 'GET' && path === '/agent/authorize') {
            await authorize(request, response, url);
            return true;
        }
        const allowMatch = /^\/agent\/allow\/([A-Za-z0-9_-]{43})$/.exec(path);
        if (method === 'GET' && allowMatch !== null) {
            await allow(request, response, allowMatch[1] as string);
            return true;
        }
        if (method === 'POST' && path === '/agent/token') {
            await token(request, response);
            return true;
        }
        if (method === 'GET' && path === '/agent/tools') {
            const userId = await agentOf(request, response);
            if (userId === undefined) return true;
            const workspace = await context.workspace(userId);
            if ('refused' in workspace) {
                context.sendJson(response, 403, { error: 'forbidden', message: workspace.refused });
                return true;
            }
            try {
                context.sendJson(response, 200, { instructions: workspace.instructions, tools: workspace.tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations })) });
            } finally {
                workspace.release();
            }
            return true;
        }
        if (method === 'POST' && path === '/agent/call') {
            const userId = await agentOf(request, response);
            if (userId === undefined) return true;
            const { status, outcome } = await call(userId, await context.readJson(request));
            context.sendJson(response, status, outcome);
            return true;
        }
        return false;
    };
}
