import { randomUUID } from 'node:crypto';
import type { Database } from '@punyts/stateui-pg';
import type { SecretBox } from '../auth/secrets.js';
import { CallRefused, checkUrl } from './guard.js';
import type { GuardOptions } from './guard.js';

/** How a connection signs in to its API; the secret parts are kept apart, sealed */
export type ConnectionAuth =
    | { readonly kind: 'none' }
    /** A static key, in a header (such as Authorization with a "Bearer " prefix, or X-API-Key) or in the query */
    | { readonly kind: 'key'; readonly in: 'header' | 'query'; readonly name: string; readonly prefix?: string }
    /** OAuth 2 client credentials: the server gets a token with the client id and secret */
    | { readonly kind: 'oauth-client'; readonly tokenUrl: string; readonly clientId: string; readonly scope?: string }
    /** OAuth 2 authorization code with refresh: someone signs in at the provider once, with Connect */
    | { readonly kind: 'oauth-code'; readonly authorizeUrl: string; readonly tokenUrl: string; readonly clientId: string; readonly scope?: string };

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type Method = (typeof METHODS)[number];

/** One call a connection offers apps, by name: `{param}` in the path, query values and body strings is filled from the request's params */
export interface Endpoint {
    readonly name: string;
    readonly method: Method;
    /** From the base URL's path on, such as /forecast/{city} */
    readonly path: string;
    readonly query?: Readonly<Record<string, string>>;
    /** A JSON body for POST, PUT and PATCH */
    readonly body?: unknown;
    /** Where the records are in the answer, as a dotted path (`data.items`); the answer is the value without one */
    readonly records?: string;
}

/** A connection as the page and the agent see it: no secret, only whether each is set */
export interface Connection {
    readonly id: string;
    readonly workspaceId: string;
    readonly name: string;
    readonly baseUrl: string;
    readonly auth: ConnectionAuth;
    readonly endpoints: readonly Endpoint[];
    readonly keySet: boolean;
    readonly clientSecretSet: boolean;
    /** An oauth-code connection someone has signed in for */
    readonly connected: boolean;
    readonly updatedAt: string;
}

/** The secrets of a connection, opened only on the server */
export interface ConnectionSecrets {
    key?: string;
    clientSecret?: string;
    accessToken?: string;
    refreshToken?: string;
    /** ISO time the access token stops working */
    expiresAt?: string;
}

const NAME = /^[a-z][a-z0-9-]{0,39}$/;
const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
const MAX_ENDPOINTS = 40;

/** A connection or endpoint name: lower-case letters, digits and dashes, starting with a letter */
export function isConnectionName(name: string): boolean {
    return NAME.test(name);
}

interface Row {
    id: string;
    workspace_id: string;
    name: string;
    base_url: string;
    auth: ConnectionAuth;
    secrets: string | null;
    endpoints: Endpoint[];
    updated_at: Date;
}

/**
 * The connections of each workspace. Their secrets are sealed with the server's key (`SecretBox`); without one, a
 * connection can still be made with no sign-in, but no key or client secret can be kept
 */
export class Connections {
    constructor(
        private readonly db: Database,
        private readonly box: SecretBox | undefined,
        private readonly guard: GuardOptions = {}
    ) {}

    private view(row: Row): Connection {
        const secrets = this.open(row.secrets);
        return {
            id: row.id,
            workspaceId: row.workspace_id,
            name: row.name,
            baseUrl: row.base_url,
            auth: row.auth,
            endpoints: row.endpoints,
            keySet: secrets.key !== undefined,
            clientSecretSet: secrets.clientSecret !== undefined,
            connected: secrets.refreshToken !== undefined || (row.auth.kind === 'oauth-code' && secrets.accessToken !== undefined),
            updatedAt: row.updated_at.toISOString()
        };
    }

    private open(sealed: string | null): ConnectionSecrets {
        if (sealed === null || this.box === undefined) return {};
        try {
            return JSON.parse(this.box.open(sealed)) as ConnectionSecrets;
        } catch {
            return {};
        }
    }

    private seal(secrets: ConnectionSecrets): string | null {
        if (Object.keys(secrets).length === 0) return null;
        if (this.box === undefined) throw new CallRefused('This server has no secret key (MAGNETIC_SECRET_KEY), so it cannot keep a connection\'s secrets.');
        return this.box.seal(JSON.stringify(secrets));
    }

