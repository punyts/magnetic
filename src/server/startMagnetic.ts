import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { COMMON_HEADERS, createServices, createStateUiTools, hostPageCsp, HttpError, installShowcase, loadCatalogFile, loadChunk3d, loadHostScript, loadRuntimeBundle, requestHostName, startHttpServer } from '@punyts/stateui-mcp';
import type { AppLogicLimits, HttpTenant, PreviewBrowser, Services, TenantAnswer, UiToolDefinition } from '@punyts/stateui-mcp';
import type { Report } from '@punyts/core';
import { Accounts } from '../accounts/Accounts.js';
import { ClaudeModel } from '../agent/AgentModel.js';
import type { AgentModel } from '../agent/AgentModel.js';
import { AgentTurns, CONTEXT_TOGGLES } from '../agent/AgentTurns.js';
import type { ContextToggle, TurnLimits } from '../agent/AgentTurns.js';
import { Budgets, DEFAULT_BUDGETS } from '../agent/Budgets.js';
import type { BudgetLimits } from '../agent/Budgets.js';
import { Chats } from '../agent/Chats.js';
import { agentSystemPrompt } from '../agent/instructions.js';
import { SHELL_CSS, SHELL_JS, shellPage } from '../http/shell.js';
import type { User } from '../accounts/Accounts.js';
import { Sessions, SESSION_DAYS } from '../accounts/Sessions.js';
import { OidcSignIn, safeNext, SignInError } from '../auth/OidcSignIn.js';
import type { OidcProvider } from '../auth/OidcSignIn.js';
import { httpOnlyCookie, readCookie, SESSION_COOKIE, sessionCookie, SIGN_IN_COOKIE } from '../http/cookies.js';
import { appsPage, MAGNETIC_CSS, MAGNETIC_PAGE_CSP, signInPage } from '../http/pages.js';
import { Workspaces } from '../workspaces/Workspaces.js';
import type { WorkspacesOptions } from '../workspaces/Workspaces.js';

/** The bounds on each app's logic when no others are given: other people's logic runs on this server */
export const DEFAULT_LOGIC_LIMITS: AppLogicLimits = { timerRunsPerSecond: 20 };
/** The text frames a view's socket may send per second when no other number is given */
export const DEFAULT_SOCKET_MESSAGES_PER_SECOND = 50;

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
const MAX_FORM_BYTES = 4096;
const MAX_TURN_BYTES = 16_384;
const MAX_REQUEST_CHARS = 4000;

/** The model of the agent when no other is given */
export const DEFAULT_AGENT_MODEL = 'claude-opus-5-5';
export type AgentEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface MagneticAgentOptions {
    /** Replaces the Claude API, for tests */
    readonly model?: AgentModel;
    /** Default `claude-opus-5-5` */
    readonly modelName?: string;
    /** Default `high` */
    readonly effort?: AgentEffort;
    /** Default $1 per user per day and $100 per month for the server */
    readonly budgets?: BudgetLimits;
    readonly limits?: TurnLimits;
}

export interface MagneticOptions {
    /** Where the accounts, the sessions and each user's workspace (`users/<userId>`) live */
    readonly dataDir: string;
    readonly host: string;
    /** 0 picks a free port */
    readonly port: number;
    /** The port of the runtime origin; default the next port (a free one when `port` is 0) */
    readonly runtimePort?: number;
    readonly report: Pick<Report, 'info'>;
    /**
     * Test users who sign in with a button and no provider, for development and tests. Only on a loopback host: a
     * server bound to any other address refuses to start with them
     */
    readonly devUsers?: readonly string[];
    /** What a new user's workspace starts with: the component showcase (default) or nothing */
    readonly starter?: 'showcase' | 'none';
    /** The folder of the built runtime bundle; default the one in `@punyts/stateui-app` */
    readonly runtimeDir?: string;
    /** The folder of the built 3D chunk; default the one in `@punyts/stateui-3d` when installed */
    readonly chunk3dDir?: string;
    /** Replaces each workspace's headless browser, for tests */
    readonly browser?: PreviewBrowser;
    readonly logicLimits?: AppLogicLimits;
    readonly socketMessagesPerSecond?: number;
    readonly workspaces?: WorkspacesOptions;
    /** Marks the cookies `Secure`; default on when `publicOrigin` is HTTPS */
    readonly secureCookies?: boolean;
    /** The OpenID Connect providers people sign in with, such as `linkedInProvider(id, secret)` */
    readonly providers?: readonly OidcProvider[];
    /**
     * The origin people reach the server at, such as `https://magnetic.example`; default the origin it listens on.
     * Each provider's redirect URI is `<publicOrigin>/auth/<name>/callback`
     */
    readonly publicOrigin?: string;
    /** Allows providers over plain HTTP, for a mock provider in tests. Loopback hosts only */
    readonly allowHttpProviders?: boolean;
    readonly agent?: MagneticAgentOptions;
}

