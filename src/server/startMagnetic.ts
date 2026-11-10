import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { appNamespace, COMMON_HEADERS, copyAppParts, createServices, createStateUiTools, DEFAULT_PERSONA, hostPageCsp, HttpError, installShowcase, loadCatalogFile, loadChunk3d, loadHostScript, loadRuntimeBundle, requestHostName, startHttpServer } from '@punyts/stateui-mcp';
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
import { AGENT_MODELS, modelChoice } from '../agent/models.js';
import { HOME_CSS, HOME_JS, homePage } from '../http/home.js';
import { SHELL_CSS, SHELL_JS, shellPage } from '../http/shell.js';
import { HOME_APP, HomeApps } from '../home/HomeApp.js';
import type { HomeCard } from '../home/HomeApp.js';
import type { User } from '../accounts/Accounts.js';
import { Sessions, SESSION_DAYS } from '../accounts/Sessions.js';
import { OidcSignIn, safeNext, SignInError } from '../auth/OidcSignIn.js';
import type { OidcProvider } from '../auth/OidcSignIn.js';
import { httpOnlyCookie, readCookie, SESSION_COOKIE, sessionCookie, SIGN_IN_COOKIE } from '../http/cookies.js';
import { linkPage, MAGNETIC_CSS, MAGNETIC_PAGE_CSP, signInPage } from '../http/pages.js';
import type { SharedApp } from '../http/pages.js';
import { GRANT_RIGHTS, Grants } from '../sharing/Grants.js';
import type { Grant, GrantRight } from '../sharing/Grants.js';
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
/** A random (version 4) UUID: the id of an app made in a workspace, which no other workspace has */
const RANDOM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_PATH = /^\/apps\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;
/** What a person sees, and their browser is told, when an app shared with them is taken back */
export const REVOKED_MESSAGE = 'This app is no longer shared with you.';

