import type { IncomingMessage, ServerResponse } from 'node:http';
import { report } from '@punyts/core';
import { msSince } from './reporting.js';
import type { OrgScim, ScimDirectory, ScimOutcome } from '../orgs/Scim.js';
import type { Orgs } from '../orgs/Orgs.js';
import { parseFilter } from '../scim/filter.js';
import type { FilterTerm } from '../scim/filter.js';
import { applyPatch, patchOperationsOf } from '../scim/patch.js';
import { GROUP_SCHEMA, groupInputOf, groupResourceOf, listOf, MAX_RESULTS, resourceTypes, schemas, ScimError, serviceProviderConfig, USER_SCHEMA, userInputOf, userResourceOf } from '../scim/schemas.js';
import { closeLostViews } from './orgRoutes.js';
import type { OrgRouteContext } from './orgRoutes.js';

/** What the SCIM routes work with */
export interface ScimRouteContext extends Pick<OrgRouteContext, 'access' | 'workspaces' | 'closeOrgViews'> {
    readonly orgs: Orgs;
    readonly scim: OrgScim;
    readonly directory: ScimDirectory;
    /** Magnetic's public origin, for the resources' locations */
    readonly origin: () => string;
}

/** The largest body taken */
export const MAX_SCIM_BYTES = 1024 * 1024;

const UUID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const ROUTE = new RegExp(`^/scim/v2/${UUID}(/.*)?$`);
const RESOURCE = /^\/(Users|Groups)(?:\/([^/]+))?$/;

/** A SCIM request as an operation for a report, such as `PATCH Users/:id`: never the id, a filter or an email */
function operationOf(method: string, rest: string): string {
    const [, kind = '', id] = /^\/([^/]*)(\/.+)?$/.exec(rest) ?? [];
    const known = ['Users', 'Groups', 'ServiceProviderConfig', 'ResourceTypes', 'Schemas'].includes(kind) ? kind : kind === '' ? '' : 'other';
    return `${method} ${known}${id === undefined ? '' : '/:id'}`;
}