export interface RunningMagnetic {
    readonly origin: string;
    readonly port: number;
    readonly runtimePort: number;
    readonly accounts: Accounts;
    readonly sessions: Sessions;
    readonly workspaces: Workspaces;
    readonly signIn: OidcSignIn;
    readonly turns: AgentTurns;
    readonly budgets: Budgets;
    /** Closes the server, the workspaces and their browsers. Safe to call twice */
    stop(): Promise<void>;
}

function redirect(response: ServerResponse, location: string, cookie?: string | string[]): void {
    response.writeHead(303, { ...COMMON_HEADERS, Location: location, 'Cache-Control': 'no-store', ...(cookie !== undefined && { 'Set-Cookie': cookie }) });
    response.end();
}

/**
 * Sends one of Magnetic's own pages. Their forms post to this server, and a browser sends `Origin: null` with a form
 * post from a page whose referrer policy is `no-referrer`, which the same-origin check refuses: these pages send their
 * origin to themselves only (`same-origin`)
 */
function sendPage(response: ServerResponse, html: string, status = 200, cookie?: string): void {
    response.writeHead(status, {
        ...(cookie !== undefined && { 'Set-Cookie': cookie }),
        ...COMMON_HEADERS,
        'Referrer-Policy': 'same-origin',
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': MAGNETIC_PAGE_CSP,
        'Cache-Control': 'no-store'
    });
    response.end(html);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { ...COMMON_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
}

function sendAsset(response: ServerResponse, type: string, body: string): void {
    response.writeHead(200, { ...COMMON_HEADERS, 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-cache' });
    response.end(body);
}

/** A small JSON body */
async function readJsonBody(request: IncomingMessage, limit: number): Promise<unknown> {
    if (!/^application\/json/i.test(request.headers['content-type'] ?? '')) throw new HttpError(415, 'Send JSON', 'unsupported_type');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        size += buffer.length;
        if (size > limit) throw new HttpError(413, 'The request is too large', 'too_large');
        chunks.push(buffer);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
        throw new HttpError(400, 'The body is not JSON', 'invalid_json');
    }
}

/** An app name from what a person typed: lower case words joined by dashes */
export function appNameOf(typed: string): string | undefined {
    const name = typed
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    return /^[a-z][a-z0-9-]*$/.test(name) ? name : undefined;
}

/** The fields of a small `application/x-www-form-urlencoded` body */
async function readForm(request: IncomingMessage): Promise<URLSearchParams> {
    if (!/^application\/x-www-form-urlencoded/i.test(request.headers['content-type'] ?? '')) throw new HttpError(415, 'Send a form', 'unsupported_type');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        size += buffer.length;
        if (size > MAX_FORM_BYTES) throw new HttpError(413, 'The form is too large', 'too_large');
        chunks.push(buffer);
    }
    return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

/**
 * Starts Magnetic's server: the stateui-mcp browser endpoint with one workspace per signed-in user, and the sign-in
 * pages. A request without a session is sent to `/signin` (a page) or refused with 401 (anything else, sockets too).
 * Each user's apps, files and live state come from their own workspace, so an app id of another user is not found
 */
export async function startMagnetic(options: MagneticOptions): Promise<RunningMagnetic> {
    const devUsers = options.devUsers ?? [];
    if (devUsers.length > 0 && !LOOPBACK.has(options.host.toLowerCase())) throw new Error('Development users are only offered on a loopback host');
    if (options.allowHttpProviders === true && !LOOPBACK.has(options.host.toLowerCase())) throw new Error('Providers over HTTP are only allowed on a loopback host');
    const runtime = loadRuntimeBundle(
        options.runtimeDir,
        loadCatalogFile().components.map((component) => component.name)
    );
    const chunk3d = loadChunk3d(options.chunk3dDir);
    const hostScript = loadHostScript();
    const accounts = new Accounts(join(options.dataDir, 'accounts.json'));
    const sessions = new Sessions(join(options.dataDir, 'sessions.json'));
    let origin = '';
    let runtimePort = 0;
    const publicOrigin = options.publicOrigin?.replace(/\/+$/, '');
    const secure = options.secureCookies ?? publicOrigin?.startsWith('https://') ?? false;
    const signIn = new OidcSignIn(options.providers ?? [], { publicOrigin: () => publicOrigin ?? origin, allowHttp: options.allowHttpProviders === true });
    const providerButtons = signIn.providers.map((provider) => ({ name: provider.name, label: provider.label }));
    const signInPageOf = (next: string, error?: string): string => signInPage({ devUsers, providers: providerButtons, next, ...(error !== undefined && { error }) });
    const workspaces = new Workspaces(
        {
            open: async (userId) => {
                const dataDir = join(options.dataDir, 'users', userId);
                if ((options.starter ?? 'showcase') === 'showcase') await installShowcase({ dataDir, report: options.report });
                const services = createServices({
                    dataDir,
                    ownerId: userId,
                    report: options.report,
                    origin: () => origin,
                    agentAnswers: false,
                    logicLimits: options.logicLimits ?? DEFAULT_LOGIC_LIMITS,
                    ...(options.browser !== undefined && { browser: options.browser })
                });
                await services.recoverParts();
                return services;
            },
            close: async (services: Services) => {
                await services.browser.close();
                await services.authorities.close();
            }
        },
        options.workspaces
    );
    const tools = new WeakMap<Services, readonly UiToolDefinition[]>();
    const toolsOf = (services: Services): readonly UiToolDefinition[] => {
        let found = tools.get(services);
        if (found === undefined) {
            found = createStateUiTools(services);
            tools.set(services, found);
        }
        return found;
    };
    let system: string | undefined;
    const budgets = new Budgets(join(options.dataDir, 'budgets.json'), options.agent?.budgets ?? DEFAULT_BUDGETS);
    const turns = new AgentTurns({
        model: options.agent?.model ?? new ClaudeModel(),
        modelName: options.agent?.modelName ?? DEFAULT_AGENT_MODEL,
        effort: options.agent?.effort ?? 'high',
        budgets,
        chats: new Chats(join(options.dataDir, 'users')),
        ...(options.agent?.limits !== undefined && { limits: options.agent.limits }),
        report: options.report,
        workspace: async (userId) => {
            const release = workspaces.retain(userId);
            try {
                const services = await workspaces.get(userId);
                system ??= agentSystemPrompt(services);
                return { tools: toolsOf(services), system, release };
            } catch (error) {
                release();
                throw error;
            }
        }
    });
    /** The open view sockets of each session (by the hash of its token), closed when it signs out */
    const sessionSockets = new Map<string, Set<(reason: string) => void>>();

    /** The signed-in user of a request and their session token, or `undefined` */
    async function signedIn(request: IncomingMessage): Promise<{ user: User; token: string } | undefined> {
        const token = readCookie(request, SESSION_COOKIE);
        const session = await sessions.find(token);
        if (session === undefined || token === undefined) return undefined;
        const user = await accounts.user(session.userId);
        return user === undefined ? undefined : { user, token };
    }

    async function tenant(request: IncomingMessage): Promise<TenantAnswer> {
        const who = await signedIn(request);
        if (who === undefined) {
            const next = safeNext(request.url);
            return { refuse: 401, location: next === '/' ? '/signin' : `/signin?next=${encodeURIComponent(next)}` };
        }
        const services = await workspaces.get(who.user.id);
        const key = Sessions.keyOf(who.token);
        const answer: HttpTenant = {
            useCases: services.useCases,
            hub: services.hub,
            liveViews: services.liveViews,
            instances: services.instanceViews,
            retain: (close) => {
                const release = workspaces.retain(who.user.id);
                const open = sessionSockets.get(key) ?? new Set();
                open.add(close);
                sessionSockets.set(key, open);
                return () => {
                    release();
                    open.delete(close);
                    if (open.size === 0) sessionSockets.delete(key);
                };
            }
        };
        return { tenant: answer };
    }

    async function routes(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
        const url = new URL(request.url ?? '/', 'http://localhost');
        const path = url.pathname;
        const method = request.method ?? 'GET';
        const cookie = (token: string, maxAge: number): string => sessionCookie(token, { maxAge, secure });

        if (method === 'GET' && path === '/assets/magnetic.css') {
            response.writeHead(200, { ...COMMON_HEADERS, 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache' });
            response.end(MAGNETIC_CSS);
            return true;
        }
        if (method === 'GET' && path === '/signin') {
            const next = safeNext(url.searchParams.get('next'));
            if ((await signedIn(request)) !== undefined) redirect(response, next);
            else sendPage(response, signInPageOf(next));
            return true;
        }
        if (method === 'POST' && path === '/signin/dev') {
            const form = await readForm(request);
            const name = form.get('user');
            if (name === null || !devUsers.includes(name)) throw new HttpError(403, 'Not a development user of this server', 'forbidden');
            const user = await accounts.signIn({ provider: 'dev', subject: name }, { name });
            redirect(response, safeNext(form.get('next')), cookie(await sessions.start(user.id), SESSION_DAYS * 24 * 60 * 60));
            return true;
        }
        const auth = /^\/auth\/([a-z][a-z0-9-]{0,31})(\/callback)?$/.exec(path);
        if (method === 'GET' && auth !== null && signIn.has(auth[1] as string)) {
            const name = auth[1] as string;
            const pendingCookie = (key: string, maxAge: number): string => httpOnlyCookie(SIGN_IN_COOKIE, key, { maxAge, secure, path: '/auth' });
            if (auth[2] === undefined) {
                let started;
                try {
                    started = await signIn.start(name, url.searchParams.get('next') ?? '/');
                } catch (error) {
                    options.report.info('Sign-in could not start', { provider: name, error: error instanceof Error ? error.message : String(error) });
                    sendPage(response, signInPageOf(safeNext(url.searchParams.get('next')), 'The sign-in provider could not be reached. Please try again in a moment.'), 502);
                    return true;
                }
                redirect(response, started.url, pendingCookie(started.key, 10 * 60));
                return true;
            }
            try {
                const done = await signIn.finish(name, readCookie(request, SIGN_IN_COOKIE), url.search);
                const user = await accounts.signIn(done.identity, done.profile);
                redirect(response, done.next, [pendingCookie('', 0), cookie(await sessions.start(user.id), SESSION_DAYS * 24 * 60 * 60)]);
            } catch (error) {
                if (!(error instanceof SignInError)) throw error;
                options.report.info('Sign-in did not finish', { provider: name, error: error.message });
                sendPage(response, signInPageOf('/', error.message), 400, pendingCookie('', 0));
            }
            return true;
        }
        if (method === 'POST' && path === '/signout') {
            const token = readCookie(request, SESSION_COOKIE);
            if (token !== undefined) {
                await sessions.end(token);
                for (const close of [...(sessionSockets.get(Sessions.keyOf(token)) ?? [])]) close('Signed out');
            }
            redirect(response, '/signin', cookie('', 0));
            return true;
        }
        if (method === 'GET' && path === '/') {
            const who = await signedIn(request);
            if (who === undefined) {
                redirect(response, '/signin');
                return true;
            }
            const apps = await (await workspaces.get(who.user.id)).instanceViews.list();
            sendPage(response, appsPage({ user: who.user, apps }));
            return true;
        }
        if (method === 'GET' && path === '/assets/shell.css') {
            sendAsset(response, 'text/css', SHELL_CSS);
            return true;
        }
        if (method === 'GET' && path === '/assets/shell.js') {
            sendAsset(response, 'text/javascript', SHELL_JS);
            return true;
        }
        if (method === 'POST' && path === '/new') {
            const who = await signedIn(request);
            if (who === undefined) throw new HttpError(401, 'Sign in first', 'unauthorized');
            const services = await workspaces.get(who.user.id);
            const name = appNameOf((await readForm(request)).get('name') ?? '');
            const create = toolsOf(services).find((tool) => tool.name === 'ui_app_create');
            const outcome = name === undefined || create === undefined ? undefined : await create.run({ name });
            const created = outcome?.body as { id?: unknown; message?: unknown } | undefined;
            if (outcome === undefined || outcome.isError || typeof created?.id !== 'string') {
                const why = name === undefined ? 'Give the app a name that starts with a letter.' : typeof created?.message === 'string' ? created.message : 'The app could not be made.';
                sendPage(response, appsPage({ user: who.user, apps: await services.instanceViews.list(), error: why }), 400);
                return true;
            }
            redirect(response, `/edit/${encodeURIComponent(created.id)}`);
            return true;
        }
        const edit = /^\/edit\/([^/]+)(\/events|\/turns|\/stop)?$/.exec(path);
        if (edit !== null) {
            await editRoute(request, response, method, decodeURIComponent(edit[1] as string), edit[2]);
            return true;
        }
        return false;
    }

    /** The editor of one app: the page, its event stream, a new turn, and stop */
    async function editRoute(request: IncomingMessage, response: ServerResponse, method: string, appId: string, what: string | undefined): Promise<void> {
        const who = await signedIn(request);
        if (who === undefined) {
            if (what === undefined && method === 'GET') redirect(response, `/signin?next=${encodeURIComponent(safeNext(request.url))}`);
            else sendJson(response, 401, { message: 'Sign in first.' });
            return;
        }
        const services = await workspaces.get(who.user.id);
        const app = await services.instanceViews.find(appId);
        if (app === undefined) throw new HttpError(404, 'No app with this id', 'not_found');
        const userId = who.user.id;
        if (what === undefined && method === 'GET') {
            const runtimeOrigin = `http://${requestHostName(request.headers.host) ?? '127.0.0.1'}:${runtimePort}`;
            const html = shellPage({ appId, name: app.name, runtimeUrl: `${runtimeOrigin}/runtime/${runtime.hash}.html`, ...(chunk3d !== undefined && { chunk3d: chunk3d.hash }), namespace: services.instanceViews.namespace(app) });
            response.writeHead(200, { ...COMMON_HEADERS, 'Referrer-Policy': 'same-origin', 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': hostPageCsp(runtimeOrigin), 'Cache-Control': 'no-store' });
            response.end(html);
            return;
        }
        if (what === '/events' && method === 'GET') {
            response.writeHead(200, { ...COMMON_HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
            response.write(': open\n\n');
            const key = Sessions.keyOf(who.token);
            const release = workspaces.retain(userId);
            const open = sessionSockets.get(key) ?? new Set();
            const close = (): void => {
                response.end();
            };
            open.add(close);
            sessionSockets.set(key, open);
            const stopListening = await turns.subscribe(userId, appId, (event) => response.write(`data: ${JSON.stringify(event)}\n\n`));
            const beat = setInterval(() => response.write(': beat\n\n'), 25_000);
            response.on('close', () => {
                clearInterval(beat);
                stopListening();
                release();
                open.delete(close);
                if (open.size === 0) sessionSockets.delete(key);
            });
            return;
        }
        if (what === '/turns' && method === 'POST') {
            const body = await readJsonBody(request, MAX_TURN_BYTES);
            const fields = (typeof body === 'object' && body !== null ? body : {}) as { text?: unknown; context?: unknown };
            const text = typeof fields.text === 'string' ? fields.text.trim() : '';
            if (text === '' || text.length > MAX_REQUEST_CHARS) {
                sendJson(response, 400, { message: `Write a request of up to ${MAX_REQUEST_CHARS} characters.` });
                return;
            }
            const context = Array.isArray(fields.context) ? fields.context.filter((name): name is ContextToggle => (CONTEXT_TOGGLES as readonly unknown[]).includes(name)) : [];
            const started = await turns.start(userId, { id: appId, name: app.name }, text, context);
            if ('refused' in started) sendJson(response, 409, { message: started.refused });
            else sendJson(response, 202, { ok: true });
            return;
        }
        if (what === '/stop' && method === 'POST') {
            sendJson(response, 200, { stopped: turns.stop(userId) });
            return;
        }
        throw new HttpError(405, 'Not allowed', 'method_not_allowed');
    }

    const http = await startHttpServer({
        host: options.host,
        port: options.port,
        runtimePort: options.runtimePort ?? (options.port === 0 ? 0 : options.port + 1),
        tenant,
        routes,
        socketMessagesPerSecond: options.socketMessagesPerSecond ?? DEFAULT_SOCKET_MESSAGES_PER_SECOND,
        runtime,
        ...(chunk3d !== undefined && { chunk3d }),
        hostScript,
        report: options.report
    });
    runtimePort = http.runtimePort;
    origin = http.origin.replace('//0.0.0.0', '//127.0.0.1').replace('//[::]', '//[::1]');
    const sweep = setInterval(() => void workspaces.sweep(), 60_000);
    sweep.unref();
    options.report.info('Magnetic started', { origin, dataDir: options.dataDir, devUsers: devUsers.length, providers: signIn.providers.map((provider) => provider.name) });

    let stopped = false;
    return {
        origin,
        port: http.port,
        runtimePort: http.runtimePort,
        accounts,
        sessions,
        workspaces,
        signIn,
        turns,
        budgets,
        stop: async () => {
            if (stopped) return;
            stopped = true;
            clearInterval(sweep);
            await turns.stopAll();
            await http.close();
            await workspaces.close();
        }
    };
}