    async list(workspaceId: string): Promise<Connection[]> {
        return (await this.db.query<Row>('SELECT * FROM connection WHERE workspace_id = $1 ORDER BY name', [workspaceId])).rows.map((row) => this.view(row));
    }

    async get(workspaceId: string, name: string): Promise<Connection | undefined> {
        const row = (await this.db.query<Row>('SELECT * FROM connection WHERE workspace_id = $1 AND name = $2', [workspaceId, name])).rows[0];
        return row === undefined ? undefined : this.view(row);
    }

    async byId(id: string): Promise<Connection | undefined> {
        const row = (await this.db.query<Row>('SELECT * FROM connection WHERE id = $1', [id])).rows[0];
        return row === undefined ? undefined : this.view(row);
    }

    /** The secrets of a connection, for the server's own calls; never sent anywhere else */
    async secretsOf(id: string): Promise<ConnectionSecrets> {
        return this.open((await this.db.query<{ secrets: string | null }>('SELECT secrets FROM connection WHERE id = $1', [id])).rows[0]?.secrets ?? null);
    }

    /** Makes a connection: a name, an https base URL and how it signs in */
    async create(workspaceId: string, userId: string, input: { readonly name: string; readonly baseUrl: string; readonly auth: ConnectionAuth }): Promise<Connection> {
        if (!NAME.test(input.name)) throw new CallRefused('A connection name is lower-case letters, digits and dashes, starting with a letter.');
        const baseUrl = this.baseUrlOf(input.baseUrl);
        const auth = this.authOf(input.auth);
        const id = randomUUID();
        const made = await this.db.query('INSERT INTO connection (id, workspace_id, name, base_url, auth, created_by) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (workspace_id, name) DO NOTHING', [
            id,
            workspaceId,
            input.name,
            baseUrl,
            JSON.stringify(auth),
            userId
        ]);
        if (made.rowCount === 0) throw new CallRefused('There is a connection with that name already.');
        return (await this.byId(id)) as Connection;
    }

    /** Changes the base URL and the sign-in; a change of sign-in kind forgets the old secrets */
    async update(id: string, input: { readonly baseUrl: string; readonly auth: ConnectionAuth }): Promise<void> {
        const current = await this.byId(id);
        if (current === undefined) throw new CallRefused('No such connection.');
        const auth = this.authOf(input.auth);
        const forget = auth.kind !== current.auth.kind;
        await this.db.query(`UPDATE connection SET base_url = $2, auth = $3, ${forget ? 'secrets = NULL, ' : ''}updated_at = now() WHERE id = $1`, [id, this.baseUrlOf(input.baseUrl), JSON.stringify(auth)]);
    }

    /** Keeps a secret (the key or the client secret), sealed; an empty value takes it out */
    async setSecret(id: string, field: 'key' | 'clientSecret', value: string): Promise<void> {
        const secrets = await this.secretsOf(id);
        if (value.trim() === '') delete secrets[field];
        else secrets[field] = value.trim();
        if (field === 'clientSecret') {
            delete secrets.accessToken;
            delete secrets.refreshToken;
            delete secrets.expiresAt;
        }
        await this.db.query('UPDATE connection SET secrets = $2, updated_at = now() WHERE id = $1', [id, this.seal(secrets)]);
    }

    /** Keeps the tokens an OAuth sign-in or refresh gave */
    async saveTokens(id: string, tokens: { readonly accessToken: string; readonly refreshToken?: string; readonly expiresAt?: string }): Promise<void> {
        const secrets = await this.secretsOf(id);
        secrets.accessToken = tokens.accessToken;
        if (tokens.refreshToken !== undefined) secrets.refreshToken = tokens.refreshToken;
        if (tokens.expiresAt !== undefined) secrets.expiresAt = tokens.expiresAt;
        else delete secrets.expiresAt;
        await this.db.query('UPDATE connection SET secrets = $2, updated_at = now() WHERE id = $1', [id, this.seal(secrets)]);
    }

