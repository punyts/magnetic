import { escapeHtml } from '@punyts/stateui-mcp';
import type { AccessEntry, AppPermission } from '../orgs/AppAccess.js';
import { APP_PERMISSIONS } from '../orgs/AppAccess.js';
import type { InstanceSummary, SupportView } from '../orgs/Instances.js';
import type { Membership, Org, OrgGroup, OrgMember, OrgRole } from '../orgs/Orgs.js';
import { atLeast, ORG_ROLES } from '../orgs/Orgs.js';
import { fill } from './text.js';
import { orgTextsOf } from './orgText.js';
import type { OrgTexts } from './orgText.js';
import { htmlOpen } from './pages.js';
import type { PageLook } from './pages.js';

/*
 * The org settings pages: plain HTML with forms that post back to the server, so they need no script (Magnetic's page
 * policy allows none). Every form of an org posts to `/settings/orgs/<id>` with the change in its `do` field; the
 * server checks it against the person's role as the JSON routes do
 */

/** One app of the org as the settings page shows it; what only its managers see is absent for the others */
export interface OrgAppView {
    readonly id: string;
    readonly name: string;
    readonly permission: AppPermission;
    readonly openToOrg?: boolean;
    readonly entries?: readonly AccessEntry[];
    readonly users?: readonly InstanceSummary[];
}

export interface OrgPageView {
    readonly look: PageLook;
    readonly org: Org;
    readonly role: OrgRole;
    readonly userId: string;
    readonly members: readonly OrgMember[];
    readonly groups: readonly OrgGroup[];
    readonly apps: readonly OrgAppView[];
    /** The person's own apps they may bring in; for builders and above */
    readonly ownApps?: ReadonlyArray<{ readonly id: string; readonly name: string }>;
    /** For admins and owners */
    readonly audit?: ReadonlyArray<Record<string, unknown>>;
    readonly notice?: string;
    readonly error?: string;
    /** An invite just made: its link is shown once */
    readonly invited?: { readonly email: string; readonly link: string };
}

const e = (value: unknown): string => escapeHtml(String(value));

function page(look: PageLook, title: string, body: string): string {
    return [
        '<!doctype html>',
        htmlOpen(look),
        '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
        `<title>${e(title)}</title>`,
        '<link rel="stylesheet" href="/assets/magnetic.css"></head>',
        `<body><main class="settings">${body}</main></body></html>`
    ].join('\n');
}

