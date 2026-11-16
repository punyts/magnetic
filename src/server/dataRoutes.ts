import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Services } from '@punyts/stateui-mcp';
import type { Database } from '@punyts/stateui-pg';
import type { User } from '../accounts/Accounts.js';
import type { StateGrants } from '../grants/StateGrants.js';
import { datasetAddress, datasetOf } from '../grants/StateGrants.js';
import type { ManagedWorkspace } from '../http/connectionsPage.js';
import { dataPage, principalName } from '../http/dataPage.js';
import type { OwnDataset, Principal, SharedDataset } from '../http/dataPage.js';
import { dataTextsOf } from '../http/dataText.js';
import type { DataSaid, DataTextKey } from '../http/dataText.js';
import type { PageLook } from '../http/pages.js';
import { OrgError } from '../orgs/Orgs.js';
import type { Orgs } from '../orgs/Orgs.js';
import type { SharedData } from '../sharing/SharedData.js';

export interface DataRouteContext {
    readonly db: Database;
    readonly orgs: Orgs;
    /** Absent when the server has no signing key: the page lists, and nothing can be shared */
    readonly grants?: StateGrants;
    readonly sharedData?: SharedData;
    /** A workspace's services, to list its datasets */
    readonly workspace: (workspaceId: string) => Promise<Services>;
    readonly signedIn: (request: IncomingMessage) => Promise<{ readonly user: User } | undefined>;
    readonly readForm: (request: IncomingMessage) => Promise<URLSearchParams>;
    readonly lookOf: (request: IncomingMessage, userId: string) => Promise<PageLook>;
    readonly sendPage: (response: ServerResponse, html: string, status?: number) => void;
    readonly redirect: (response: ServerResponse, location: string) => void;
    readonly report: (message: string, fields?: Record<string, unknown>) => void;
}

/** A refusal the page shows in the person's language */
class Refused extends Error {
    constructor(readonly said: DataSaid) {
        super(typeof said === 'string' ? said : said.key);
    }
}

const refused = (key: DataTextKey, values?: Record<string, string>): Refused => new Refused({ key, ...(values !== undefined && { values }) });

/** Who ids name: an org's workspace (its org's name) or a person (their name and email) */
export async function principalsOf(db: Database, ids: readonly string[]): Promise<Map<string, Principal>> {
    const found = new Map<string, Principal>();
    const unique = [...new Set(ids)];
    if (unique.length === 0) return found;
    for (const row of (await db.query<{ id: string; name: string }>('SELECT w.id::text AS id, o.name FROM workspace w JOIN org o ON o.id = w.org_id WHERE w.id::text = ANY($1::text[])', [unique])).rows) {
        found.set(row.id, { id: row.id, name: row.name, org: true });
    }
    for (const row of (await db.query<{ id: string; name: string; email: string | null }>('SELECT id::text AS id, name, email FROM app_user WHERE id::text = ANY($1::text[])', [unique])).rows) {
        if (!found.has(row.id)) found.set(row.id, { id: row.id, name: row.name, ...(row.email !== null && { email: row.email }) });
    }
    for (const id of unique) if (!found.has(id)) found.set(id, { id, name: id });
    return found;
}

/**
 * `GET|POST /settings/data` (`?w=<workspace>`): the datasets of a workspace the person manages (their own, or an
 * org's they are an admin or owner of), each with whom it is shared, shared by a person's verified email or an org's
 * short name and stopped with plain forms; and the datasets other owners shared with the workspace
 * (docs/design/magnetic-shared-data.md). Answers true when it handled the request
 */
