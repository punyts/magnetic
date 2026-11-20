import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Mailer } from '../mail/Mailer.js';
import type { Services, UiToolDefinition } from '@punyts/stateui-mcp';
import type { Database } from '@punyts/stateui-pg';
import type { User } from '../accounts/Accounts.js';
import { AppAccess, isAppPermission, moveAppToOrg } from '../orgs/AppAccess.js';
import type { AppInstances } from '../orgs/Instances.js';
import { isOrgRole, OrgError, Orgs } from '../orgs/Orgs.js';
import type { Budgets } from '../agent/Budgets.js';
import type { OrgDomains } from '../orgs/Domains.js';
import { deleteOrg, exportOrg } from '../orgs/Lifecycle.js';
import type { OrgPolicies, PolicyChange } from '../orgs/Policies.js';
import type { OrgSso } from '../orgs/Sso.js';
import type { StateChanges } from '../statenet/StateNamespaces.js';
import type { Workspaces } from '../workspaces/Workspaces.js';

/** What the org routes work with, from the server */
/**
 * Emails a new invite when the server has a mailer, and says whether it went. A refused or failed send is reported (the
 * address is not) and the invite still stands: its link is shown, as without a mailer
 */
export async function mailInvite(
    context: Pick<OrgRouteContext, 'orgs' | 'mailer' | 'report'>,
    inviter: User,
    orgId: string,
    invite: { readonly token: string; readonly expiresAt: string },
    email: string,
    role: string,
    link: string
): Promise<boolean> {
    if (context.mailer === undefined) return false;
    const org = await context.orgs.get(orgId);
    if (org === undefined) return false;
    try {
        await context.mailer.invite({ to: email.trim().toLowerCase(), orgName: org.name, inviterName: inviter.name, role: ROLE_WORDS[role] ?? role, link, expiresAt: invite.expiresAt });
        return true;
    } catch (error) {
        context.report?.('Invite email failed', { org: orgId, error: error instanceof Error ? error.message : String(error) });
        return false;
    }
}

/** A role as an invite email says it */
const ROLE_WORDS: Readonly<Record<string, string>> = { owner: 'an owner', admin: 'an admin', builder: 'a builder', member: 'a member' };

export interface OrgRouteContext {
    /** False: nobody makes an org (the beta: everyone is in its org); true by default */
    readonly makeOrgs?: boolean;
    /** Sends invites by email; without one, the invite's link is only shown to the person who made it */
    readonly mailer?: Mailer;
    /** Where a failed email is reported */
    readonly report?: (message: string, fields?: Record<string, unknown>) => void;
    readonly db: Database;
    /** Removes and moves people's state, through the aggregate */
    readonly state: StateChanges;
    readonly orgs: Orgs;
    readonly access: AppAccess;
    readonly instances: AppInstances;
    readonly workspaces: Workspaces;
    readonly toolsOf: (services: Services) => readonly UiToolDefinition[];
    /** The signed-in person of a request */
    readonly signedIn: (request: IncomingMessage) => Promise<{ readonly user: User } | undefined>;
    readonly readJson: (request: IncomingMessage) => Promise<unknown>;
    readonly sendJson: (response: ServerResponse, status: number, body: unknown) => void;
    /** Where the invite links point: `<origin>/invites/<token>` */
    readonly origin: () => string;
    /** Closes a person's open views of org apps (all of an org's, or some) */
    readonly closeOrgViews: (userId: string, appIds: readonly string[] | 'all', reason: string) => void;
    /** An app name from what a person typed */
    readonly appNameOf: (typed: string) => string | undefined;
    readonly policies: OrgPolicies;
    readonly domains: OrgDomains;
    readonly sso: OrgSso;
    readonly budgets: Budgets;
    /** The redirect URI an org registers with its own provider */
    readonly ssoRedirectUri: () => string;
    /** After an org is deleted: closes its members' views and its workspace */
    readonly orgDeleted: (workspaceId: string, members: readonly string[]) => Promise<void>;
}

