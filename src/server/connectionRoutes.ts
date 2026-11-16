import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Database } from '@punyts/stateui-pg';
import type { User } from '../accounts/Accounts.js';
import type { Connection, ConnectionAuth, Connections, Endpoint, Method } from '../connections/Connections.js';
import { METHODS } from '../connections/Connections.js';
import { CallRefused, guardedCall } from '../connections/guard.js';
import type { GuardOptions } from '../connections/guard.js';
import { callEndpoint } from '../connections/httpEffect.js';
import { connectionsPage } from '../http/connectionsPage.js';
import type { ManagedWorkspace } from '../http/connectionsPage.js';
import type { Said } from '../http/connectionText.js';
import type { PageLook } from '../http/pages.js';
import type { Orgs } from '../orgs/Orgs.js';

export interface ConnectionRouteContext {
    readonly db: Database;
    readonly connections: Connections;
    readonly orgs: Orgs;
    readonly guard: GuardOptions;
    /** Whether a workspace's apps may call out: an org's `connections` policy may turn it off; default yes */
    readonly allowed?: (workspaceId: string) => Promise<boolean>;
    readonly signedIn: (request: IncomingMessage) => Promise<{ readonly user: User } | undefined>;
    readonly readForm: (request: IncomingMessage) => Promise<URLSearchParams>;
    readonly lookOf: (request: IncomingMessage, userId: string) => Promise<PageLook>;
    readonly sendPage: (response: ServerResponse, html: string, status?: number) => void;
    readonly redirect: (response: ServerResponse, location: string) => void;
    /** Where the OAuth providers send the person back to: `<origin>/connections/oauth/callback` */
    readonly origin: () => string;
    readonly report: (message: string, fields?: Record<string, unknown>) => void;
}

/** How long an OAuth sign-in started with Connect may take */
const OAUTH_MINUTES = 10;
/** How much of a Try's answer the page shows */
const TRY_SHOWN = 4000;

const hashOf = (value: string): string => createHash('sha256').update(value).digest('base64url');

/**
 * `GET|POST /settings/connections` (`?w=<workspace>`): the connections of a workspace the person manages (their own,
 * or an org's they are an admin or owner of), made, changed, tried and deleted with plain forms; `POST … do=connect`
 * starts an OAuth sign-in and `GET /connections/oauth/callback` ends it. Answers true when it handled the request
 */
