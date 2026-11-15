import type { IncomingMessage, ServerResponse } from 'node:http';
import type { User } from '../accounts/Accounts.js';
import { invitePage, orgListPage, orgPage, supportPage } from '../http/orgSettings.js';
import type { OrgAppView } from '../http/orgSettings.js';
import { orgTextsOf } from '../http/orgText.js';
import type { PageLook } from '../http/pages.js';
import { EDITOR_APP } from '../editor/EditorApp.js';
import { HOME_APP } from '../home/HomeApp.js';
import { allows, isAppPermission, moveAppToOrg } from '../orgs/AppAccess.js';
import { atLeast, isOrgRole, OrgError } from '../orgs/Orgs.js';
import type { Org } from '../orgs/Orgs.js';
import { closeLostViews, createOrgApp } from './orgRoutes.js';
import type { OrgRouteContext } from './orgRoutes.js';

/** What the org settings pages work with, beyond the org routes' context */
export interface OrgSettingsContext extends OrgRouteContext {
    /** How Magnetic looks and speaks to the person */
    readonly lookOf: (request: IncomingMessage, userId: string) => Promise<PageLook>;
    readonly readForm: (request: IncomingMessage) => Promise<URLSearchParams>;
    /** Sends one of Magnetic's own script-free pages */
    readonly sendPage: (response: ServerResponse, html: string, status?: number) => void;
    readonly redirect: (response: ServerResponse, location: string) => void;
}

const UUID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const LIST = /^\/settings\/orgs$/;
const ORG = new RegExp(`^/settings/orgs/${UUID}$`);
const SUPPORT = new RegExp(`^/settings/orgs/${UUID}/apps/${UUID}/instances/${UUID}$`);
/** A random (version 4) id: an app made in the workspace. The starter apps have the same id in every workspace, so they do not move */
const MOVABLE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVITE = /^\/invites\/([A-Za-z0-9_-]{43})$/;
const PRINCIPAL = new RegExp(`^(user|group):${UUID}$`);

/** What a person typed in a form field, or nothing */
const text = (form: URLSearchParams, name: string): string => form.get(name) ?? '';

/**
 * The org settings pages, for people to manage their orgs in the browser: `GET /settings/orgs` (their orgs, and making
 * one), `GET /settings/orgs/<id>` (members, groups, invites, apps and their access and users, the audit log; each part
 * as far as the person's role goes), its form posts, and a member's state read only for support. Each change goes
 * through `Orgs` and `AppAccess`, as the JSON routes do, and a refusal is shown on the page. Answers whether it handled
 * the request
 */