const UUID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const ROUTES = {
    orgs: /^\/orgs$/,
    /** An invite waiting on the person's Your apps, joined or declined by its id */
    waiting: new RegExp(`^/orgs/invites/${UUID}/(accept|decline)$`),
    members: new RegExp(`^/orgs/${UUID}/members$`),
    member: new RegExp(`^/orgs/${UUID}/members/${UUID}$`),
    groups: new RegExp(`^/orgs/${UUID}/groups$`),
    groupMember: new RegExp(`^/orgs/${UUID}/groups/${UUID}/members/${UUID}$`),
    invites: new RegExp(`^/orgs/${UUID}/invites$`),
    accept: /^\/invites\/([A-Za-z0-9_-]{43})\/accept$/,
    audit: new RegExp(`^/orgs/${UUID}/audit$`),
    apps: new RegExp(`^/orgs/${UUID}/apps$`),
    appAccess: new RegExp(`^/orgs/${UUID}/apps/${UUID}/access$`),
    appOpen: new RegExp(`^/orgs/${UUID}/apps/${UUID}/open$`),
    appInstances: new RegExp(`^/orgs/${UUID}/apps/${UUID}/instances$`),
    appInstance: new RegExp(`^/orgs/${UUID}/apps/${UUID}/instances/${UUID}$`),
    move: new RegExp(`^/apps/${UUID}/move$`),
    org: new RegExp(`^/orgs/${UUID}$`),
    policy: new RegExp(`^/orgs/${UUID}/policy$`),
    domains: new RegExp(`^/orgs/${UUID}/domains$`),
    domain: new RegExp(`^/orgs/${UUID}/domains/([a-z0-9.-]{3,253})$`),
    domainVerify: new RegExp(`^/orgs/${UUID}/domains/([a-z0-9.-]{3,253})/verify$`),
    sso: new RegExp(`^/orgs/${UUID}/sso$`),
    spend: new RegExp(`^/orgs/${UUID}/spend$`),
    export: new RegExp(`^/orgs/${UUID}/export$`)
};

/** A policy change from a JSON body: only the policies it names */
function policyChangeOf(body: unknown): PolicyChange {
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as PolicyChange) : {};
}

/** Said to a person whose open view of an org app closes because they lost it */
export const ACCESS_CHANGED = 'Your access to this app changed';

/**
 * After a change of access, closes the open views of each person given who may no longer open an app: the apps named,
 * or every app of the workspace (a change of groups)
 */
export async function closeLostViews(context: Pick<OrgRouteContext, 'access' | 'workspaces' | 'closeOrgViews'>, workspaceId: string, userIds: readonly string[], appIds?: readonly string[]): Promise<void> {
    if (userIds.length === 0) return;
    const apps = appIds ?? (await (await context.workspaces.get(workspaceId)).instanceViews.list()).map((app) => app.id);
    for (const userId of userIds) {
        const lost: string[] = [];
        for (const appId of apps) if ((await context.access.permission(userId, workspaceId, appId)) === undefined) lost.push(appId);
        if (lost.length > 0) context.closeOrgViews(userId, lost, ACCESS_CHANGED);
    }
}

/** Makes an app in an org's workspace for a builder or above, who then manages it; its id */
export async function createOrgApp(context: Pick<OrgRouteContext, 'orgs' | 'access' | 'workspaces' | 'toolsOf' | 'appNameOf'>, userId: string, orgId: string, workspaceId: string, typed: string): Promise<{ readonly id: string; readonly name: string }> {
    await context.orgs.require(orgId, userId, 'builder');
    const name = context.appNameOf(typed);
    if (name === undefined) throw new OrgError(400, 'Give the app a name that starts with a letter.');
    const services = await context.workspaces.get(workspaceId);
    const create = context.toolsOf(services).find((tool) => tool.name === 'ui_app_create');
    const outcome = create === undefined ? undefined : await create.run({ name } as never);
    const created = outcome?.body as { id?: unknown; message?: unknown } | undefined;
    if (outcome === undefined || outcome.isError || typeof created?.id !== 'string') throw new OrgError(400, typeof created?.message === 'string' ? created.message : 'The app could not be made.');
    await context.access.recordCreated(userId, workspaceId, created.id);
    return { id: created.id, name };
}

function field(body: unknown, name: string): unknown {
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[name] : undefined;
}