/** The model of the agent when no other is given: the cheapest, as every turn is paid for */
export const DEFAULT_AGENT_MODEL = 'claude-haiku-5-5';
export type AgentEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface MagneticAgentOptions {
    /** Replaces the Claude API, for tests */
    readonly model?: AgentModel;
    /** The model of a turn that names none; default `claude-haiku-5-5` */
    readonly modelName?: string;
    /** The models people may pick in the editor; default Haiku, Sonnet and Opus 5.5 (`AGENT_MODELS`) */
    readonly models?: readonly string[];
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
    readonly grants: Grants;
    /** Each person's "Your apps" */
    readonly homes: HomeApps;
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
    /** Each person's "Your apps", made with the tools the agent uses */
    const homes = new HomeApps(toolsOf, join(options.dataDir, 'users'));
    let system: string | undefined;
    const budgets = new Budgets(join(options.dataDir, 'budgets.json'), options.agent?.budgets ?? DEFAULT_BUDGETS);
    const turns = new AgentTurns({
        model: options.agent?.model ?? new ClaudeModel(),
        modelName: options.agent?.modelName ?? DEFAULT_AGENT_MODEL,
        models: options.agent?.models ?? AGENT_MODELS.map((model) => model.id),
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
    const sessionSockets = new Map<string, Set<(reason: string, revoked?: boolean) => void>>();
    const grants = new Grants(join(options.dataDir, 'grants.json'));
    /** The open view sockets of apps shared with a person, by `<userId>/<appId>`, closed when a link is revoked */
    const sharedSockets = new Map<string, Set<(reason: string, revoked?: boolean) => void>>();
    const linkOf = (grant: Grant): string => `${publicOrigin ?? origin}/s/${grant.token}`;

    /** Adds a close function to one of the socket maps; the function returned takes it out again */
    function track(map: Map<string, Set<(reason: string, revoked?: boolean) => void>>, key: string, close: (reason: string, revoked?: boolean) => void): () => void {
        const open = map.get(key) ?? new Set();
        open.add(close);
        map.set(key, open);
        return () => {
            open.delete(close);
            if (open.size === 0) map.delete(key);
        };
    }

    /**
     * After a link is revoked, closes the views of everyone who opened it. A person with no other live link to the app
     * is told it was revoked, so their browser deletes what it kept of it; one with another link reconnects under it
     */
    async function closeRevoked(grant: Grant): Promise<void> {
        for (const userId of Object.keys(grant.members)) {
            const access = await grants.access(grant.appId, userId);
            const live = access !== undefined && 'live' in access;
            for (const close of [...(sharedSockets.get(`${userId}/${grant.appId}`) ?? [])]) close(live ? 'Your access to this app changed' : REVOKED_MESSAGE, !live);
        }
    }

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
        const appId = APP_PATH.exec(new URL(request.url ?? '/', 'http://localhost').pathname)?.[1]?.toLowerCase();
        if (appId !== undefined && (await services.instanceViews.find(appId)) === undefined) {
            // Not one of theirs: an app shared with them, or one taken back from them
            const shared = await grants.access(appId, who.user.id);
            if (shared !== undefined && 'revoked' in shared) {
                const grant = shared.revoked;
                const persona = grant.right === 'use' ? who.user.id : DEFAULT_PERSONA;
                return { revoked: { message: REVOKED_MESSAGE, namespace: appNamespace({ persona, ownerId: grant.ownerId, appId }), name: grant.appName } };
            }
            if (shared !== undefined) return { tenant: await sharedTenant(shared.live, who.user.id, key) };
        }
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

    /** The owner's workspace, seen by a person given the app: their own instance (`use`) or the owner's, read only (`view`) */
    async function sharedTenant(grant: Grant & { readonly right: 'view' | 'use' }, userId: string, sessionKey: string): Promise<HttpTenant> {
        const owner = await workspaces.get(grant.ownerId);
        return {
            useCases: owner.useCases,
            hub: owner.hub,
            liveViews: owner.liveViews,
            instances: owner.instanceViews,
            persona: grant.right === 'use' ? userId : DEFAULT_PERSONA,
            access: grant.right,
            retain: (close) => {
                const release = workspaces.retain(grant.ownerId);
                const untrackSession = track(sessionSockets, sessionKey, close);
                const untrackShared = track(sharedSockets, `${userId}/${grant.appId}`, close);
                return () => {
                    release();
                    untrackSession();
                    untrackShared();
                };
            }
        };
    }

    /** The apps shared with a person, for their home page */
    async function sharedApps(userId: string): Promise<SharedApp[]> {
        const found: SharedApp[] = [];
        for (const grant of await grants.sharedWith(userId)) {
            const owner = await accounts.user(grant.ownerId);
            found.push({ appId: grant.appId, name: grant.appName, right: grant.right === 'use' ? 'use' : 'view', ownerName: owner?.name ?? 'Someone' });
        }
        return found;
    }

    /** The runtime origin as the browser of a request reaches it */
    function runtimeOriginOf(request: IncomingMessage): string {
        return `http://${requestHostName(request.headers.host) ?? '127.0.0.1'}:${runtimePort}`;
    }

    /** Sends a page that runs an app: its frame comes from the runtime origin */
    function sendHostPage(request: IncomingMessage, response: ServerResponse, html: string): void {
        response.writeHead(200, { ...COMMON_HEADERS, 'Referrer-Policy': 'same-origin', 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': hostPageCsp(runtimeOriginOf(request)), 'Cache-Control': 'no-store' });
        response.end(html);
    }

    /** `GET /`: the person's "Your apps", with the lists written into its data first */
    async function homeRoute(request: IncomingMessage, response: ServerResponse, user: User): Promise<void> {
        const services = await workspaces.get(user.id);
        const homeId = await homes.id(services, user.id);
        const all = await services.instanceViews.list();
        const changed = (at: Date): string => `Changed ${at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
        const apps: HomeCard[] = [...all]
            .filter((app) => app.id !== homeId)
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
            .map((app) => ({ id: app.id, name: app.name, note: changed(app.updatedAt) }));
        const shared: HomeCard[] = (await sharedApps(user.id)).map((app) => ({ id: app.appId, name: app.name, note: `${app.ownerName} · ${app.right === 'use' ? 'use' : 'view only'}` }));
        await homes.show(services, user.id, { apps, shared });
        const home = await services.instanceViews.find(homeId);
        if (home === undefined) throw new HttpError(500, 'Your apps could not be opened', 'internal');
        sendHostPage(
            request,
            response,
            homePage({ appId: homeId, runtimeUrl: `${runtimeOriginOf(request)}/runtime/${runtime.hash}.html`, ...(chunk3d !== undefined && { chunk3d: chunk3d.hash }), namespace: services.instanceViews.namespace(home) })
        );
    }

    /** `GET /s/<token>` and `POST /s/<token>/remix`: a share link */
    async function linkRoute(request: IncomingMessage, response: ServerResponse, method: string, token: string, remix: boolean): Promise<void> {
        const who = await signedIn(request);
        if (who === undefined) {
            if (method === 'GET') redirect(response, `/signin?next=${encodeURIComponent(`/s/${token}`)}`);
            else throw new HttpError(401, 'Sign in first', 'unauthorized');
            return;
        }
        const grant = await grants.byToken(token);
        if (grant === undefined) {
            sendPage(response, linkPage({ title: 'Link not found', message: 'This link does not work. Ask the person who sent it for a new one.' }), 404);
            return;
        }
        if (grant.revokedAt !== undefined) {
            sendPage(response, linkPage({ title: grant.appName, message: 'This link was revoked by the person who shared it.' }), 410);
            return;
        }
        const owner = await workspaces.get(grant.ownerId);
        const app = await owner.instanceViews.find(grant.appId);
        if (app === undefined) {
            sendPage(response, linkPage({ title: grant.appName, message: 'This app was deleted.' }), 404);
            return;
        }
        if (grant.ownerId === who.user.id) {
            redirect(response, `/edit/${encodeURIComponent(grant.appId)}`);
            return;
        }
        if (method === 'GET') {
            await grants.join(grant.id, who.user.id);
            if (grant.right === 'remix') {
                const sharer = await accounts.user(grant.ownerId);
                sendPage(response, linkPage({ title: `Remix ${app.name}`, message: `${sharer?.name ?? 'Someone'} shared a copy of this app with you.`, remix: { token } }));
            } else redirect(response, `/apps/${encodeURIComponent(grant.appId)}`);
            return;
        }
        if (!remix || grant.right !== 'remix') throw new HttpError(405, 'Not allowed', 'method_not_allowed');
        const mine = await workspaces.get(who.user.id);
        const copied = await copyAppParts(owner.parts, mine.parts, grant.appId);
        if (copied.kind !== 'copied') {
            sendPage(response, linkPage({ title: `Remix ${app.name}`, message: copied.kind === 'failed' ? `The copy could not be made: ${copied.reason}` : 'This app was deleted.', remix: { token } }), copied.kind === 'failed' ? 500 : 404);
            return;
        }
        options.report.info('App remixed', { from: grant.appId, to: copied.app.id, parts: copied.parts.length });
        redirect(response, `/edit/${encodeURIComponent(copied.app.id)}`);
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
            await homeRoute(request, response, who.user);
            return true;
        }
        if (method === 'GET' && path === '/assets/shell.css') {
            sendAsset(response, 'text/css', SHELL_CSS);
            return true;
        }
        if (method === 'GET' && path === '/assets/home.css') {
            sendAsset(response, 'text/css', HOME_CSS);
            return true;
        }
        if (method === 'GET' && path === '/assets/home.js') {
            sendAsset(response, 'text/javascript', HOME_JS);
            return true;
        }
        if (method === 'GET' && path === '/assets/shell.js') {
            sendAsset(response, 'text/javascript', SHELL_JS);
            return true;
        }
        if (method === 'POST' && path === '/new') {
            const who = await signedIn(request);
            if (who === undefined) throw new HttpError(401, 'Sign in first', 'unauthorized');
            const json = (request.headers.accept ?? '').includes('application/json');
            const services = await workspaces.get(who.user.id);
            const name = appNameOf((await readForm(request)).get('name') ?? '');
            const create = toolsOf(services).find((tool) => tool.name === 'ui_app_create');
            const outcome = name === undefined || create === undefined ? undefined : await create.run({ name });
            const created = outcome?.body as { id?: unknown; message?: unknown } | undefined;
            if (outcome === undefined || outcome.isError || typeof created?.id !== 'string') {
                const why = name === undefined ? 'Give the app a name that starts with a letter.' : typeof created?.message === 'string' ? created.message : 'The app could not be made.';
                if (json) sendJson(response, 400, { message: why });
                else redirect(response, '/');
                return true;
            }
            if (json) sendJson(response, 201, { id: created.id });
            else redirect(response, `/edit/${encodeURIComponent(created.id)}`);
            return true;
        }
        // An app of the person's own opens with the editor hidden; any other falls through to the app page of the host
        const own = method === 'GET' ? /^\/apps\/([^/]+)$/.exec(path) : null;
        if (own !== null && (await ownAppPage(request, response, decodeURIComponent(own[1] as string)))) return true;
        const edit = /^\/edit\/([^/]+)(\/events|\/turns|\/stop|\/share|\/share\/[^/]+\/revoke)?$/.exec(path);
        if (edit !== null) {
            await editRoute(request, response, method, decodeURIComponent(edit[1] as string), edit[2]);
            return true;
        }
        const link = /^\/s\/([A-Za-z0-9_-]{1,64})(\/remix)?$/.exec(path);
        if (link !== null && (method === 'GET' ? link[2] === undefined : method === 'POST' && link[2] !== undefined)) {
            await linkRoute(request, response, method, link[1] as string, link[2] !== undefined);
            return true;
        }
        return false;
    }

    /** The page of an app, with the editor hidden (`editing` false) or shown */
    function appShellPage(request: IncomingMessage, services: Services, app: NonNullable<Awaited<ReturnType<Services['instanceViews']['find']>>>, editing: boolean): string {
        return shellPage({
            appId: app.id,
            name: app.name,
            runtimeUrl: `${runtimeOriginOf(request)}/runtime/${runtime.hash}.html`,
            ...(chunk3d !== undefined && { chunk3d: chunk3d.hash }),
            namespace: services.instanceViews.namespace(app),
            models: turns.models.map(modelChoice),
            editing
        });
    }

    /** `GET /apps/<appId>` of an app the person owns: the app, with the editor a key chord away. False for any other */
    async function ownAppPage(request: IncomingMessage, response: ServerResponse, appId: string): Promise<boolean> {
        const who = await signedIn(request);
        if (who === undefined) return false;
        const services = await workspaces.get(who.user.id);
        const app = await services.instanceViews.find(appId);
        if (app === undefined) return false;
        if (app.name === HOME_APP) {
            redirect(response, '/');
            return true;
        }
        sendHostPage(request, response, appShellPage(request, services, app, false));
        return true;
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
        // "Your apps" is Magnetic's own: the agent does not change it
        if (app.name === HOME_APP) {
            if (what === undefined && method === 'GET') redirect(response, '/');
            else sendJson(response, 404, { message: 'No app with this id.' });
            return;
        }
        const userId = who.user.id;
        if (what === undefined && method === 'GET') {
            sendHostPage(request, response, appShellPage(request, services, app, true));
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
            const fields = (typeof body === 'object' && body !== null ? body : {}) as { text?: unknown; context?: unknown; model?: unknown };
            const text = typeof fields.text === 'string' ? fields.text.trim() : '';
            if (text === '' || text.length > MAX_REQUEST_CHARS) {
                sendJson(response, 400, { message: `Write a request of up to ${MAX_REQUEST_CHARS} characters.` });
                return;
            }
            const context = Array.isArray(fields.context) ? fields.context.filter((name): name is ContextToggle => (CONTEXT_TOGGLES as readonly unknown[]).includes(name)) : [];
            if (fields.model !== undefined && (typeof fields.model !== 'string' || !turns.models.includes(fields.model))) {
                sendJson(response, 400, { message: 'Choose one of the models offered.' });
                return;
            }
            const started = await turns.start(userId, { id: appId, name: app.name }, text, context, typeof fields.model === 'string' ? fields.model : undefined);
            if ('refused' in started) sendJson(response, 409, { message: started.refused });
            else sendJson(response, 202, { ok: true });
            return;
        }
        if (what === '/stop' && method === 'POST') {
            sendJson(response, 200, { stopped: turns.stop(userId) });
            return;
        }
        if (what === '/share' && method === 'GET') {
            const links = (await grants.forApp(userId, appId)).map((grant) => ({ id: grant.id, right: grant.right, url: linkOf(grant), members: Object.keys(grant.members).length, revoked: grant.revokedAt !== undefined, createdAt: grant.createdAt }));
            sendJson(response, 200, { grants: links });
            return;
        }
        if (what === '/share' && method === 'POST') {
            const body = await readJsonBody(request, MAX_FORM_BYTES);
            const right = (typeof body === 'object' && body !== null ? (body as { right?: unknown }).right : undefined) as GrantRight;
            if (!GRANT_RIGHTS.includes(right)) {
                sendJson(response, 400, { message: `Choose what the link gives: ${GRANT_RIGHTS.join(', ')}.` });
                return;
            }
            if (!RANDOM_ID.test(appId)) {
                // The starter apps have the same id in every workspace, so a link to one would open the person's own
                sendJson(response, 409, { message: 'Everyone starts with this app already. Ask the agent to make an app of your own from it, and share that.' });
                return;
            }
            const grant = await grants.create(userId, { id: appId, name: app.name }, right);
            sendJson(response, 201, { id: grant.id, right: grant.right, url: linkOf(grant) });
            return;
        }
        const revoke = what === undefined ? null : /^\/share\/([^/]+)\/revoke$/.exec(what);
        if (revoke !== null && method === 'POST') {
            const grant = await grants.revoke(userId, decodeURIComponent(revoke[1] as string));
            if (grant === undefined || grant.appId !== appId) {
                sendJson(response, 404, { message: 'No such link.' });
                return;
            }
            await closeRevoked(grant);
            sendJson(response, 200, { revoked: true });
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
        grants,
        homes,
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