export function orgSettingsRoutes(context: OrgSettingsContext): (request: IncomingMessage, response: ServerResponse, method: string, path: string, query: URLSearchParams) => Promise<boolean> {
    const { orgs, access } = context;

    /** An org's page as the person sees it now */
    async function render(request: IncomingMessage, response: ServerResponse, user: User, org: Org, extra: { notice?: string; error?: string; invited?: { email: string; link: string } } = {}, status = 200): Promise<void> {
        const look = await context.lookOf(request, user.id);
        const role = await orgs.role(org.id, user.id);
        if (role === undefined) throw new OrgError(404, 'No such org.');
        const admin = atLeast(role, 'admin');
        const services = await context.workspaces.get(org.workspaceId);
        const visible = await access.visibleApps(user.id, org.workspaceId);
        const apps: OrgAppView[] = [];
        for (const app of await services.instanceViews.list()) {
            const permission = visible.get(app.id);
            if (permission === undefined) continue;
            if (!allows(permission, 'manage')) {
                apps.push({ id: app.id, name: app.name, permission });
                continue;
            }
            const list = await access.list(user.id, org.workspaceId, app.id);
            apps.push({ id: app.id, name: app.name, permission, openToOrg: list.openToOrg, entries: list.entries, users: await context.instances.list(user.id, org.id, org.workspaceId, app.id) });
        }
        context.sendPage(
            response,
            orgPage({
                look,
                org,
                role,
                userId: user.id,
                members: await orgs.members(user.id, org.id),
                groups: await orgs.groups(user.id, org.id),
                apps,
                ...(atLeast(role, 'builder') && {
                    ownApps: (await (await context.workspaces.get(user.id)).instanceViews.list()).filter((app) => app.name !== HOME_APP && app.name !== EDITOR_APP && MOVABLE_ID.test(app.id)).map((app) => ({ id: app.id, name: app.name }))
                }),
                ...(admin && { audit: await orgs.auditLog(user.id, org.id, 100) }),
                ...extra
            }),
            status
        );
    }

    /** Makes the change a form of an org's page asks for; the invite's link when it made one */
    async function change(form: URLSearchParams, user: User, org: Org): Promise<{ readonly invited?: { email: string; link: string }; readonly left?: true; readonly go?: string }> {
        const action = text(form, 'do');
        const userId = text(form, 'userId');
        if (action === 'role') {
            const role = text(form, 'role');
            if (!isOrgRole(role)) throw new OrgError(400, 'A role is owner, admin, builder or member.');
            await orgs.setRole(user.id, org.id, userId, role);
        } else if (action === 'remove' || action === 'leave') {
            const leaving = action === 'leave' ? user.id : userId;
            await orgs.remove(user.id, org.id, leaving);
            context.closeOrgViews(leaving, 'all', 'Removed from org');
            if (action === 'leave') return { left: true };
        } else if (action === 'makeGroup') {
            await orgs.createGroup(user.id, org.id, text(form, 'name'));
        } else if (action === 'group' || action === 'ungroup') {
            await orgs.setGroupMember(user.id, org.id, text(form, 'groupId'), userId, action === 'group');
            if (action === 'ungroup') await closeLostViews(context, org.workspaceId, [userId]);
        } else if (action === 'invite') {
            const role = text(form, 'role') || 'member';
            if (!isOrgRole(role)) throw new OrgError(400, 'A role is owner, admin, builder or member.');
            const email = text(form, 'email');
            const invite = await orgs.invite(user.id, org.id, { email, role, groups: form.getAll('groups') });
            return { invited: { email: email.trim().toLowerCase(), link: `${context.origin()}/invites/${invite.token}` } };
        } else if (action === 'access') {
            const appId = text(form, 'appId');
            const principal = PRINCIPAL.exec(text(form, 'principal'));
            const permission = text(form, 'permission');
            if (principal === null) throw new OrgError(400, 'Name a member or a group.');
            if (permission !== '' && !isAppPermission(permission)) throw new OrgError(400, 'A permission is manage, edit, use or view.');
            const kind = principal[1] as 'user' | 'group';
            const principalId = principal[2] as string;
            await access.set(user.id, org.workspaceId, appId, { kind, id: principalId }, permission === '' ? undefined : permission);
            const affected = kind === 'user' ? [principalId] : ((await orgs.groups(user.id, org.id)).find((group) => group.id === principalId)?.members ?? []);
            await closeLostViews(context, org.workspaceId, affected, [appId]);
        } else if (action === 'makeApp') {
            return { go: `/edit/${(await createOrgApp(context, user.id, org.id, org.workspaceId, text(form, 'name'))).id}` };
        } else if (action === 'moveIn') {
            const moved = await moveAppToOrg(context.db, { userId: user.id, appId: text(form, 'appId'), orgId: org.id });
            // The person's own workspace held the app live: closing it ends its views, which reload into the org
            await context.workspaces.reopen(user.id);
            return { go: `/edit/${moved.appId}` };
        } else if (action === 'open') {
            const appId = text(form, 'appId');
            const open = text(form, 'open') === 'true';
            await access.setOpenToOrg(user.id, org.workspaceId, appId, open);
            if (!open) await closeLostViews(context, org.workspaceId, (await orgs.members(user.id, org.id)).map((member) => member.userId), [appId]);
        } else throw new OrgError(400, 'Unknown change.');
        return {};
    }

    async function handle(request: IncomingMessage, response: ServerResponse, method: string, path: string, query: URLSearchParams, user: User): Promise<boolean> {
        let match: RegExpExecArray | null;
        if (LIST.test(path)) {
            if (method === 'GET') {
                context.sendPage(response, orgListPage({ look: await context.lookOf(request, user.id), orgs: await orgs.of(user.id) }));
                return true;
            }
            if (method !== 'POST') return false;
            const form = await context.readForm(request);
            try {
                const org = await orgs.create(user.id, { name: text(form, 'name'), slug: text(form, 'slug') });
                context.redirect(response, `/settings/orgs/${org.id}`);
            } catch (error) {
                if (!(error instanceof OrgError)) throw error;
                context.sendPage(response, orgListPage({ look: await context.lookOf(request, user.id), orgs: await orgs.of(user.id), error: error.message }), error.status);
            }
            return true;
        }
        if ((match = ORG.exec(path)) !== null) {
            const org = await orgs.get(match[1] as string);
            if (org === undefined) throw new OrgError(404, 'No such org.');
            if (method === 'GET') {
                await render(request, response, user, org, query.has('done') ? { notice: orgTextsOf((await context.lookOf(request, user.id)).language)['orgs.done'] } : {});
                return true;
            }
            if (method !== 'POST') return false;
            const form = await context.readForm(request);
            try {
                const done = await change(form, user, org);
                if (done.left === true) context.redirect(response, '/settings/orgs');
                else if (done.go !== undefined) context.redirect(response, done.go);
                else if (done.invited !== undefined) await render(request, response, user, org, { invited: done.invited });
                else context.redirect(response, `/settings/orgs/${org.id}?done`);
            } catch (error) {
                if (!(error instanceof OrgError)) throw error;
                await render(request, response, user, org, { error: error.message }, error.status);
            }
            return true;
        }
        if ((match = INVITE.exec(path)) !== null) {
            const token = match[1] as string;
            const look = await context.lookOf(request, user.id);
            if (method === 'GET') {
                const invite = await orgs.invitation(token);
                context.sendPage(response, invitePage({ look, token, ...(invite !== undefined && { invite }) }), invite === undefined ? 404 : 200);
                return true;
            }
            if (method !== 'POST') return false;
            try {
                const org = await orgs.accept(token, user.id);
                context.redirect(response, `/settings/orgs/${org.id}`);
            } catch (error) {
                if (!(error instanceof OrgError)) throw error;
                const invite = await orgs.invitation(token);
                context.sendPage(response, invitePage({ look, token, ...(invite !== undefined && { invite }), error: error.message }), error.status);
            }
            return true;
        }
        if ((match = SUPPORT.exec(path)) !== null && method === 'GET') {
            const [orgId, appId, userId] = [match[1] as string, match[2] as string, match[3] as string];
            const org = await orgs.get(orgId);
            if (org === undefined) throw new OrgError(404, 'No such org.');
            const support = await context.instances.view(user.id, org.id, org.workspaceId, appId, userId);
            const app = await (await context.workspaces.get(org.workspaceId)).instanceViews.find(appId);
            context.sendPage(response, supportPage({ look: await context.lookOf(request, user.id), org, appName: app?.name ?? appId, support }));
            return true;
        }
        return false;
    }

    return async (request, response, method, path, query) => {
        if (!path.startsWith('/settings/orgs') && !INVITE.test(path)) return false;
        const who = await context.signedIn(request);
        if (who === undefined) {
            if (method === 'GET') context.redirect(response, `/signin?next=${encodeURIComponent(path)}`);
            else context.sendJson(response, 401, { message: 'Sign in first.' });
            return true;
        }
        try {
            return await handle(request, response, method, path, query, who.user);
        } catch (error) {
            if (!(error instanceof OrgError)) throw error;
            // Refused before there was an org page to show it on: the list of the person's orgs, with why
            context.sendPage(response, orgListPage({ look: await context.lookOf(request, who.user.id), orgs: await orgs.of(who.user.id), error: error.message }), error.status);
            return true;
        }
    };
}