function text(body: unknown, name: string): string {
    const value = field(body, name);
    return typeof value === 'string' ? value : '';
}

/**
 * The JSON routes of orgs: making one and listing yours; members, roles and removal; groups; invites and accepting
 * them; the audit log; an org's apps, making one and their access lists; who uses an app, and one member's instance
 * of it read only, for support; and moving an app of your own into an org.
 * Every change is checked against the person's role or the app's permission, and an `OrgError` answers with its
 * status. Answers whether it handled the request
 */
/** Said when making an org is closed */
export const MAKING_ORGS_CLOSED = 'Making an org is not open yet.';

export function orgRoutes(context: OrgRouteContext): (request: IncomingMessage, response: ServerResponse, method: string, path: string) => Promise<boolean> {
    const { orgs, access, sendJson } = context;

    async function orgWorkspace(orgId: string): Promise<string> {
        const org = await orgs.get(orgId);
        if (org === undefined) throw new OrgError(404, 'No such org.');
        return org.workspaceId;
    }

    async function handle(request: IncomingMessage, response: ServerResponse, method: string, path: string, user: User): Promise<boolean> {
        let match: RegExpExecArray | null;
        if (ROUTES.orgs.test(path)) {
            if (method === 'GET') sendJson(response, 200, { orgs: await orgs.of(user.id) });
            else if (method === 'POST') {
                if (context.makeOrgs === false) throw new OrgError(403, MAKING_ORGS_CLOSED);
                const body = await context.readJson(request);
                sendJson(response, 201, await orgs.create(user.id, { name: text(body, 'name'), slug: text(body, 'slug') }));
            } else return false;
            return true;
        }
        if ((match = ROUTES.members.exec(path)) !== null && method === 'GET') {
            sendJson(response, 200, { members: await orgs.members(user.id, match[1] as string) });
            return true;
        }
        if ((match = ROUTES.member.exec(path)) !== null) {
            const [orgId, userId] = [match[1] as string, match[2] as string];
            if (method === 'POST') {
                const role = field(await context.readJson(request), 'role');
                if (!isOrgRole(role)) throw new OrgError(400, 'A role is owner, admin, builder or member.');
                await orgs.setRole(user.id, orgId, userId, role);
                sendJson(response, 200, { ok: true });
            } else if (method === 'DELETE') {
                await orgs.remove(user.id, orgId, userId);
                context.closeOrgViews(userId, 'all', 'Removed from org');
                sendJson(response, 200, { ok: true });
            } else return false;
            return true;
        }
        if ((match = ROUTES.groups.exec(path)) !== null) {
            const orgId = match[1] as string;
            if (method === 'GET') sendJson(response, 200, { groups: await orgs.groups(user.id, orgId) });
            else if (method === 'POST') sendJson(response, 201, await orgs.createGroup(user.id, orgId, text(await context.readJson(request), 'name')));
            else return false;
            return true;
        }
        if ((match = ROUTES.groupMember.exec(path)) !== null && (method === 'POST' || method === 'DELETE')) {
            const [orgId, groupId, userId] = [match[1] as string, match[2] as string, match[3] as string];
            await orgs.setGroupMember(user.id, orgId, groupId, userId, method === 'POST');
            // Someone taken out of a group loses the apps they had only through it
            if (method === 'DELETE') await closeLostViews(context, await orgWorkspace(orgId), [userId]);
            sendJson(response, 200, { ok: true });
            return true;
        }
        if ((match = ROUTES.invites.exec(path)) !== null && method === 'POST') {
            const body = await context.readJson(request);
            const role = field(body, 'role') ?? 'member';
            if (!isOrgRole(role)) throw new OrgError(400, 'A role is owner, admin, builder or member.');
            const groups = field(body, 'groups');
            const invite = await orgs.invite(user.id, match[1] as string, {
                email: text(body, 'email'),
                role,
                groups: Array.isArray(groups) ? groups.filter((group): group is string => typeof group === 'string') : []
            });
            const link = `${context.origin()}/invites/${invite.token}`;
            const mailed = await mailInvite(context, user, match[1] as string, invite, text(body, 'email'), role, link);
            sendJson(response, 201, { id: invite.id, link, expiresAt: invite.expiresAt, mailed });
            return true;
        }
        if ((match = ROUTES.waiting.exec(path)) !== null && method === 'POST') {
            if (match[2] === 'accept') sendJson(response, 200, await orgs.acceptInvite(match[1] as string, user.id));
            else {
                await orgs.decline(match[1] as string, user.id);
                sendJson(response, 200, { ok: true });
            }
            return true;
        }
        if ((match = ROUTES.accept.exec(path)) !== null && method === 'POST') {
            sendJson(response, 200, await orgs.accept(match[1] as string, user.id));
            return true;
        }
        if ((match = ROUTES.audit.exec(path)) !== null && method === 'GET') {
            sendJson(response, 200, { events: await orgs.auditLog(user.id, match[1] as string) });
            return true;
        }
        if ((match = ROUTES.apps.exec(path)) !== null) {
            const orgId = match[1] as string;
            const workspaceId = await orgWorkspace(orgId);
            if (method === 'GET') {
                await orgs.require(orgId, user.id, 'member');
                const services = await context.workspaces.get(workspaceId);
                const visible = await access.visibleApps(user.id, workspaceId);
                const apps = (await services.instanceViews.list()).filter((app) => visible.has(app.id)).map((app) => ({ id: app.id, name: app.name, permission: visible.get(app.id) }));
                sendJson(response, 200, { apps });
                return true;
            }
            if (method === 'POST') {
                sendJson(response, 201, await createOrgApp(context, user.id, orgId, workspaceId, text(await context.readJson(request), 'name')));
                return true;
            }
            return false;
        }
        if ((match = ROUTES.appAccess.exec(path)) !== null) {
            const [orgId, appId] = [match[1] as string, match[2] as string];
            const workspaceId = await orgWorkspace(orgId);
            if (method === 'GET') {
                sendJson(response, 200, await access.list(user.id, workspaceId, appId));
                return true;
            }
            if (method === 'POST') {
                const body = await context.readJson(request);
                const kind = field(body, 'principalKind');
                const principalId = text(body, 'principalId');
                const permission = field(body, 'permission');
                if ((kind !== 'user' && kind !== 'group') || principalId === '') throw new OrgError(400, 'Name a member or a group.');
                if (permission !== null && !isAppPermission(permission)) throw new OrgError(400, 'A permission is manage, edit, use or view, or null to take it away.');
                await access.set(user.id, workspaceId, appId, { kind, id: principalId }, permission ?? undefined);
                // Whoever lost the app loses its open views at once
                const affected = kind === 'user' ? [principalId] : ((await orgs.groups(user.id, orgId)).find((group) => group.id === principalId)?.members ?? []);
                await closeLostViews(context, workspaceId, affected, [appId]);
                sendJson(response, 200, { ok: true });
                return true;
            }
            return false;
        }
        if ((match = ROUTES.appOpen.exec(path)) !== null && method === 'POST') {
            const [orgId, appId] = [match[1] as string, match[2] as string];
            const workspaceId = await orgWorkspace(orgId);
            const open = field(await context.readJson(request), 'open') === true;
            await access.setOpenToOrg(user.id, workspaceId, appId, open);
            if (!open) await closeLostViews(context, workspaceId, (await orgs.members(user.id, orgId)).map((member) => member.userId), [appId]);
            sendJson(response, 200, { ok: true });
            return true;
        }
        if ((match = ROUTES.appInstances.exec(path)) !== null && method === 'GET') {
            const [orgId, appId] = [match[1] as string, match[2] as string];
            sendJson(response, 200, { instances: await context.instances.list(user.id, orgId, await orgWorkspace(orgId), appId) });
            return true;
        }
        if ((match = ROUTES.appInstance.exec(path)) !== null && method === 'GET') {
            const [orgId, appId, userId] = [match[1] as string, match[2] as string, match[3] as string];
            sendJson(response, 200, await context.instances.view(user.id, orgId, await orgWorkspace(orgId), appId, userId));
            return true;
        }
        if ((match = ROUTES.org.exec(path)) !== null && method === 'DELETE') {
            const deleted = await deleteOrg(context.db, context.state, orgs, user.id, match[1] as string, text(await context.readJson(request), 'confirm'));
            await context.orgDeleted(deleted.workspaceId, deleted.members);
            sendJson(response, 200, { deleted: true });
            return true;
        }
        if ((match = ROUTES.policy.exec(path)) !== null) {
            const orgId = match[1] as string;
            if (method === 'GET') {
                await orgs.require(orgId, user.id, 'member');
                sendJson(response, 200, await context.policies.get(orgId));
            } else if (method === 'POST') sendJson(response, 200, await context.policies.set(user.id, orgId, policyChangeOf(await context.readJson(request))));
            else return false;
            return true;
        }
        if ((match = ROUTES.domains.exec(path)) !== null) {
            const orgId = match[1] as string;
            if (method === 'GET') sendJson(response, 200, { domains: await context.domains.list(user.id, orgId) });
            else if (method === 'POST') sendJson(response, 201, await context.domains.add(user.id, orgId, text(await context.readJson(request), 'domain')));
            else return false;
            return true;
        }
        if ((match = ROUTES.domainVerify.exec(path)) !== null && method === 'POST') {
            sendJson(response, 200, { verified: await context.domains.verify(user.id, match[1] as string, match[2] as string) });
            return true;
        }
        if ((match = ROUTES.domain.exec(path)) !== null && method === 'DELETE') {
            await context.domains.remove(user.id, match[1] as string, match[2] as string);
            sendJson(response, 200, { ok: true });
            return true;
        }
        if ((match = ROUTES.sso.exec(path)) !== null) {
            const orgId = match[1] as string;
            if (method === 'GET') {
                sendJson(response, 200, { available: context.sso.available, redirectUri: context.ssoRedirectUri(), provider: (await context.sso.get(user.id, orgId)) ?? null });
            } else if (method === 'POST') {
                const body = await context.readJson(request);
                await context.sso.set(user.id, orgId, { issuer: text(body, 'issuer'), clientId: text(body, 'clientId'), clientSecret: text(body, 'clientSecret'), enabled: field(body, 'enabled') === true });
                sendJson(response, 200, { ok: true });
            } else return false;
            return true;
        }
        if ((match = ROUTES.spend.exec(path)) !== null && method === 'GET') {
            const orgId = match[1] as string;
            await orgs.require(orgId, user.id, 'admin');
            const workspaceId = await orgWorkspace(orgId);
            sendJson(response, 200, { month: await context.budgets.workspaceSpent(workspaceId), budget: (await context.policies.get(orgId)).monthlyBudget ?? null, byPersonAndApp: await context.budgets.workspaceSpend(workspaceId) });
            return true;
        }
        if ((match = ROUTES.export.exec(path)) !== null && method === 'GET') {
            const org = await orgs.get(match[1] as string);
            const exported = await exportOrg(context.db, orgs, user.id, match[1] as string);
            response.setHeader('Content-Disposition', `attachment; filename="${org?.slug ?? 'org'}-export.json"`);
            sendJson(response, 200, exported);
            return true;
        }
        if ((match = ROUTES.move.exec(path)) !== null && method === 'POST') {
            const orgId = text(await context.readJson(request), 'orgId');
            const moved = await moveAppToOrg(context.db, context.state, { userId: user.id, appId: match[1] as string, orgId, functions: (await context.workspaces.get(user.id)).functions });
            // The person's own workspace held the app live: closing it ends its views, which reload into the org
            await context.workspaces.reopen(user.id);
            sendJson(response, 200, moved);
            return true;
        }
        return false;
    }

    return async (request, response, method, path) => {
        if (!path.startsWith('/orgs') && !ROUTES.accept.test(path) && !ROUTES.move.test(path)) return false;
        const who = await context.signedIn(request);
        if (who === undefined) {
            sendJson(response, 401, { message: 'Sign in first.' });
            return true;
        }
        try {
            return await handle(request, response, method, path, who.user);
        } catch (error) {
            if (error instanceof OrgError) {
                sendJson(response, error.status, { message: error.message });
                return true;
            }
            throw error;
        }
    };
}