export function dataRoutes(context: DataRouteContext) {
    const { db, orgs, grants } = context;

    async function managed(user: User): Promise<ManagedWorkspace[]> {
        const own: ManagedWorkspace = { id: user.id, name: 'Yours', own: true };
        const theirs = (await orgs.of(user.id)).filter((org) => org.role === 'owner' || org.role === 'admin').map((org) => ({ id: org.workspaceId, name: org.name }));
        return [own, ...theirs];
    }

    async function datasetsOf(workspaceId: string): Promise<OwnDataset[]> {
        const services = await context.workspace(workspaceId);
        const shares = grants === undefined ? [] : await grants.datasetShares(workspaceId);
        const people = await principalsOf(
            db,
            shares.map((share) => share.subject)
        );
        const summaries = await services.parts.list('data');
        const datasets: OwnDataset[] = [];
        for (const summary of [...summaries].sort((a, b) => a.name.localeCompare(b.name))) {
            const part = await services.parts.findByName('data', summary.name);
            if (part === undefined) continue;
            const body = part.body as { model?: string; records?: Record<string, unknown> };
            datasets.push({
                name: summary.name,
                model: body.model ?? '',
                count: Object.keys(body.records ?? {}).length,
                shares: shares.filter((share) => datasetOf(share.address)?.dataset === summary.name).map((share) => ({ id: share.id, with: people.get(share.subject) as Principal }))
            });
        }
        return datasets;
    }

    async function sharedWith(workspaceId: string): Promise<SharedDataset[]> {
        if (grants === undefined) return [];
        const shares = await grants.datasetsSharedWith(workspaceId);
        const owners = await principalsOf(
            db,
            shares.map((share) => datasetOf(share.address)?.owner ?? '')
        );
        const seen = new Set<string>();
        return shares.flatMap((share) => {
            const data = datasetOf(share.address);
            if (data === undefined || seen.has(share.address)) return [];
            seen.add(share.address);
            return [{ dataset: data.dataset, owner: owners.get(data.owner) as Principal }];
        });
    }

    async function show(response: ServerResponse, request: IncomingMessage, user: User, workspaceId: string, extra: { notice?: DataSaid; error?: DataSaid } = {}, status = 200): Promise<void> {
        const workspaces = await managed(user);
        const workspace = workspaces.find((each) => each.id === workspaceId) ?? (workspaces[0] as ManagedWorkspace);
        context.sendPage(
            response,
            dataPage({ look: await context.lookOf(request, user.id), workspaces, workspace, datasets: await datasetsOf(workspace.id), sharedWithUs: await sharedWith(workspace.id), canShare: grants !== undefined, ...extra }),
            status
        );
    }

    /** The workspace a person's words name: a person by verified email, or an org by short name */
    async function recipient(to: string): Promise<Principal> {
        if (to.includes('@')) {
            const row = (await db.query<{ id: string; name: string; email: string }>('SELECT id::text AS id, name, email FROM app_user WHERE lower(email) = lower($1) AND email_verified ORDER BY created_at LIMIT 1', [to])).rows[0];
            if (row === undefined) throw refused('data.noPerson', { to });
            return { id: row.id, name: row.name, email: row.email };
        }
        const row = (await db.query<{ id: string; name: string }>('SELECT w.id::text AS id, o.name FROM org o JOIN workspace w ON w.org_id = o.id WHERE o.slug = lower($1)', [to])).rows[0];
        if (row === undefined) throw refused('data.noOrg', { to });
        return { id: row.id, name: row.name, org: true };
    }

    async function change(request: IncomingMessage, user: User, form: URLSearchParams): Promise<DataSaid> {
        const workspaceId = form.get('w') ?? user.id;
        if (!(await managed(user)).some((each) => each.id === workspaceId)) throw refused('data.notManaged');
        if (grants === undefined) throw refused('data.unavailable');
        const t = dataTextsOf((await context.lookOf(request, user.id)).language);
        switch (form.get('do')) {
            case 'share': {
                const dataset = (form.get('dataset') ?? '').trim();
                const to = (form.get('to') ?? '').trim();
                const services = await context.workspace(workspaceId);
                if ((await services.parts.findByName('data', dataset)) === undefined) throw refused('data.noDataset', { dataset });
                const subject = await recipient(to);
                if (subject.id === workspaceId) throw refused('data.self');
                const name = principalName(t, subject);
                if ((await grants.datasetShare(subject.id, workspaceId, dataset)) !== undefined) return { key: 'data.already', values: { dataset, name } };
                await grants.issue({ issuer: workspaceId, subject: subject.id, address: datasetAddress(workspaceId, dataset), prefix: '$', rights: ['read'], standing: true, by: user.id });
                context.report('Dataset shared', { workspace: workspaceId, dataset, with: subject.id });
                return { key: 'data.shared', values: { dataset, name } };
            }
            case 'stop': {
                const id = form.get('id') ?? '';
                const share = (await grants.datasetShares(workspaceId)).find((each) => each.id === id);
                const data = share === undefined ? undefined : datasetOf(share.address);
                if (share === undefined || data === undefined) throw refused('data.noShare');
                const revoked = await grants.revoke(workspaceId, id, new Date(), user.id);
                context.sharedData?.revoked(revoked);
                const name = principalName(t, (await principalsOf(db, [share.subject])).get(share.subject) as Principal);
                context.report('Dataset share stopped', { workspace: workspaceId, dataset: data.dataset, with: share.subject });
                return { key: 'data.stopped', values: { dataset: data.dataset, name } };
            }
            default:
                throw refused('data.unknown');
        }
    }

    return async (request: IncomingMessage, response: ServerResponse, method: string, path: string): Promise<boolean> => {
        if (path !== '/settings/data') return false;
        const who = await context.signedIn(request);
        if (who === undefined) {
            context.redirect(response, `/signin?next=${encodeURIComponent('/settings/data')}`);
            return true;
        }
        if (method === 'GET') {
            const url = new URL(request.url ?? '/', 'http://localhost');
            await show(response, request, who.user, url.searchParams.get('w') ?? who.user.id);
            return true;
        }
        if (method === 'POST') {
            const form = await context.readForm(request);
            const workspaceId = form.get('w') ?? who.user.id;
            try {
                await show(response, request, who.user, workspaceId, { notice: await change(request, who.user, form) });
            } catch (error) {
                if (error instanceof Refused) await show(response, request, who.user, workspaceId, { error: error.said }, 400);
                else if (error instanceof OrgError) await show(response, request, who.user, workspaceId, { error: error.message }, error.status);
                else throw error;
            }
            return true;
        }
        return false;
    };
}
