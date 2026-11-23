import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Services } from '@punyts/stateui-mcp';
import type { Database } from '@punyts/stateui-pg';
import type { User } from '../accounts/Accounts.js';
import type { StateGrants } from '../grants/StateGrants.js';
import type { ManagedWorkspace } from '../http/connectionsPage.js';
import type { PageLook } from '../http/pages.js';
import { requestPage, requestsPage } from '../http/requestsPage.js';
import type { ListedRequest, RequestsSaid } from '../http/requestsPage.js';
import { requestsTextsOf } from '../http/requestsText.js';
import type { Orgs } from '../orgs/Orgs.js';
import type { PendingRequests } from '../requests/PendingRequests.js';
import type { OwnerNumbers } from '../statenet/OwnerNumbers.js';
import { managedWorkspaces, principalsOf } from './dataRoutes.js';

export interface RequestsRouteContext {
    readonly db: Database;
    readonly orgs: Orgs;
    readonly owners: OwnerNumbers;
    /** Absent when the server has no signing key: nothing can be requested, so nothing waits */
    readonly grants?: StateGrants;
    readonly pending: PendingRequests;
    /** A workspace's services, to read and decide its datasets' requests */
    readonly workspace: (workspaceId: string) => Promise<Services>;
    readonly signedIn: (request: IncomingMessage) => Promise<{ readonly user: User } | undefined>;
    readonly readForm: (request: IncomingMessage) => Promise<URLSearchParams>;
    readonly lookOf: (request: IncomingMessage, userId: string) => Promise<PageLook>;
    readonly sendPage: (response: ServerResponse, html: string, status?: number) => void;
    readonly redirect: (response: ServerResponse, location: string) => void;
    readonly report: (message: string, fields?: Record<string, unknown>) => void;
}

/** The longest note a decider may give */
export const MAX_NOTE = 500;

const ONE = /^\/requests\/([^/]+)\/([^/]+)\/([^/]+)$/;

/**
 * `GET /requests`, `GET|POST /requests/<workspace>/<dataset>/<id>`: the changes people using the person's apps asked
 * for on the datasets of the workspaces they manage, each opened with the record as it is and as asked, and approved
 * or rejected with an optional note (docs/design/statenet-requests.md, R3c). The decision goes to the dataset's
 * authority as the workspace itself, which decides as it would for any session. Answers true when it handled the request
 */
export function requestsRoutes(context: RequestsRouteContext) {
    const { db, orgs, owners, grants, pending } = context;

    /** Who asked, by the person's or org's name; `someone` when the subject is no longer known */
    async function namesOf(subjects: readonly string[], someone: string): Promise<Map<string, string>> {
        const ids = new Map<string, string>();
        for (const subject of new Set(subjects)) ids.set(subject, (await owners.idOfName(subject)).replace(/^org:/, ''));
        const principals = await principalsOf(db, [...ids.values()]);
        const names = new Map<string, string>();
        for (const [subject, id] of ids) {
            const principal = principals.get(id);
            names.set(subject, principal === undefined || principal.name === id ? someone : principal.name);
        }
        return names;
    }

    async function showList(response: ServerResponse, request: IncomingMessage, user: User, extra: { notice?: RequestsSaid; error?: RequestsSaid; decided?: string } = {}, status = 200): Promise<void> {
        const look = await context.lookOf(request, user.id);
        const workspaces = await managedWorkspaces(orgs, user);
        // the index is saved after the decision is answered, so the request just decided is left out here
        const found = (grants === undefined ? [] : await pending.of(workspaces.map((workspace) => workspace.id))).filter((each) => each.id !== extra.decided);
        const names = await namesOf(
            found.map((each) => each.subject),
            requestsTextsOf(look.language)['requests.someone']
        );
        const requests: ListedRequest[] = found.map((each) => ({
            workspace: workspaces.find((workspace) => workspace.id === each.workspaceId) as ManagedWorkspace,
            dataset: each.dataset,
            id: each.id,
            by: names.get(each.subject) as string,
            at: each.at,
            until: each.until
        }));
        context.sendPage(response, requestsPage({ look, requests, ...extra }), status);
    }

    async function showOne(response: ServerResponse, request: IncomingMessage, user: User, workspace: ManagedWorkspace, dataset: string, id: string): Promise<void> {
        if (grants === undefined) return showList(response, request, user, { error: { key: 'requests.gone' } }, 404);
        const services = await context.workspace(workspace.id);
        const listed = await services.datasetSessions.list(dataset, await grants.boundAccess('default', workspace.id, dataset));
        const found = listed?.requests.find((each) => each.id === id);
        if (listed === undefined || found === undefined) return showList(response, request, user, { error: { key: 'requests.gone' } }, 404);
        const look = await context.lookOf(request, user.id);
        const by = (await namesOf([found.by], requestsTextsOf(look.language)['requests.someone'])).get(found.by) as string;
        context.sendPage(
            response,
            requestPage({
                look,
                workspace,
                dataset,
                id,
                by,
                at: new Date(found.at),
                until: new Date(found.until),
                path: found.path,
                op: found.op,
                ...(found.value !== undefined && { value: found.value }),
                records: listed.records
            })
        );
    }

    async function decide(request: IncomingMessage, user: User, workspace: ManagedWorkspace, dataset: string, id: string): Promise<{ notice?: RequestsSaid; error?: RequestsSaid }> {
        const form = await context.readForm(request);
        const action = form.get('do');
        if ((action !== 'approve' && action !== 'reject') || grants === undefined) return { error: { key: 'requests.gone' } };
        const note = (form.get('note') ?? '').trim().slice(0, MAX_NOTE);
        const services = await context.workspace(workspace.id);
        const decided = await services.datasetSessions.decide(dataset, await grants.boundAccess('default', workspace.id, dataset), action, id, note === '' ? undefined : note);
        if (decided === undefined) return { error: { key: 'requests.noAnswer' } };
        context.report('Request decided', { workspace: workspace.id, dataset, id, status: decided.status, ...(decided.code !== undefined && { code: decided.code }) });
        if (decided.status === 'approved') return { notice: { key: 'requests.approved', values: { dataset } } };
        if (decided.status === 'rejected' && decided.code !== undefined) return { error: { key: 'requests.refused', values: { dataset, code: decided.code } } };
        if (decided.status === 'rejected') return { notice: { key: 'requests.rejected', values: { dataset } } };
        return { error: { key: 'requests.gone' } };
    }

    return async (request: IncomingMessage, response: ServerResponse, method: string, path: string): Promise<boolean> => {
        const one = ONE.exec(path);
        if (path !== '/requests' && one === null) return false;
        const who = await context.signedIn(request);
        if (who === undefined) {
            context.redirect(response, `/signin?next=${encodeURIComponent(path)}`);
            return true;
        }
        if (one === null) {
            if (method !== 'GET') return false;
            await showList(response, request, who.user);
            return true;
        }
        const [workspaceId, dataset, id] = one.slice(1).map((part) => decodeURIComponent(part)) as [string, string, string];
        const workspace = (await managedWorkspaces(orgs, who.user)).find((each) => each.id === workspaceId);
        if (workspace === undefined) {
            await showList(response, request, who.user, { error: { key: 'requests.notManaged' } }, 403);
            return true;
        }
        if (method === 'GET') {
            await showOne(response, request, who.user, workspace, dataset, id);
            return true;
        }
        if (method === 'POST') {
            const said = await decide(request, who.user, workspace, dataset, id);
            await showList(response, request, who.user, { ...said, decided: id }, said.error === undefined || said.error.key === 'requests.refused' ? 200 : 409);
            return true;
        }
        return false;
    };
}
