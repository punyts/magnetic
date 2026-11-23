import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GrantRight } from '@punyts/state-sync/authority';
import type { Database } from '@punyts/stateui-pg';
import type { User } from '../accounts/Accounts.js';
import type { OwnerKeys } from '../grants/OwnerKeys.js';
import { subjectName, type StateGrants } from '../grants/StateGrants.js';
import { Permissions, type Permission } from '../permissions/Permissions.js';
import { sharedPage } from '../http/orgSettings.js';
import { orgTextsOf } from '../http/orgText.js';
import type { PageLook } from '../http/pages.js';
import { OrgError } from '../orgs/Orgs.js';
import type { OwnerNumbers } from '../statenet/OwnerNumbers.js';
import type { Orgs } from '../orgs/Orgs.js';

export interface GrantRouteContext {
    readonly db: Database;
    /** Absent when the server cannot sign (no `MAGNETIC_SECRET_KEY`) */
    readonly grants: StateGrants | undefined;
    readonly keys: OwnerKeys;
    readonly orgs: Orgs;
    /** The numbers owners go by in grants and beside their keys */
    readonly owners: OwnerNumbers;
    readonly signedIn: (request: IncomingMessage) => Promise<{ user: User } | undefined>;
    readonly readJson: (request: IncomingMessage) => Promise<unknown>;
    readonly readForm: (request: IncomingMessage) => Promise<URLSearchParams>;
    readonly sendJson: (response: ServerResponse, status: number, body: unknown) => void;
    readonly sendPage: (response: ServerResponse, html: string, status?: number) => void;
    readonly redirect: (response: ServerResponse, location: string) => void;
    readonly lookOf: (request: IncomingMessage, userId: string) => Promise<PageLook>;
    /** Tells the relays of revoked grant ids, each with when its tokens would have expired */
    readonly revoked?: (grants: ReadonlyArray<{ id: string; expires: number }>) => void;
}

/** Said when the server keeps no keys */
export const GRANTS_UNAVAILABLE = 'Sharing state needs MAGNETIC_SECRET_KEY on the server, which keeps the signing keys.';

