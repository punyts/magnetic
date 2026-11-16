import type { LogicEffectAnswer, LogicEffectFunction } from '@punyts/stateui-app/core';
import type { Connection, Connections, ConnectionSecrets, Endpoint } from './Connections.js';
import { CallRefused, guardedCall } from './guard.js';
import type { GuardedAnswer, GuardOptions } from './guard.js';

/** The name apps run it by: `logic.effects.<name>: { request, run: "http", ... }` */
export const HTTP_EFFECT = 'http';

/** How many calls each app may make a minute, through all its connections */
export const CALLS_PER_MINUTE = 60;

/** What an app asks for: an endpoint of a connection of its workspace, with the values of its `{params}` */
export interface HttpRequest {
    readonly connection: string;
    readonly endpoint: string;
    readonly params?: Readonly<Record<string, string | number | boolean>>;
}

/** Where calls are reported: one line each, with no secret and no body */
export type CallReport = (message: string, fields: Record<string, unknown>) => void;

/** Calls per app in the last minute, by `<workspace>/<app>` */
export class CallLimits {
    private readonly calls = new Map<string, number[]>();
    constructor(
        private readonly perMinute = CALLS_PER_MINUTE,
        private readonly now: () => number = () => Date.now()
    ) {}

    /** Counts a call; false when the app has used its calls for this minute */
    take(key: string): boolean {
        const now = this.now();
        const recent = (this.calls.get(key) ?? []).filter((at) => at > now - 60_000);
        if (recent.length >= this.perMinute) {
            this.calls.set(key, recent);
            return false;
        }
        recent.push(now);
        this.calls.set(key, recent);
        return true;
    }
}

/** A `{param}` template filled from the params; a missing one is an error the app's owner can read */
export function fill(template: string, params: Readonly<Record<string, unknown>>, encode: (value: string) => string = (value) => value): string {
    return template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_mark, name: string) => {
        const value = params[name];
        if (value === undefined || value === null || typeof value === 'object') throw new CallRefused(`The request has no param "${name}".`);
        return encode(String(value));
    });
}

/** A body template filled: a string that is one `{param}` becomes the param's own value, other strings are filled */
function fillBody(template: unknown, params: Readonly<Record<string, unknown>>): unknown {
    if (typeof template === 'string') {
        const whole = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(template);
        if (whole !== null) {
            const value = params[whole[1] as string];
            if (value === undefined) throw new CallRefused(`The request has no param "${whole[1]}".`);
            return value;
        }
        return fill(template, params);
    }
    if (Array.isArray(template)) return template.map((item) => fillBody(item, params));
    if (template !== null && typeof template === 'object') return Object.fromEntries(Object.entries(template).map(([key, value]) => [key, fillBody(value, params)]));
    return template;
}

/** The URL of an endpoint's call: the base URL, the path with its params, the query with its params */
export function urlOf(connection: Pick<Connection, 'baseUrl'>, endpoint: Endpoint, params: Readonly<Record<string, unknown>>): URL {
    const base = new URL(connection.baseUrl);
    const url = new URL(base.toString().replace(/\/+$/, '') + fill(endpoint.path, params, encodeURIComponent));
    if (url.origin !== base.origin) throw new CallRefused('An endpoint may only call its connection\'s own host.');
    for (const [key, value] of Object.entries(endpoint.query ?? {})) url.searchParams.set(key, fill(value, params));
    return url;
}