function send(response: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
    response.writeHead(status, { 'Content-Type': 'application/scim+json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
    response.end(body === undefined ? undefined : JSON.stringify(body));
}

/** A SCIM body: `application/scim+json` or `application/json`, at most a megabyte */
async function readBody(request: IncomingMessage): Promise<unknown> {
    if (!/^application\/(scim\+)?json/i.test(request.headers['content-type'] ?? '')) throw new ScimError(415, 'Send application/scim+json.');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        size += buffer.length;
        if (size > MAX_SCIM_BYTES) throw new ScimError(413, 'The body is larger than a megabyte.', 'tooMany');
        chunks.push(buffer);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
        throw new ScimError(400, 'The body is not JSON.', 'invalidSyntax');
    }
}

/** A list's page: `startIndex` from 1, `count` up to the most one answer holds */
function pageOf(query: URLSearchParams): { readonly startIndex: number; readonly count: number } {
    const number = (name: string, fallback: number): number => {
        const raw = query.get(name);
        if (raw === null || raw === '') return fallback;
        const value = Number(raw);
        if (!Number.isInteger(value)) throw new ScimError(400, `${name} is not a whole number.`, 'invalidValue');
        return value;
    };
    return { startIndex: Math.max(1, number('startIndex', 1)), count: Math.min(MAX_RESULTS, Math.max(0, number('count', MAX_RESULTS))) };
}

const filterOf = (query: URLSearchParams): FilterTerm[] => {
    const filter = query.get('filter');
    return filter === null || filter.trim() === '' ? [] : parseFilter(filter);
};

/** Whether a read leaves a group's members out (Entra ID asks so) */
const withoutMembers = (query: URLSearchParams): boolean => (query.get('excludedAttributes') ?? '').split(',').some((name) => name.trim().toLowerCase() === 'members');

const notFound = (what: string): ScimError => new ScimError(404, `No such ${what}.`);

/**
 * SCIM 2.0 for an org's identity provider (docs/design/magnetic-scim.md): `<origin>/scim/v2/<orgId>/…` with the org's
 * bearer token. Users, Groups, and the three discovery documents. Bodies hold names and emails: they are never logged,
 * and refusals name attributes only. Answers whether it handled the request
 */
export function scimRoutes(context: ScimRouteContext): (request: IncomingMessage, response: ServerResponse, method: string, path: string, query: URLSearchParams) => Promise<boolean> {
    const { directory } = context;

    /** Closes the views a change ended: everything of the org for the removed, lost apps for those who left a group */
    async function closeViews(workspaceId: string, outcome: ScimOutcome): Promise<void> {
        for (const userId of outcome.removed) context.closeOrgViews(userId, 'all', 'Removed from org');
        if (outcome.regrouped.length > 0) await closeLostViews(context, workspaceId, outcome.regrouped);
    }

    async function users(request: IncomingMessage, response: ServerResponse, method: string, orgId: string, workspaceId: string, id: string | undefined, query: URLSearchParams, base: string): Promise<void> {
        if (id === undefined) {
            if (method === 'GET') {
                const { startIndex, count } = pageOf(query);
                const found = await directory.listUsers(orgId, filterOf(query), startIndex, count);
                send(response, 200, listOf(found.rows.map((row) => userResourceOf(row, base)), found.total, startIndex));
            } else if (method === 'POST') {
                const made = await directory.createUser(orgId, userInputOf(await readBody(request)));
                await closeViews(workspaceId, made.outcome);
                const resource = userResourceOf(made.row, base);
                send(response, 201, resource, { Location: `${base}/Users/${made.row.id}` });
            } else throw new ScimError(501, 'Not supported.');
            return;
        }
        if (method === 'GET') {
            const row = await directory.user(orgId, id);
            if (row === undefined) throw notFound('user');
            send(response, 200, userResourceOf(row, base));
        } else if (method === 'PUT' || method === 'PATCH') {
            const body = await readBody(request);
            let input;
            if (method === 'PATCH') {
                const operations = patchOperationsOf(body);
                const row = await directory.user(orgId, id);
                if (row === undefined) throw notFound('user');
                input = userInputOf(applyPatch(userResourceOf(row, base), operations, USER_SCHEMA));
            } else input = userInputOf(body);
            const changed = await directory.replaceUser(orgId, id, input);
            if (changed === undefined) throw notFound('user');
            await closeViews(workspaceId, changed.outcome);
            send(response, 200, userResourceOf(changed.row, base));
        } else if (method === 'DELETE') {
            const outcome = await directory.deleteUser(orgId, id);
            if (outcome === undefined) throw notFound('user');
            await closeViews(workspaceId, outcome);
            send(response, 204);
        } else throw new ScimError(501, 'Not supported.');
    }

    async function groups(request: IncomingMessage, response: ServerResponse, method: string, orgId: string, workspaceId: string, id: string | undefined, query: URLSearchParams, base: string): Promise<void> {
        const members = !withoutMembers(query);
        const resourceOfRow = async (row: Parameters<typeof groupResourceOf>[0]): Promise<Record<string, unknown>> => groupResourceOf(row, members ? (await directory.membersOf([row.id])).get(row.id) : undefined, base);
        if (id === undefined) {
            if (method === 'GET') {
                const { startIndex, count } = pageOf(query);
                const found = await directory.listGroups(orgId, filterOf(query), startIndex, count);
                const of = members ? await directory.membersOf(found.rows.map((row) => row.id)) : undefined;
                send(response, 200, listOf(found.rows.map((row) => groupResourceOf(row, of?.get(row.id), base)), found.total, startIndex));
            } else if (method === 'POST') {
                const made = await directory.createGroup(orgId, groupInputOf(await readBody(request)));
                await closeViews(workspaceId, made.outcome);
                send(response, 201, await resourceOfRow(made.row), { Location: `${base}/Groups/${made.row.id}` });
            } else throw new ScimError(501, 'Not supported.');
            return;
        }
        if (method === 'GET') {
            const row = await directory.group(orgId, id);
            if (row === undefined) throw notFound('group');
            send(response, 200, await resourceOfRow(row));
        } else if (method === 'PUT' || method === 'PATCH') {
            const body = await readBody(request);
            let input;
            if (method === 'PATCH') {
                const operations = patchOperationsOf(body);
                const row = await directory.group(orgId, id);
                if (row === undefined) throw notFound('group');
                input = groupInputOf(applyPatch(groupResourceOf(row, (await directory.membersOf([id])).get(id), base), operations, GROUP_SCHEMA));
            } else input = groupInputOf(body);
            const changed = await directory.replaceGroup(orgId, id, input);
            if (changed === undefined) throw notFound('group');
            await closeViews(workspaceId, changed.outcome);
            send(response, 200, await resourceOfRow(changed.row));
        } else if (method === 'DELETE') {
            const outcome = await directory.deleteGroup(orgId, id);
            if (outcome === undefined) throw notFound('group');
            await closeViews(workspaceId, outcome);
            send(response, 204);
        } else throw new ScimError(501, 'Not supported.');
    }

    async function handle(request: IncomingMessage, response: ServerResponse, method: string, orgId: string, rest: string, query: URLSearchParams): Promise<void> {
        const authorization = request.headers.authorization ?? '';
        const token = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1];
        if (token === undefined || !(await context.scim.accepts(orgId, token))) throw new ScimError(401, 'The token is not valid for this org.');
        const org = await context.orgs.get(orgId);
        if (org === undefined) throw new ScimError(401, 'The token is not valid for this org.');
        const base = `${context.origin()}/scim/v2/${orgId}`;
        if (method === 'GET' && rest === '/ServiceProviderConfig') return send(response, 200, serviceProviderConfig(base));
        if (method === 'GET' && rest === '/ResourceTypes') {
            const types = resourceTypes(base);
            return send(response, 200, listOf(types, types.length, 1));
        }
        if (method === 'GET' && rest.startsWith('/ResourceTypes/')) {
            const type = resourceTypes(base).find((each) => each['id'] === rest.slice('/ResourceTypes/'.length));
            if (type === undefined) throw notFound('resource type');
            return send(response, 200, type);
        }
        if (method === 'GET' && rest === '/Schemas') {
            const all = schemas(base);
            return send(response, 200, listOf(all, all.length, 1));
        }
        if (method === 'GET' && rest.startsWith('/Schemas/')) {
            const schema = schemas(base).find((each) => each['id'] === decodeURIComponent(rest.slice('/Schemas/'.length)));
            if (schema === undefined) throw notFound('schema');
            return send(response, 200, schema);
        }
        const match = RESOURCE.exec(rest);
        if (match === null) throw notFound('resource');
        const id = match[2] === undefined ? undefined : decodeURIComponent(match[2]);
        if (match[1] === 'Users') await users(request, response, method, orgId, org.workspaceId, id, query, base);
        else await groups(request, response, method, orgId, org.workspaceId, id, query, base);
    }

    return async (request, response, method, path, query) => {
        const match = ROUTE.exec(path);
        if (match === null) return false;
        const started = performance.now();
        const operation = operationOf(method, match[2] ?? '');
        try {
            await handle(request, response, method, match[1] as string, match[2] ?? '', query);
        } catch (error) {
            if (!(error instanceof ScimError)) {
                report('magnetic.scim', 'SCIM request', { org: match[1], operation, outcome: 'failed', ms: msSince(started) });
                throw error;
            }
            send(response, error.status, error.body, error.status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {});
        }
        report('magnetic.scim', 'SCIM request', { org: match[1], operation, status: response.statusCode, ms: msSince(started) });
        return true;
    };
}