function dateOf(look: PageLook, at: string | Date, time = false): string {
    const locale = look.language === 'en' ? 'en-GB' : look.language;
    const date = typeof at === 'string' ? new Date(at) : at;
    return time ? date.toLocaleString(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** A form of an org: posts to its page, with the change in `do` and the fields given */
function form(orgId: string, action: string, fields: Record<string, string>, inner: string, className = 'inline'): string {
    const hidden = Object.entries({ do: action, ...fields })
        .map(([name, value]) => `<input type="hidden" name="${e(name)}" value="${e(value)}">`)
        .join('');
    return `<form method="post" action="/settings/orgs/${e(orgId)}" class="${className}">${hidden}${inner}</form>`;
}

function select(name: string, options: ReadonlyArray<readonly [string, string]>, chosen?: string, label?: string): string {
    const list = options.map(([value, text]) => `<option value="${e(value)}"${value === chosen ? ' selected' : ''}>${e(text)}</option>`).join('');
    return `<select name="${e(name)}"${label === undefined ? '' : ` aria-label="${e(label)}"`}>${list}</select>`;
}

function messages(view: { readonly notice?: string; readonly error?: string }): string {
    return [view.notice === undefined ? '' : `<p class="notice" role="status">${e(view.notice)}</p>`, view.error === undefined ? '' : `<p class="error" role="alert">${e(view.error)}</p>`].join('');
}

function top(t: OrgTexts, title: string, links: ReadonlyArray<readonly [string, string]>): string {
    return `<header><h1>${e(title)}</h1><nav>${links.map(([href, text]) => `<a class="button" href="${e(href)}">${e(text)}</a>`).join(' ')}</nav></header>`;
}

/** The roles an actor may give someone who has `current` now: owners give any, admins move builders and members */
function rolesFor(actor: OrgRole, current: OrgRole): readonly OrgRole[] {
    if (actor === 'owner') return ORG_ROLES;
    if (actor === 'admin' && !atLeast(current, 'admin')) return ['builder', 'member'];
    return [];
}

/** `GET /settings/orgs`: the person's orgs, and a form to make one */
export function orgListPage(view: { readonly look: PageLook; readonly orgs: readonly Membership[]; readonly error?: string }): string {
    const t = orgTextsOf(view.look.language);
    const list =
        view.orgs.length === 0
            ? `<p class="muted">${e(t['orgs.none'])}</p>`
            : `<ul class="list">${view.orgs.map((org) => `<li><a href="/settings/orgs/${e(org.id)}">${e(org.name)}</a><span class="muted">${e(t[`orgs.roleName.${org.role}`])}</span></li>`).join('')}</ul>`;
    const make = `<h2>${e(t['orgs.makeTitle'])}</h2>
<form method="post" action="/settings/orgs" class="stack">
<label>${e(t['orgs.name'])}<input name="name" required maxlength="200"></label>
<label>${e(t['orgs.slug'])}<input name="slug" required pattern="[a-z0-9][a-z0-9\\-]{1,62}"></label>
<button class="primary">${e(t['orgs.make'])}</button></form>`;
    return page(view.look, t['orgs.pageTitle'], `${top(t, t['orgs.title'], [['/', t['orgs.back']]])}<p class="muted">${e(t['orgs.intro'])}</p>${messages(view)}${list}${make}`);
}

/** `GET /settings/orgs/<id>`: members, groups, invites, apps with their access and users, and the audit log, by role */
export function orgPage(view: OrgPageView): string {
    const t = orgTextsOf(view.look.language);
    const { org, role } = view;
    const admin = atLeast(role, 'admin');
    const nameOf = (userId: unknown): string => view.members.find((member) => member.userId === userId)?.name ?? t['orgs.someone'];
    const roleNames = (roles: readonly OrgRole[]): Array<readonly [string, string]> => roles.map((each) => [each, t[`orgs.roleName.${each}`]] as const);
    const permissions = APP_PERMISSIONS.map((permission) => [permission, t[`orgs.perm.${permission}`]] as const);

    const members = view.members
        .map((member) => {
            const roles = member.userId === view.userId ? [] : rolesFor(role, member.role);
            const roleCell = roles.length === 0 ? e(t[`orgs.roleName.${member.role}`]) : form(org.id, 'role', { userId: member.userId }, `${select('role', roleNames(roles), member.role, t['orgs.role'])} <button>${e(t['orgs.save'])}</button>`);
            const remove = roles.length === 0 ? '' : form(org.id, 'remove', { userId: member.userId }, `<button class="danger">${e(t['orgs.remove'])}</button>`);
            return `<tr><td>${e(member.name)}${member.email === undefined ? '' : `<br><span class="muted">${e(member.email)}</span>`}</td><td>${roleCell}</td><td>${e(member.groups.join(', '))}</td><td>${remove}</td></tr>`;
        })
        .join('');
    const membersSection = `<h2>${e(t['orgs.membersTitle'])}</h2><p class="muted">${e(t['orgs.membersText'])}</p>
<div class="table"><table><thead><tr><th>${e(t['orgs.person'])}</th><th>${e(t['orgs.role'])}</th><th>${e(t['orgs.groupsTitle'])}</th><th></th></tr></thead><tbody>${members}</tbody></table></div>
${form(org.id, 'leave', {}, `<button class="danger">${e(t['orgs.leave'])}</button>`, 'inline spaced')}`;

    const memberOptions = view.members.map((member) => [member.userId, member.name] as const);
    const groups = view.groups
        .map((group) => {
            const people =
                group.members.length === 0
                    ? `<span class="muted">${e(t['orgs.noMembersInGroup'])}</span>`
                    : group.members.map((userId) => `<span class="chip">${e(nameOf(userId))}${admin ? ` ${form(org.id, 'ungroup', { groupId: group.id, userId }, `<button class="link" aria-label="${e(`${t['orgs.remove']} ${nameOf(userId)}`)}">×</button>`)}` : ''}</span>`).join(' ');
            const add = admin ? form(org.id, 'group', { groupId: group.id }, `${select('userId', memberOptions, undefined, t['orgs.person'])} <button>${e(t['orgs.addToGroup'])}</button>`) : '';
            return `<li><div><strong>${e(group.name)}</strong><div>${people}</div></div><div>${add}</div></li>`;
        })
        .join('');
    const groupsSection = `<h2>${e(t['orgs.groupsTitle'])}</h2><p class="muted">${e(t['orgs.groupsText'])}</p>
${view.groups.length === 0 ? `<p class="muted">${e(t['orgs.noGroups'])}</p>` : `<ul class="list">${groups}</ul>`}
${admin ? form(org.id, 'makeGroup', {}, `<label>${e(t['orgs.groupName'])} <input name="name" required maxlength="100"></label> <button>${e(t['orgs.makeGroup'])}</button>`, 'row') : ''}`;

    const invitesSection = !admin
        ? ''
        : `<h2>${e(t['orgs.invitesTitle'])}</h2><p class="muted">${e(t['orgs.invitesText'])}</p>
${view.invited === undefined ? '' : `<p class="notice" role="status">${e(fill(t['orgs.inviteLink'], { email: view.invited.email }))}<br><code class="link">${e(view.invited.link)}</code></p>`}
${form(
    org.id,
    'invite',
    {},
    `<label>${e(t['orgs.email'])} <input type="email" name="email" required maxlength="320"></label>
<label>${e(t['orgs.role'])} ${select('role', roleNames(role === 'owner' ? ORG_ROLES : ['admin', 'builder', 'member']), 'member')}</label>
${view.groups.length === 0 ? '' : `<fieldset><legend>${e(t['orgs.inviteGroups'])}</legend>${view.groups.map((group) => `<label class="check"><input type="checkbox" name="groups" value="${e(group.id)}"> ${e(group.name)}</label>`).join('')}</fieldset>`}
<button class="primary">${e(t['orgs.invite'])}</button>`,
    'stack'
)}`;

    const principalOf = (entry: AccessEntry): string => (entry.principalKind === 'user' ? nameOf(entry.principalId) : fill(t['orgs.group'], { name: view.groups.find((group) => group.id === entry.principalId)?.name ?? t['orgs.someone'] }));
    const principals = [...view.members.map((member) => [`user:${member.userId}`, member.name] as const), ...view.groups.map((group) => [`group:${group.id}`, fill(t['orgs.group'], { name: group.name })] as const)];
    const apps = view.apps
        .map((app) => {
            const head = `<div class="app-head"><strong>${e(app.name)}</strong> <span class="muted">${e(fill(t['orgs.yourPermission'], { permission: t[`orgs.perm.${app.permission}`] }))}</span> <a class="button" href="/apps/${e(app.id)}">${e(t['orgs.open'])}</a></div>`;
            if (app.entries === undefined) return `<li class="app">${head}</li>`;
            const open = form(org.id, 'open', { appId: app.id, open: app.openToOrg === true ? 'false' : 'true' }, `<button>${e(app.openToOrg === true ? t['orgs.closeToOrg'] : t['orgs.openToOrg'])}</button>`);
            const entries =
                app.entries.length === 0
                    ? `<p class="muted">${e(t['orgs.noAccess'])}</p>`
                    : `<ul class="plain">${app.entries.map((entry) => `<li>${e(principalOf(entry))}: ${e(t[`orgs.perm.${entry.permission}`])} ${form(org.id, 'access', { appId: app.id, principal: `${entry.principalKind}:${entry.principalId}`, permission: '' }, `<button class="link">${e(t['orgs.remove'])}</button>`)}</li>`).join('')}</ul>`;
            const give = form(org.id, 'access', { appId: app.id }, `${select('principal', principals, undefined, t['orgs.who'])} ${select('permission', permissions, 'use', t['orgs.permission'])} <button>${e(t['orgs.give'])}</button>`);
            const users =
                app.users === undefined
                    ? ''
                    : `<h4>${e(t['orgs.usersTitle'])}</h4>${
                          app.users.length === 0
                              ? `<p class="muted">${e(t['orgs.noUsers'])}</p>`
                              : `<ul class="plain">${app.users.map((user) => `<li>${e(user.name)} <span class="muted">${e(fill(t['orgs.lastUsed'], { date: dateOf(view.look, user.updatedAt) }))}</span>${admin ? ` <a href="/settings/orgs/${e(org.id)}/apps/${e(app.id)}/instances/${e(user.userId)}">${e(t['orgs.openInstance'])}</a>` : ''}</li>`).join('')}</ul>`
                      }`;
            return `<li class="app">${head}${app.openToOrg === true ? `<p class="muted">${e(t['orgs.isOpen'])}</p>` : ''}${entries}<div class="row">${give} ${open}</div>${users}</li>`;
        })
        .join('');
    const build =
        view.ownApps === undefined
            ? ''
            : `${form(org.id, 'makeApp', {}, `<label>${e(t['orgs.makeApp'])} <input name="name" required maxlength="60" placeholder="${e(t['orgs.appPlaceholder'])}"></label> <button class="primary">${e(t['orgs.make'])}</button>`, 'row')}
${view.ownApps.length === 0 ? '' : form(org.id, 'moveIn', {}, `<label>${e(t['orgs.moveIn'])} ${select('appId', view.ownApps.map((app) => [app.id, app.name] as const))}</label> <button>${e(t['orgs.moveButton'])}</button><p class="muted">${e(t['orgs.moveText'])}</p>`, 'row')}`;
    const appsSection = `<h2>${e(t['orgs.appsTitle'])}</h2><p class="muted">${e(t['orgs.appsText'])}</p>${view.apps.length === 0 ? `<p class="muted">${e(t['orgs.noApps'])}</p>` : `<ul class="list apps">${apps}</ul>`}${build}`;

    const auditSection =
        view.audit === undefined
            ? ''
            : `<h2>${e(t['orgs.auditTitle'])}</h2><p class="muted">${e(t['orgs.auditText'])}</p>
<div class="table"><table class="audit"><thead><tr><th>${e(t['orgs.when'])}</th><th>${e(t['orgs.who'])}</th><th>${e(t['orgs.what'])}</th><th>${e(t['orgs.detail'])}</th></tr></thead><tbody>${view.audit
                  .map((event) => `<tr><td>${e(dateOf(view.look, event['at'] as Date, true))}</td><td>${e(nameOf(event['actor_id']))}</td><td><code>${e(event['action'])}</code></td><td><code>${e(JSON.stringify(event['detail'] ?? {}))}</code></td></tr>`)
                  .join('')}</tbody></table></div>`;

    const body = `${top(t, org.name, [
        ['/settings/orgs', t['orgs.all']],
        ['/', t['orgs.back']]
    ])}<p class="muted">${e(fill(t['orgs.yourRole'], { role: t[`orgs.role.${role}`] }))}</p>${messages(view)}${membersSection}${groupsSection}${invitesSection}${appsSection}${auditSection}`;
    return page(view.look, `${org.name} · ${t['orgs.pageTitle']}`, body);
}

/** `GET /invites/<token>`: what the invite is for, and a button that joins; or why it does not work */
export function invitePage(view: { readonly look: PageLook; readonly token: string; readonly invite?: { readonly org: Org; readonly email: string; readonly role: OrgRole }; readonly error?: string }): string {
    const t = orgTextsOf(view.look.language);
    const { invite } = view;
    const title = invite === undefined ? t['orgs.inviteGone'] : fill(t['orgs.inviteTitle'], { org: invite.org.name });
    const body =
        invite === undefined
            ? `${top(t, title, [['/', t['orgs.back']]])}${messages(view)}`
            : `${top(t, title, [['/', t['orgs.back']]])}<p>${e(fill(t['orgs.inviteText'], { org: invite.org.name, role: t[`orgs.role.${invite.role}`], email: invite.email }))}</p>${messages(view)}
<form method="post" action="/invites/${e(view.token)}"><button class="primary">${e(t['orgs.accept'])}</button></form>`;
    return page(view.look, `${title} · Magnetic`, body);
}

/** `GET /settings/orgs/<id>/apps/<app>/instances/<user>`: a member's state, read only, for support */
export function supportPage(view: { readonly look: PageLook; readonly org: Org; readonly appName: string; readonly support: SupportView }): string {
    const t = orgTextsOf(view.look.language);
    const { support } = view;
    const title = fill(t['orgs.supportTitle'], { name: support.name, app: view.appName });
    const data = Object.keys(support.data).length === 0 ? `<p class="muted">${e(t['orgs.supportNoData'])}</p>` : `<pre>${e(JSON.stringify(support.data, null, 2))}</pre>`;
    const body = `${top(t, title, [[`/settings/orgs/${view.org.id}`, view.org.name]])}<p class="muted">${e(t['orgs.supportText'])}</p>
<p class="muted">${e(fill(t['orgs.lastUsed'], { date: dateOf(view.look, support.updatedAt, true) }))}</p>
<h2>${e(t['orgs.supportInstance'])}</h2><pre>${e(JSON.stringify(support.instance, null, 2))}</pre>
<h2>${e(t['orgs.supportData'])}</h2>${data}`;
    return page(view.look, `${title} · Magnetic`, body);
}
