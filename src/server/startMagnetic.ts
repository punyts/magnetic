import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { COMMON_HEADERS, createServices, HttpError, installShowcase, loadCatalogFile, loadChunk3d, loadHostScript, loadRuntimeBundle, startHttpServer } from '@punyts/stateui-mcp';
import type { AppLogicLimits, HttpTenant, PreviewBrowser, Services, TenantAnswer } from '@punyts/stateui-mcp';
import type { Report } from '@punyts/core';
import { Accounts } from '../accounts/Accounts.js';
import type { User } from '../accounts/Accounts.js';
import { Sessions, SESSION_DAYS } from '../accounts/Sessions.js';
import { readCookie, SESSION_COOKIE, sessionCookie } from '../http/cookies.js';
import { appsPage, MAGNETIC_CSS, MAGNETIC_PAGE_CSP, signInPage } from '../http/pages.js';
import { Workspaces } from '../workspaces/Workspaces.js';
import type { WorkspacesOptions } from '../workspaces/Workspaces.js';

/** The bounds on each app's logic when no others are given: other people's logic runs on this server */
export const DEFAULT_LOGIC_LIMITS: AppLogicLimits = { timerRunsPerSecond: 20 };
/** The text frames a view's socket may send per second when no other number is given */
export const DEFAULT_SOCKET_MESSAGES_PER_SECOND = 50;

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
const MAX_FORM_BYTES = 4096;

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
    /** Marks the session cookie `Secure`; on whenever people reach the server over HTTPS */
    readonly secureCookies?: boolean;
}

export interface RunningMagnetic {
    readonly origin: string;
    readonly port: number;
    readonly runtimePort: number;
    readonly accounts: Accounts;
    readonly sessions: Sessions;
    readonly workspaces: Workspaces;
    /** Closes the server, the workspaces and their browsers. Safe to call twice */
    stop(): Promise<void>;
}

function redirect(response: ServerResponse, location: string, cookie?: string): void {
    response.writeHead(303, { ...COMMON_HEADERS, Location: location, 'Cache-Control': 'no-store', ...(cookie !== undefined && { 'Set-Cookie': cookie }) });
    response.end();
}

/**
 * Sends one of Magnetic's own pages. Their forms post to this server, and a browser sends `Origin: null` with a form
 * post from a page whose referrer policy is `no-referrer`, which the same-origin check refuses: these pages send their
 * origin to themselves only (`same-origin`)
 */
function sendPage(response: ServerResponse, html: string): void {
    response.writeHead(200, {
        ...COMMON_HEADERS,
        'Referrer-Policy': 'same-origin',
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': MAGNETIC_PAGE_CSP,
        'Cache-Control': 'no-store'
    });
    response.end(html);
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
    const runtime = loadRuntimeBundle(
        options.runtimeDir,
        loadCatalogFile().components.map((component) => component.name)
    );
    const chunk3d = loadChunk3d(options.chunk3dDir);
    const hostScript = loadHostScript();
    const accounts = new Accounts(join(options.dataDir, 'accounts.json'));
    const sessions = new Sessions(join(options.dataDir, 'sessions.json'));
    let origin = '';
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
        if (who === undefined) return { refuse: 401, location: '/signin' };
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
        const path = new URL(request.url ?? '/', 'http://localhost').pathname;
        const method = request.method ?? 'GET';
        const cookie = (token: string, maxAge: number): string => sessionCookie(token, { maxAge, secure: options.secureCookies === true });

        if (method === 'GET' && path === '/assets/magnetic.css') {
            response.writeHead(200, { ...COMMON_HEADERS, 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache' });
            response.end(MAGNETIC_CSS);
            return true;
        }
        if (method === 'GET' && path === '/signin') {
            if ((await signedIn(request)) !== undefined) redirect(response, '/');
            else sendPage(response, signInPage({ devUsers, providers: [] }));
            return true;
        }
        if (method === 'POST' && path === '/signin/dev') {
            const name = (await readForm(request)).get('user');
            if (name === null || !devUsers.includes(name)) throw new HttpError(403, 'Not a development user of this server', 'forbidden');
            const user = await accounts.signIn({ provider: 'dev', subject: name }, { name });
            redirect(response, '/', cookie(await sessions.start(user.id), SESSION_DAYS * 24 * 60 * 60));
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
        return false;
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
    origin = http.origin.replace('//0.0.0.0', '//127.0.0.1').replace('//[::]', '//[::1]');
    const sweep = setInterval(() => void workspaces.sweep(), 60_000);
    sweep.unref();
    options.report.info('Magnetic started', { origin, dataDir: options.dataDir, devUsers: devUsers.length });

    let stopped = false;
    return {
        origin,
        port: http.port,
        runtimePort: http.runtimePort,
        accounts,
        sessions,
        workspaces,
        stop: async () => {
            if (stopped) return;
            stopped = true;
            clearInterval(sweep);
            await http.close();
            await workspaces.close();
        }
    };
}