const GRANT = /^\/grants\/([0-9a-fA-F-]{36})\/(token|revoke)$/;
const ORG_ROTATE = /^\/orgs\/([0-9a-fA-F-]{36})\/keys\/rotate$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Grants over HTTP (docs/design/statenet-permissions.md, "Tokens" and "Pages"): `GET /grants` (Shared by me, as JSON),
 * `POST /grants` (share part of your state, or pass on part of a grant you hold), `POST /grants/<id>/token` (a fresh
 * short-lived token, for the grant's subject or issuer), `POST /grants/<id>/revoke`, `POST /keys/rotate` (your own
 * signing key) and `POST /orgs/<id>/keys/rotate` (an org owner, the org's). `GET /settings/shared` is the Shared by me
 * page, whose Revoke posts to `/settings/shared`
 */
export function grantRoutes(context: GrantRouteContext): (request: IncomingMessage, response: ServerResponse, method: string, path: string, query: URLSearchParams) => Promise<boolean> {
    const { grants } = context;

    /** The names Shared by me shows: people and orgs by number, groups by id, and the apps the person can read */
    async function namesOf(user: User, entries: readonly Permission[]): Promise<{ names: Map<string, string>; apps: Map<string, string> }> {
        const numbers = new Set<string>();
        const groups = new Set<string>();
        for (const entry of entries) {
            const subject = /^(?:owner|members|group):([0-9]+)(?:\.(.+))?$/.exec(entry.subject);
            if (subject === null) continue;
            numbers.add(subject[1] as string);
            if (entry.subject.startsWith('group:') && subject[2] !== undefined) groups.add(subject[2]);
        }
        const names = new Map<string, string>();
        for (const row of (await context.db.query<{ number: string; name: string }>('SELECT owner_number::text AS number, name FROM app_user WHERE owner_number::text = ANY($1::text[])', [[...numbers]])).rows) names.set(`owner:${row.number}`, row.name);
        for (const row of (await context.db.query<{ number: string; name: string }>('SELECT owner_number::text AS number, name FROM org WHERE owner_number::text = ANY($1::text[])', [[...numbers]])).rows) {
            names.set(`owner:${row.number}`, row.name);
            names.set(`org:${row.number}`, row.name);
        }
        for (const row of (await context.db.query<{ id: string; name: string }>('SELECT id::text, name FROM org_group WHERE id::text = ANY($1::text[])', [[...groups]])).rows) names.set(`group:${row.id}`, row.name);
        // An app's name is behind row-level security: Shared by me shows the names of the person's own apps and their orgs' apps
        const appIds = [...new Set(entries.map((entry) => entry.pattern.split('.')[2] ?? ''))].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
        const workspaceIds = [user.id, ...(await context.db.query<{ id: string }>("SELECT w.id::text FROM workspace w JOIN org_member m ON m.org_id = w.org_id WHERE m.user_id = $1 AND w.kind = 'org'", [user.id])).rows.map((row) => row.id)];
        const apps = new Map(
            await context.db.transaction(
                async (tx) => (await tx.query<{ id: string; name: string }>("SELECT id::text, name FROM part WHERE kind = 'apps' AND id::text = ANY($1::text[])", [appIds])).rows.map((row) => [row.id, row.name] as const),
                { workspaceIds }
            )
        );
        return { names, apps };
    }

    async function showShared(request: IncomingMessage, response: ServerResponse, user: User, extra: { notice?: string; error?: string } = {}, status = 200): Promise<void> {
        const look = await context.lookOf(request, user.id);
        const entries = grants === undefined ? [] : await grants.sharedBy(user.id);
        const { names, apps } = await namesOf(user, entries);
        context.sendPage(response, sharedPage({ look, entries, names, apps, ...extra, ...(grants === undefined && { error: GRANTS_UNAVAILABLE }) }), status);
    }

    async function handle(request: IncomingMessage, response: ServerResponse, method: string, path: string, query: URLSearchParams, user: User): Promise<boolean> {
        if (path === '/settings/shared') {
            if (method === 'GET') {
                await showShared(request, response, user, query.has('done') ? { notice: orgTextsOf((await context.lookOf(request, user.id)).language)['shared.done'] } : {});
                return true;
            }
            if (method !== 'POST') return false;
            const form = await context.readForm(request);
            try {
                if (grants === undefined) throw new OrgError(409, GRANTS_UNAVAILABLE);
                context.revoked?.(await grants.revoke(user.id, form.get('id') ?? ''));
                context.redirect(response, '/settings/shared?done');
            } catch (error) {
                if (!(error instanceof OrgError)) throw error;
                await showShared(request, response, user, { error: error.message }, error.status);
            }
            return true;
        }
        if (path === '/grants') {
            if (method === 'GET') {
                context.sendJson(response, 200, { available: grants !== undefined, grants: grants === undefined ? [] : await grants.sharedBy(user.id) });
                return true;
            }
            if (method !== 'POST') return false;
            if (grants === undefined) throw new OrgError(409, GRANTS_UNAVAILABLE);
            const body = await context.readJson(request);
            if (!isRecord(body)) throw new OrgError(400, 'Send { subject, address, prefix, rights }.');
            const rights = Array.isArray(body['rights']) ? body['rights'].filter((right): right is GrantRight => right === 'read' || right === 'write') : [];
            const issued = await grants.issue({
                issuer: user.id,
                subject: String(body['subject'] ?? ''),
                address: String(body['address'] ?? ''),
                prefix: typeof body['prefix'] === 'string' ? body['prefix'] : '$',
                rights,
                ...(typeof body['lifeMs'] === 'number' && { lifeMs: body['lifeMs'] }),
                ...(typeof body['parentId'] === 'string' && { parentId: body['parentId'] })
            });
            context.sendJson(response, 201, issued);
            return true;
        }
        let match = GRANT.exec(path);
        if (match !== null && method === 'POST') {
            if (grants === undefined) throw new OrgError(409, GRANTS_UNAVAILABLE);
            const id = (match[1] as string).toLowerCase();
            if (match[2] === 'token') {
                // a grant names who gave it and who holds it by their numbers
                const entry = await new Permissions(context.db).get(id);
                const parent = entry?.parent === undefined ? undefined : await new Permissions(context.db).get(entry.parent);
                const me = await context.owners.nameOf(user.id);
                const issuer = entry === undefined ? undefined : parent === undefined ? entry.owner : subjectName(parent.subject);
                if (entry === undefined || (subjectName(entry.subject) !== me && issuer !== me)) throw new OrgError(404, 'No such grant.');
                context.sendJson(response, 200, { token: await grants.tokenFor(id) });
            } else {
                const revoked = await grants.revoke(user.id, id);
                context.revoked?.(revoked);
                context.sendJson(response, 200, { revoked: revoked.map((each) => each.id) });
            }
            return true;
        }
        if (path === '/keys/rotate' && method === 'POST') {
            if (!context.keys.available) throw new OrgError(409, GRANTS_UNAVAILABLE);
            context.sendJson(response, 200, { kid: await context.keys.rotate(await context.owners.nameOf(user.id)) });
            return true;
        }
        match = ORG_ROTATE.exec(path);
        if (match !== null && method === 'POST') {
            if (!context.keys.available) throw new OrgError(409, GRANTS_UNAVAILABLE);
            const orgId = match[1] as string;
            await context.orgs.require(orgId, user.id, 'owner');
            const org = await context.orgs.get(orgId);
            if (org === undefined) throw new OrgError(404, 'No such org.');
            context.sendJson(response, 200, { kid: await context.keys.rotate(await context.owners.nameOf(org.workspaceId)) });
            return true;
        }
        return false;
    }

    return async (request, response, method, path, query) => {
        if (path !== '/settings/shared' && path !== '/grants' && !GRANT.test(path) && path !== '/keys/rotate' && !ORG_ROTATE.test(path)) return false;
        const who = await context.signedIn(request);
        if (who === undefined) {
            if (method === 'GET' && path === '/settings/shared') context.redirect(response, `/signin?next=${encodeURIComponent(path)}`);
            else context.sendJson(response, 401, { message: 'Sign in first.' });
            return true;
        }
        try {
            return await handle(request, response, method, path, query, who.user);
        } catch (error) {
            if (!(error instanceof OrgError)) throw error;
            context.sendJson(response, error.status, { message: error.message });
            return true;
        }
    };
}