/** The answer as the effect gives it: the records at the endpoint's path (with their total), or the whole value */
export function answerOf(endpoint: Endpoint, answer: GuardedAnswer): LogicEffectAnswer {
    if (answer.status < 200 || answer.status >= 300) throw new CallRefused(`The API answered ${answer.status}.`);
    let value: unknown = answer.body;
    if (/json/i.test(answer.contentType) || /^\s*[[{]/.test(answer.body)) {
        try {
            value = answer.body.trim() === '' ? null : JSON.parse(answer.body);
        } catch {
            throw new CallRefused('The API answered JSON that does not parse.');
        }
    }
    if (endpoint.records === undefined) return { value: value as never };
    let at: unknown = value;
    for (const step of endpoint.records.split('.')) at = at !== null && typeof at === 'object' ? (at as Record<string, unknown>)[step] : undefined;
    if (!Array.isArray(at)) throw new CallRefused(`The answer has no list at "${endpoint.records}".`);
    return { first: 0, records: at as never, total: at.length };
}

/** The OAuth token endpoint's answer, kept as the connection's tokens */
async function tokenCall(connections: Connections, connection: Connection, form: Record<string, string>, guard: GuardOptions, signal?: AbortSignal): Promise<string> {
    const auth = connection.auth as Extract<Connection['auth'], { tokenUrl: string }>;
    const answer = await guardedCall(
        auth.tokenUrl,
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString(), ...(signal !== undefined && { signal }) },
        guard
    );
    let body: Record<string, unknown> = {};
    try {
        body = JSON.parse(answer.body) as Record<string, unknown>;
    } catch {
        // Not JSON: the status says what went wrong
    }
    if (answer.status !== 200 || typeof body['access_token'] !== 'string') throw new CallRefused(`The sign-in was refused (${typeof body['error'] === 'string' ? body['error'] : answer.status}).`);
    const expiresIn = typeof body['expires_in'] === 'number' ? body['expires_in'] : undefined;
    await connections.saveTokens(connection.id, {
        accessToken: body['access_token'],
        ...(typeof body['refresh_token'] === 'string' && { refreshToken: body['refresh_token'] }),
        ...(expiresIn !== undefined && { expiresAt: new Date(Date.now() + Math.max(0, expiresIn - 30) * 1000).toISOString() })
    });
    return body['access_token'];
}

/** A current access token of an OAuth connection: the kept one, or one got (client credentials) or refreshed (code) */
export async function accessTokenOf(connections: Connections, connection: Connection, secrets: ConnectionSecrets, guard: GuardOptions, signal?: AbortSignal): Promise<string> {
    const fresh = secrets.accessToken !== undefined && (secrets.expiresAt === undefined || Date.parse(secrets.expiresAt) > Date.now());
    if (fresh) return secrets.accessToken as string;
    const auth = connection.auth;
    if (auth.kind === 'oauth-client') {
        if (secrets.clientSecret === undefined) throw new CallRefused(`The connection "${connection.name}" has no client secret yet.`);
        return tokenCall(connections, connection, { grant_type: 'client_credentials', client_id: auth.clientId, client_secret: secrets.clientSecret, ...(auth.scope !== undefined && { scope: auth.scope }) }, guard, signal);
    }
    if (auth.kind === 'oauth-code') {
        if (secrets.refreshToken === undefined) throw new CallRefused(`The connection "${connection.name}" is not signed in: press Connect on its page.`);
        return tokenCall(
            connections,
            connection,
            { grant_type: 'refresh_token', refresh_token: secrets.refreshToken, client_id: auth.clientId, ...(secrets.clientSecret !== undefined && { client_secret: secrets.clientSecret }) },
            guard,
            signal
        );
    }
    throw new CallRefused('This connection does not sign in with OAuth.');
}

/** Calls one endpoint of a connection with its sign-in: what the effect and the page's Try both do */
export async function callEndpoint(connections: Connections, connection: Connection, endpoint: Endpoint, params: Readonly<Record<string, unknown>>, guard: GuardOptions, signal?: AbortSignal): Promise<GuardedAnswer> {
    const url = urlOf(connection, endpoint, params);
    const headers: Record<string, string> = {};
    const secrets = await connections.secretsOf(connection.id);
    const auth = connection.auth;
    if (auth.kind === 'key') {
        if (secrets.key === undefined) throw new CallRefused(`The connection "${connection.name}" has no key yet.`);
        if (auth.in === 'header') headers[auth.name] = (auth.prefix ?? '') + secrets.key;
        else url.searchParams.set(auth.name, secrets.key);
    } else if (auth.kind === 'oauth-client' || auth.kind === 'oauth-code') {
        headers['Authorization'] = `Bearer ${await accessTokenOf(connections, connection, secrets, guard, signal)}`;
    }
    let body: string | undefined;
    if (endpoint.body !== undefined) {
        body = JSON.stringify(fillBody(endpoint.body, params));
        headers['Content-Type'] = 'application/json';
    }
    return guardedCall(url.toString(), { method: endpoint.method, headers, ...(body !== undefined && { body }), ...(signal !== undefined && { signal }) }, guard);
}

/**
 * The `http` effect of one app of a workspace: the request names a connection of the workspace and one of its
 * endpoints, and gives the params. Refused before any call: an unknown connection or endpoint, a missing param, an app
 * over its calls for the minute, or a connection the workspace's policy turned off. Each call is reported with its
 * workspace, app, connection, endpoint, status and time, never a secret or a body
 */
export function httpEffect(options: {
    readonly connections: Connections;
    readonly workspaceId: string;
    readonly appId: string;
    readonly limits: CallLimits;
    readonly report: CallReport;
    readonly guard?: GuardOptions;
    /** Whether the workspace may call out at all (an org's policy); default yes */
    readonly allowed?: () => Promise<boolean>;
}): LogicEffectFunction {
    return async (request, { signal }) => {
        const asked = (request ?? {}) as Partial<HttpRequest>;
        if (typeof asked.connection !== 'string' || typeof asked.endpoint !== 'string') throw new CallRefused('An http request names a connection and an endpoint: { connection, endpoint, params }.');
        if (options.allowed !== undefined && !(await options.allowed())) throw new CallRefused('This organisation has turned connections off.');
        const connection = await options.connections.get(options.workspaceId, asked.connection);
        if (connection === undefined) throw new CallRefused(`There is no connection "${asked.connection}".`);
        const endpoint = connection.endpoints.find((each) => each.name === asked.endpoint);
        if (endpoint === undefined) throw new CallRefused(`The connection "${connection.name}" has no endpoint "${asked.endpoint}".`);
        if (!options.limits.take(`${options.workspaceId}/${options.appId}`)) throw new CallRefused(`The app has made ${CALLS_PER_MINUTE} calls this minute; try again in a moment.`);
        const started = Date.now();
        let status: number | string = 'failed';
        try {
            const answer = await callEndpoint(options.connections, connection, endpoint, asked.params ?? {}, options.guard ?? {}, signal);
            status = answer.status;
            return answerOf(endpoint, answer);
        } finally {
            options.report('Connection call', { workspace: options.workspaceId, app: options.appId, connection: connection.name, endpoint: endpoint.name, status, ms: Date.now() - started });
        }
    };
}