export function connectionRoutes(context: ConnectionRouteContext) {
    const { connections, orgs } = context;
    const redirectUri = (): string => `${context.origin()}/connections/oauth/callback`;

    /** The workspaces whose connections a person manages: their own, then their orgs' where they are an admin or owner */
    async function managed(user: User): Promise<ManagedWorkspace[]> {
        const own: ManagedWorkspace = { id: user.id, name: 'Yours', own: true };
        const theirs = (await orgs.of(user.id)).filter((org) => org.role === 'owner' || org.role === 'admin').map((org) => ({ id: org.workspaceId, name: org.name }));
        return [own, ...theirs];
    }

    async function show(
        response: ServerResponse,
        request: IncomingMessage,
        user: User,
        workspaceId: string,
        extra: { notice?: Said; error?: Said; tried?: { connection: string; endpoint: string; status: string; body: string }; continueTo?: { url: string; host: string } } = {},
        status = 200
    ): Promise<void> {
        const workspaces = await managed(user);
        const workspace = workspaces.find((each) => each.id === workspaceId) ?? (workspaces[0] as ManagedWorkspace);
        const off = context.allowed !== undefined && !(await context.allowed(workspace.id));
        context.sendPage(
            response,
            connectionsPage({ look: await context.lookOf(request, user.id), workspaces, workspace, connections: await connections.list(workspace.id), redirectUri: redirectUri(), off, ...extra }),
            status
        );
    }

    /** A connection of a workspace the person manages, or a refusal */
    async function connectionFor(user: User, workspaceId: string, id: string): Promise<Connection> {
        if (!(await managed(user)).some((each) => each.id === workspaceId)) throw new CallRefused('You do not manage the connections of that workspace.');
        const connection = await connections.byId(id);
        if (connection === undefined || connection.workspaceId !== workspaceId) throw new CallRefused('No such connection.');
        return connection;
    }

    function authFrom(form: URLSearchParams): ConnectionAuth {
        const text = (name: string): string => (form.get(name) ?? '').trim();
        switch (text('kind')) {
            case 'key':
                return { kind: 'key', in: text('keyIn') === 'query' ? 'query' : 'header', name: text('keyName') || 'Authorization', prefix: form.get('keyPrefix') ?? '' };
            case 'oauth-client':
                return { kind: 'oauth-client', tokenUrl: text('tokenUrl'), clientId: text('clientId'), scope: text('scope') };
            case 'oauth-code':
                return { kind: 'oauth-code', authorizeUrl: text('authorizeUrl'), tokenUrl: text('tokenUrl'), clientId: text('clientId'), scope: text('scope') };
            default:
                return { kind: 'none' };
        }
    }

    function endpointFrom(form: URLSearchParams): Endpoint {
        const method = (form.get('method') ?? 'GET').toUpperCase();
        const query = Object.fromEntries(
            (form.get('query') ?? '')
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line !== '')
                .map((line) => {
                    const at = line.indexOf('=');
                    return at < 0 ? [line, ''] : [line.slice(0, at).trim(), line.slice(at + 1).trim()];
                })
        );
        const bodyText = (form.get('body') ?? '').trim();
        let body: unknown;
        if (bodyText !== '') {
            try {
                body = JSON.parse(bodyText);
            } catch {
                throw new CallRefused('The body is not JSON.');
            }
        }
        return {
            name: (form.get('name') ?? '').trim(),
            method: ((METHODS as readonly string[]).includes(method) ? method : 'GET') as Method,
            path: (form.get('path') ?? '').trim(),
            query,
            ...(body !== undefined && { body }),
            records: (form.get('records') ?? '').trim()
        };
    }

    /** Makes the change a form asks for; what the page says after it */
    async function change(user: User, form: URLSearchParams): Promise<{ notice?: Said; tried?: { connection: string; endpoint: string; status: string; body: string }; continueTo?: { url: string; host: string } }> {
        const workspaceId = form.get('w') ?? user.id;
        const action = form.get('do') ?? '';
        if (action === 'create') {
            if (!(await managed(user)).some((each) => each.id === workspaceId)) throw new CallRefused('You do not manage the connections of that workspace.');
            const made = await connections.create(workspaceId, user.id, { name: (form.get('name') ?? '').trim(), baseUrl: form.get('baseUrl') ?? '', auth: authFrom(form) });
            const secret = (form.get('secret') ?? '').trim();
            if (secret !== '' && made.auth.kind !== 'none') await connections.setSecret(made.id, made.auth.kind === 'key' ? 'key' : 'clientSecret', secret);
            return { notice: { key: 'connections.made', values: { name: made.name } } };
        }
        const connection = await connectionFor(user, workspaceId, form.get('id') ?? '');
        switch (action) {
            case 'secret':
                await connections.setSecret(connection.id, form.get('field') === 'clientSecret' ? 'clientSecret' : 'key', form.get('value') ?? '');
                return { notice: { key: 'connections.kept' } };
            case 'update':
                await connections.update(connection.id, { baseUrl: form.get('baseUrl') ?? '', auth: authFrom(form) });
                return { notice: { key: 'connections.saved' } };
            case 'endpoint':
                await connections.setEndpoint(connection.id, endpointFrom(form));
                return { notice: { key: 'connections.endpointAdded' } };
            case 'removeEndpoint':
                await connections.removeEndpoint(connection.id, form.get('endpoint') ?? '');
                return { notice: { key: 'connections.endpointRemoved' } };
            case 'remove':
                if (form.get('confirm') !== 'yes') throw new CallRefused('Tick the box to delete it.');
                await connections.remove(connection.id);
                return { notice: { key: 'connections.deleted', values: { name: connection.name } } };
            case 'try': {
                const endpoint = connection.endpoints.find((each) => each.name === form.get('endpoint'));
                if (endpoint === undefined) throw new CallRefused('No such endpoint.');
                if (context.allowed !== undefined && !(await context.allowed(workspaceId))) throw new CallRefused('This organisation has turned connections off.');
                const params = Object.fromEntries(new URLSearchParams(form.get('params') ?? ''));
                const started = Date.now();
                let status = 'failed';
                try {
                    const answer = await callEndpoint(connections, connection, endpoint, params, context.guard);
                    status = String(answer.status);
                    const body = answer.body.length > TRY_SHOWN ? `${answer.body.slice(0, TRY_SHOWN)}…` : answer.body;
                    return { tried: { connection: connection.name, endpoint: endpoint.name, status, body } };
                } finally {
                    context.report('Connection tried', { workspace: workspaceId, connection: connection.name, endpoint: endpoint.name, status, ms: Date.now() - started });
                }
            }
            case 'connect': {
                if (connection.auth.kind !== 'oauth-code') throw new CallRefused('This connection does not sign in with Connect.');
                const state = randomBytes(32).toString('base64url');
                const verifier = randomBytes(32).toString('base64url');
                await context.db.query('DELETE FROM connection_oauth WHERE expires_at < now()');
                await context.db.query('INSERT INTO connection_oauth (state_hash, connection_id, user_id, verifier, expires_at) VALUES ($1, $2, $3, $4, $5)', [
                    hashOf(state),
                    connection.id,
                    user.id,
                    verifier,
                    new Date(Date.now() + OAUTH_MINUTES * 60_000)
                ]);
                const url = new URL(connection.auth.authorizeUrl);
                url.searchParams.set('response_type', 'code');
                url.searchParams.set('client_id', connection.auth.clientId);
                url.searchParams.set('redirect_uri', redirectUri());
                url.searchParams.set('state', state);
                url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
                url.searchParams.set('code_challenge_method', 'S256');
                if (connection.auth.scope !== undefined) url.searchParams.set('scope', connection.auth.scope);
                return { continueTo: { url: url.toString(), host: url.host } };
            }
            default:
                throw new CallRefused('Unknown change.');
        }
    }

    /** `GET /connections/oauth/callback`: the provider sends the person back with a code, exchanged for tokens once */
    async function callback(request: IncomingMessage, response: ServerResponse, user: User, url: URL): Promise<void> {
        const state = url.searchParams.get('state') ?? '';
        const pending = (
            await context.db.query<{ connection_id: string; user_id: string; verifier: string; expires_at: Date }>('DELETE FROM connection_oauth WHERE state_hash = $1 RETURNING connection_id, user_id, verifier, expires_at', [hashOf(state)])
        ).rows[0];
        const connection = pending === undefined ? undefined : await connections.byId(pending.connection_id);
        const workspaceId = connection?.workspaceId ?? user.id;
        if (pending === undefined || pending.user_id !== user.id || pending.expires_at.getTime() < Date.now() || connection === undefined || connection.auth.kind !== 'oauth-code') {
            await show(response, request, user, workspaceId, { error: { key: 'connections.stale' } }, 400);
            return;
        }
        const refused = url.searchParams.get('error');
        const code = url.searchParams.get('code');
        if (refused !== null || code === null) {
            await show(response, request, user, workspaceId, { error: { key: 'connections.providerRefused', values: { reason: refused ?? 'no code' } } }, 400);
            return;
        }
        try {
            const secrets = await connections.secretsOf(connection.id);
            const answer = await guardedCall(
                connection.auth.tokenUrl,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        grant_type: 'authorization_code',
                        code,
                        redirect_uri: redirectUri(),
                        client_id: connection.auth.clientId,
                        code_verifier: pending.verifier,
                        ...(secrets.clientSecret !== undefined && { client_secret: secrets.clientSecret })
                    }).toString()
                },
                context.guard
            );
            const body = JSON.parse(answer.body || '{}') as Record<string, unknown>;
            if (answer.status !== 200 || typeof body['access_token'] !== 'string') throw new CallRefused(`The provider refused the code (${typeof body['error'] === 'string' ? body['error'] : answer.status}).`);
            const expiresIn = typeof body['expires_in'] === 'number' ? body['expires_in'] : undefined;
            await connections.saveTokens(connection.id, {
                accessToken: body['access_token'],
                ...(typeof body['refresh_token'] === 'string' && { refreshToken: body['refresh_token'] }),
                ...(expiresIn !== undefined && { expiresAt: new Date(Date.now() + Math.max(0, expiresIn - 30) * 1000).toISOString() })
            });
            context.report('Connection connected', { workspace: workspaceId, connection: connection.name });
            await show(response, request, user, workspaceId, { notice: { key: 'connections.connected', values: { name: connection.name } } });
        } catch (error) {
            await show(response, request, user, workspaceId, { error: error instanceof CallRefused ? error.message : { key: 'connections.notFinished' } }, 400);
        }
    }

    return async (request: IncomingMessage, response: ServerResponse, method: string, path: string): Promise<boolean> => {
        if (path !== '/settings/connections' && path !== '/connections/oauth/callback') return false;
        const who = await context.signedIn(request);
        if (who === undefined) {
            context.redirect(response, `/signin?next=${encodeURIComponent('/settings/connections')}`);
            return true;
        }
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (path === '/connections/oauth/callback' && method === 'GET') {
            await callback(request, response, who.user, url);
            return true;
        }
        if (method === 'GET') {
            await show(response, request, who.user, url.searchParams.get('w') ?? who.user.id);
            return true;
        }
        if (method === 'POST') {
            const form = await context.readForm(request);
            const workspaceId = form.get('w') ?? who.user.id;
            try {
                await show(response, request, who.user, workspaceId, await change(who.user, form));
            } catch (error) {
                if (!(error instanceof CallRefused)) throw error;
                await show(response, request, who.user, workspaceId, { error: error.message }, 400);
            }
            return true;
        }
        return false;
    };
}