    /** Adds an endpoint, or replaces the one of the same name */
    async setEndpoint(id: string, endpoint: Endpoint): Promise<void> {
        const checked = this.endpointOf(endpoint);
        const current = await this.byId(id);
        if (current === undefined) throw new CallRefused('No such connection.');
        const endpoints = [...current.endpoints.filter((each) => each.name !== checked.name), checked].sort((a, b) => a.name.localeCompare(b.name));
        if (endpoints.length > MAX_ENDPOINTS) throw new CallRefused(`A connection has at most ${MAX_ENDPOINTS} endpoints.`);
        await this.db.query('UPDATE connection SET endpoints = $2, updated_at = now() WHERE id = $1', [id, JSON.stringify(endpoints)]);
    }

    async removeEndpoint(id: string, name: string): Promise<void> {
        const current = await this.byId(id);
        if (current === undefined) return;
        await this.db.query('UPDATE connection SET endpoints = $2, updated_at = now() WHERE id = $1', [id, JSON.stringify(current.endpoints.filter((each) => each.name !== name))]);
    }

    async remove(id: string): Promise<void> {
        await this.db.query('DELETE FROM connection WHERE id = $1', [id]);
    }

    private baseUrlOf(text: string): string {
        const url = checkUrl(text.trim(), this.guard);
        if (url.search !== '' || url.hash !== '') throw new CallRefused('A base URL has no query or fragment: put those in an endpoint.');
        return url.toString().replace(/\/+$/, '');
    }

    private authOf(auth: ConnectionAuth): ConnectionAuth {
        switch (auth.kind) {
            case 'none':
                return { kind: 'none' };
            case 'key':
                if (!HEADER_NAME.test(auth.name)) throw new CallRefused('Name the header or query parameter the key goes in, such as Authorization or api_key.');
                return { kind: 'key', in: auth.in === 'query' ? 'query' : 'header', name: auth.name, ...(auth.prefix !== undefined && auth.prefix !== '' && { prefix: auth.prefix.slice(0, 40) }) };
            case 'oauth-client':
                checkUrl(auth.tokenUrl, this.guard);
                if (auth.clientId.trim() === '') throw new CallRefused('Give the client id.');
                return { kind: 'oauth-client', tokenUrl: auth.tokenUrl, clientId: auth.clientId.trim(), ...(auth.scope !== undefined && auth.scope.trim() !== '' && { scope: auth.scope.trim() }) };
            case 'oauth-code':
                checkUrl(auth.authorizeUrl, this.guard);
                checkUrl(auth.tokenUrl, this.guard);
                if (auth.clientId.trim() === '') throw new CallRefused('Give the client id.');
                return { kind: 'oauth-code', authorizeUrl: auth.authorizeUrl, tokenUrl: auth.tokenUrl, clientId: auth.clientId.trim(), ...(auth.scope !== undefined && auth.scope.trim() !== '' && { scope: auth.scope.trim() }) };
            default:
                throw new CallRefused('A sign-in is none, key, oauth-client or oauth-code.');
        }
    }

    private endpointOf(endpoint: Endpoint): Endpoint {
        if (!NAME.test(endpoint.name)) throw new CallRefused('An endpoint name is lower-case letters, digits and dashes, starting with a letter.');
        if (!(METHODS as readonly string[]).includes(endpoint.method)) throw new CallRefused('A method is GET, POST, PUT, PATCH or DELETE.');
        const path = endpoint.path.trim() === '' ? '/' : endpoint.path.trim();
        if (!path.startsWith('/') || path.includes('//') || /(^|\/)\.\.?(\/|$)/.test(path) || /[?#\s]/.test(path)) throw new CallRefused('A path starts with / and has no query, fragment, spaces or dot segments; put the query in its own fields.');
        for (const name of templateNames(path)) if (!PARAM_NAME.test(name)) throw new CallRefused(`{${name}} is not a parameter name.`);
        const query = Object.fromEntries(Object.entries(endpoint.query ?? {}).filter(([key]) => key.trim() !== '').map(([key, value]) => [key.trim(), String(value)]));
        return {
            name: endpoint.name,
            method: endpoint.method,
            path,
            ...(Object.keys(query).length > 0 && { query }),
            ...(endpoint.body !== undefined && endpoint.method !== 'GET' && endpoint.method !== 'DELETE' && { body: endpoint.body }),
            ...(endpoint.records !== undefined && endpoint.records.trim() !== '' && { records: endpoint.records.trim() })
        };
    }
}

/** The `{param}` names in a template */
export function templateNames(template: string): string[] {
    return [...template.matchAll(/\{([^{}]*)\}/g)].map((match) => match[1] as string);
}
