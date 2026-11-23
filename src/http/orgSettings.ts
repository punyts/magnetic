import { escapeHtml } from '@punyts/stateui-mcp';
import type { AccessEntry, AppPermission } from '../orgs/AppAccess.js';
import { APP_PERMISSIONS } from '../orgs/AppAccess.js';
import type { InstanceSummary, SupportView } from '../orgs/Instances.js';
import type { Membership, Org, OrgGroup, OrgMember, OrgRole } from '../orgs/Orgs.js';
import { atLeast, ORG_ROLES } from '../orgs/Orgs.js';
import { fill } from './text.js';
import { orgTextsOf } from './orgText.js';
import type { OrgTexts } from './orgText.js';
import type { OrgDomain } from '../orgs/Domains.js';
import type { OrgPolicy } from '../orgs/Policies.js';
import type { OrgSsoSettings } from '../orgs/Sso.js';
import type { OrgSamlSettings } from '../orgs/Saml.js';
import type { OrgScimStatus } from '../orgs/Scim.js';
import type { Permission } from '../permissions/Permissions.js';
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
    readonly invited?: { readonly email: string; readonly link: string; readonly mailed?: boolean };
    /** A SCIM token just made: shown once */
    readonly scimToken?: string;
    /** The org's enterprise controls, for admins and owners */
    readonly enterprise?: EnterpriseView;
}

/** What the org's admins see of its policies, domains, sign-in and spend */
export interface EnterpriseView {
    readonly policy: OrgPolicy;
    /** The models the server offers */
    readonly models: readonly string[];
    readonly domains: readonly OrgDomain[];
    readonly sso: { readonly available: boolean; readonly redirectUri: string; readonly settings?: OrgSsoSettings };
    /** The org's SAML provider: Magnetic's entity id for it, and its settings once set */
    readonly saml: { readonly entityId: string; readonly settings?: OrgSamlSettings };
    /** Whether the org takes its people by SCIM, its base URL, and for owners how it stands */
    readonly scim: { readonly on: boolean; readonly baseUrl: string; readonly status?: OrgScimStatus };
    readonly spend: { readonly month: number; readonly rows: ReadonlyArray<{ readonly person: string; readonly app: string; readonly dollars: number; readonly requests: number }> };
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
export function orgListPage(view: { readonly makeOrgs?: boolean; readonly look: PageLook; readonly orgs: readonly Membership[]; readonly error?: string }): string {
    const t = orgTextsOf(view.look.language);
    const list =
        view.orgs.length === 0
            ? `<p class="muted">${e(t['orgs.none'])}</p>`
            : `<ul class="list">${view.orgs.map((org) => `<li><a href="/settings/orgs/${e(org.id)}">${e(org.name)}</a><span class="muted">${e(t[`orgs.roleName.${org.role}`])}</span></li>`).join('')}</ul>`;
    const make = view.makeOrgs === false ? '' : `<h2>${e(t['orgs.makeTitle'])}</h2>
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
            const remove = member.scim === true ? `<span class="muted">${e(t['orgs.scimMember'])}</span>` : roles.length === 0 ? '' : form(org.id, 'remove', { userId: member.userId }, `<button class="danger">${e(t['orgs.remove'])}</button>`);
            return `<tr><td>${e(member.name)}${member.email === undefined ? '' : `<br><span class="muted">${e(member.email)}</span>`}</td><td>${roleCell}</td><td>${e(member.groups.join(', '))}</td><td>${remove}</td></tr>`;
        })
        .join('');
    const membersSection = `<h2>${e(t['orgs.membersTitle'])}</h2><p class="muted">${e(t['orgs.membersText'])}</p>
<div class="table"><table><thead><tr><th>${e(t['orgs.person'])}</th><th>${e(t['orgs.role'])}</th><th>${e(t['orgs.groupsTitle'])}</th><th></th></tr></thead><tbody>${members}</tbody></table></div>
${view.members.some((member) => member.userId === view.userId && member.scim === true) ? '' : form(org.id, 'leave', {}, `<button class="danger">${e(t['orgs.leave'])}</button>`, 'inline spaced')}`;

    const memberOptions = view.members.map((member) => [member.userId, member.name] as const);
    const groups = view.groups
        .map((group) => {
            const people =
                group.members.length === 0
                    ? `<span class="muted">${e(t['orgs.noMembersInGroup'])}</span>`
                    : group.members.map((userId) => `<span class="chip">${e(nameOf(userId))}${admin && group.scim !== true ? ` ${form(org.id, 'ungroup', { groupId: group.id, userId }, `<button class="link" aria-label="${e(`${t['orgs.remove']} ${nameOf(userId)}`)}">×</button>`)}` : ''}</span>`).join(' ');
            const add = group.scim === true ? `<span class="muted">${e(t['orgs.scimGroup'])}</span>` : admin ? form(org.id, 'group', { groupId: group.id }, `${select('userId', memberOptions, undefined, t['orgs.person'])} <button>${e(t['orgs.addToGroup'])}</button>`) : '';
            return `<li><div><strong>${e(group.name)}</strong><div>${people}</div></div><div>${add}</div></li>`;
        })
        .join('');
    const groupsSection = `<h2>${e(t['orgs.groupsTitle'])}</h2><p class="muted">${e(t['orgs.groupsText'])}</p>
${view.groups.length === 0 ? `<p class="muted">${e(t['orgs.noGroups'])}</p>` : `<ul class="list">${groups}</ul>`}
${admin ? form(org.id, 'makeGroup', {}, `<label>${e(t['orgs.groupName'])} <input name="name" required maxlength="100"></label> <button>${e(t['orgs.makeGroup'])}</button>`, 'row') : ''}`;

    const invitesSection = !admin
        ? ''
        : `<h2>${e(t['orgs.invitesTitle'])}</h2><p class="muted">${e(t['orgs.invitesText'])}</p>
${view.invited === undefined ? '' : `<p class="notice" role="status">${e(fill(t[view.invited.mailed === true ? 'orgs.inviteSent' : 'orgs.inviteLink'], { email: view.invited.email }))}<br><code class="link">${e(view.invited.link)}</code><br>${e(t['orgs.inviteWaits'])}</p>`}
${form(
    org.id,
    'invite',
    {},
    `<label>${e(t['orgs.email'])} <input type="email" name="email" required maxlength="320"></label>
<label>${e(t['orgs.role'])} ${select('role', roleNames(role === 'owner' ? ORG_ROLES : ['admin', 'builder', 'member']), 'member')}</label>
${view.groups.every((group) => group.scim === true) ? '' : `<fieldset><legend>${e(t['orgs.inviteGroups'])}</legend>${view.groups.filter((group) => group.scim !== true).map((group) => `<label class="check"><input type="checkbox" name="groups" value="${e(group.id)}"> ${e(group.name)}</label>`).join('')}</fieldset>`}
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
    ])}<p class="muted">${e(fill(t['orgs.yourRole'], { role: t[`orgs.role.${role}`] }))}</p>${messages(view)}${membersSection}${groupsSection}${invitesSection}${appsSection}${view.enterprise === undefined ? '' : enterpriseSections(t, view, view.enterprise)}${auditSection}`;
    return page(view.look, `${org.name} · ${t['orgs.pageTitle']}`, body);
}

const dollars = (amount: number): string => `$${amount.toFixed(2)}`;

/** Policies, domains, sign-in, spend, and export and deletion: admins see them, owners change sign-in, domains and the org itself */
function enterpriseSections(t: OrgTexts, view: OrgPageView, enterprise: EnterpriseView): string {
    const { org, role } = view;
    const owner = role === 'owner';
    const { policy } = enterprise;
    const check = (name: string, on: boolean, label: string, disabled = false): string =>
        `<label class="check"><input type="checkbox" name="${e(name)}" value="on"${on ? ' checked' : ''}${disabled ? ' disabled' : ''}> ${e(label)}</label>`;
    const models = enterprise.models.map((model) => check('agentModels', policy.agentModels?.includes(model) === true, model)).join('');
    const policies = `<h2>${e(t['orgs.policyTitle'])}</h2>
${form(
    org.id,
    'policy',
    owner ? { sso: '1' } : {},
    `${check('personalWorkspaces', policy.personalWorkspaces, t['orgs.policy.personalWorkspaces'])}
${check('externalLinks', policy.externalLinks, t['orgs.policy.externalLinks'])}
${check('grantsInOrg', policy.grantsInOrg, t['orgs.policy.grantsInOrg'])}
${check('connections', policy.connections, t['orgs.policy.connections'])}
${check('autoJoin', policy.autoJoin, t['orgs.policy.autoJoin'])}${enterprise.scim.on ? `<p class="muted">${e(t['orgs.scimAutoJoin'])}</p>` : ''}
${check('requireSso', policy.requireSso, t['orgs.policy.requireSso'], !owner)}
<fieldset><legend>${e(t['orgs.policy.models'])}</legend>${models}</fieldset>
<label>${e(t['orgs.policy.retention'])} <input type="number" name="retentionDays" min="1" max="3650" value="${e(policy.retentionDays ?? '')}"></label>
<label>${e(t['orgs.policy.budget'])} <input type="number" name="monthlyBudget" min="0" step="0.01" value="${e(policy.monthlyBudget ?? '')}"></label>
<button class="primary">${e(t['orgs.save'])}</button>`,
    'stack wide'
)}`;

    const domainRows = enterprise.domains
        .map((domain) => {
            const status =
                domain.verifiedAt !== undefined
                    ? `<span class="chip">${e(t['orgs.verified'])}</span>`
                    : `<span class="muted">${e(t['orgs.notVerified'])}</span><br><code class="link">${e(domain.recordName)}</code> TXT <code class="link">${e(domain.recordValue)}</code>${owner ? ` ${form(org.id, 'verifyDomain', { domain: domain.domain }, `<button>${e(t['orgs.verify'])}</button>`)}` : ''}`;
            return `<li><div><strong>${e(domain.domain)}</strong><div>${status}</div></div><div>${owner ? form(org.id, 'removeDomain', { domain: domain.domain }, `<button class="danger">${e(t['orgs.remove'])}</button>`) : ''}</div></li>`;
        })
        .join('');
    const domains = `<h2>${e(t['orgs.domainsTitle'])}</h2><p class="muted">${e(t['orgs.domainsText'])}</p>
${enterprise.domains.length === 0 ? `<p class="muted">${e(t['orgs.noDomains'])}</p>` : `<ul class="list">${domainRows}</ul>`}
${owner ? form(org.id, 'addDomain', {}, `<label>${e(t['orgs.domain'])} <input name="domain" required maxlength="253" placeholder="example.com"></label> <button>${e(t['orgs.addDomain'])}</button>`, 'row') : ''}`;

    const settings = enterprise.sso.settings;
    const ssoForm = !enterprise.sso.available
        ? `<p class="muted">${e(t['orgs.ssoUnavailable'])}</p>`
        : `<p class="muted">${e(t['orgs.ssoText'])}<br><code class="link">${e(enterprise.sso.redirectUri)}</code></p>
<p>${e(settings?.enabled === true ? t['orgs.ssoOn'] : t['orgs.ssoOff'])}</p>
${
    owner
        ? form(
              org.id,
              'sso',
              {},
              `<label>${e(t['orgs.issuer'])} <input type="url" name="issuer" required value="${e(settings?.issuer ?? '')}" placeholder="https://"></label>
<label>${e(t['orgs.clientId'])} <input name="clientId" required value="${e(settings?.clientId ?? '')}"></label>
<label>${e(t['orgs.clientSecret'])} <input type="password" name="clientSecret" autocomplete="off"></label>
${check('enabled', settings?.enabled === true, t['orgs.ssoEnabled'])}
<button class="primary">${e(t['orgs.save'])}</button>`,
              'stack wide'
          )
        : settings === undefined
          ? ''
          : `<p class="muted">${e(t['orgs.issuer'])}: ${e(settings.issuer)}</p>`
}`;
    const saml = enterprise.saml.settings;
    const samlStatus = [
        saml === undefined ? '' : `<p class="muted">${e(fill(t['orgs.samlProvider'], { entityId: saml.entityId }))}${saml.fetchedAt === undefined ? '' : `<br>${e(fill(t['orgs.samlFetched'], { at: saml.fetchedAt.slice(0, 16).replace('T', ' ') }))}`}</p>`,
        saml?.fetchError === undefined ? '' : `<p class="error">${e(fill(t['orgs.samlFetchError'], { error: saml.fetchError }))}</p>`
    ].join('');
    const samlForm = `<p class="muted">${e(t['orgs.samlText'])}<br><code class="link">${e(enterprise.saml.entityId)}</code></p>
<p>${e(saml?.enabled === true ? t['orgs.ssoOn'] : t['orgs.ssoOff'])}</p>${samlStatus}
${
    owner
        ? form(
              org.id,
              'saml',
              {},
              `<label>${e(t['orgs.metadataUrl'])} <input type="url" name="metadataUrl" maxlength="2048" value="${e(saml?.metadataUrl ?? '')}" placeholder="https://"></label>
<label>${e(t['orgs.metadataXml'])} <textarea name="metadataXml" rows="4"></textarea></label>
${saml === undefined ? '' : `<p class="muted">${e(t['orgs.metadataKeep'])}</p>`}
<label>${e(t['orgs.emailAttribute'])} <input name="emailAttribute" maxlength="500" value="${e(saml?.emailAttribute ?? '')}"></label>
${check('enabled', saml?.enabled === true, t['orgs.ssoEnabled'])}
<button class="primary">${e(t['orgs.save'])}</button>`,
              'stack wide'
          )
        : ''
}`;
    const sso = `<h2>${e(t['orgs.ssoTitle'])}</h2><p class="muted">${e(t['orgs.samlOneKind'])}</p>${ssoForm}<h2>${e(t['orgs.samlTitle'])}</h2>${samlForm}${owner ? scimSection(t, view, enterprise.scim) : ''}`;

    const total = policy.monthlyBudget === undefined ? fill(t['orgs.spendNoBudget'], { spent: dollars(enterprise.spend.month) }) : fill(t['orgs.spendTotal'], { spent: dollars(enterprise.spend.month), budget: dollars(policy.monthlyBudget) });
    const spend = `<h2>${e(t['orgs.spendTitle'])}</h2><p>${e(total)}</p>${
        enterprise.spend.rows.length === 0
            ? ''
            : `<div class="table"><table><thead><tr><th>${e(t['orgs.person'])}</th><th>${e(t['orgs.app'])}</th><th>${e(t['orgs.dollars'])}</th><th>${e(t['orgs.requests'])}</th></tr></thead><tbody>${enterprise.spend.rows
                  .map((row) => `<tr><td>${e(row.person)}</td><td>${e(row.app)}</td><td>${e(dollars(row.dollars))}</td><td>${e(row.requests)}</td></tr>`)
                  .join('')}</tbody></table></div>`
    }`;

    const danger = !owner
        ? ''
        : `<h2>${e(t['orgs.dangerTitle'])}</h2><p><a class="button" href="/orgs/${e(org.id)}/export">${e(t['orgs.export'])}</a></p>
<p class="muted">${e(t['orgs.deleteText'])}</p>
${form(org.id, 'deleteOrg', {}, `<label>${e(t['orgs.confirm'])} <input name="confirm" required autocomplete="off" placeholder="${e(org.slug)}"></label> <button class="danger">${e(t['orgs.delete'])}</button>`, 'row')}`;
    return `${policies}${domains}${sso}${spend}${danger}`;
}

/** The owner's SCIM section: off, with the button that turns it on; or on, with the base URL, the token once, how it stands, and its buttons */
function scimSection(t: OrgTexts, view: OrgPageView, scim: EnterpriseView['scim']): string {
    const { org } = view;
    const head = `<h2>${e(t['orgs.scimTitle'])}</h2><p class="muted">${e(t['orgs.scimText'])}</p>`;
    const status = scim.status;
    if (status === undefined) return `${head}<p>${e(t['orgs.scimOff'])}</p>${form(org.id, 'scimOn', {}, `<button class="primary">${e(t['orgs.scimEnable'])}</button>`)}`;
    const at = (value: string): string => dateOf(view.look, value, true);
    const token = view.scimToken === undefined ? '' : `<p class="notice" role="status">${e(t['orgs.scimTokenOnce'])}<br><code class="link">${e(view.scimToken)}</code></p>`;
    return `${head}<p>${e(t['orgs.ssoOn'])}</p>${token}<p class="muted">${e(t['orgs.scimBaseUrl'])}<br><code class="link">${e(scim.baseUrl)}</code></p>
<p class="muted">${e(fill(t['orgs.scimMade'], { at: at(status.createdAt) }))} ${e(status.lastUsedAt === undefined ? t['orgs.scimNeverUsed'] : fill(t['orgs.scimUsed'], { at: at(status.lastUsedAt) }))}<br>${e(fill(t['orgs.scimCounts'], { users: String(status.users), held: String(status.held), groups: String(status.groups) }))}</p>
<div class="row">${form(org.id, 'scimToken', {}, `<button>${e(t['orgs.scimNewToken'])}</button>`)}</div>
<p class="muted">${e(t['orgs.scimDisableText'])}</p>${form(org.id, 'scimOff', {}, `<button class="danger">${e(t['orgs.scimDisable'])}</button>`)}`;
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

/** What Shared by me shows */
export interface SharedPageView {
    readonly look: PageLook;
    readonly entries: readonly Permission[];
    /** The names of subjects (`owner:<number>`), orgs by number (`org:<number>`) and groups (`group:<id>`) */
    readonly names: ReadonlyMap<string, string>;
    /** Apps' names by id */
    readonly apps: ReadonlyMap<string, string>;
    readonly notice?: string;
    readonly error?: string;
}

/** `GET /settings/shared`: every permission entry on the person's state and apps and every one they made, with Revoke */
export function sharedPage(view: SharedPageView): string {
    const t = orgTextsOf(view.look.language);
    const date = (at: string | undefined, none: string): string => (at === undefined ? none : new Date(at).toISOString().slice(0, 16).replace('T', ' '));
    const orgName = (number: string): string => view.names.get(`org:${number}`) ?? number;
    const holder = (entry: Permission): string => {
        if (entry.kind === 'org-read') return t['shared.orgRead'];
        if (entry.kind === 'link.view') return t['shared.linkView'];
        if (entry.kind === 'link.use') return t['shared.linkUse'];
        if (entry.kind === 'link.remix') return t['shared.linkRemix'];
        const subject = entry.subject;
        if (subject === 'everyone') return t['shared.everyone'];
        if (subject.startsWith('owner:')) {
            const name = view.names.get(subject) ?? subject.slice('owner:'.length);
            return entry.kind === 'opened' ? fill(t['shared.opened'], { name }) : name;
        }
        const members = /^members:([0-9]+)(?:\.([a-z]+))?$/.exec(subject);
        if (members !== null) return members[2] === undefined ? fill(t['shared.members'], { org: orgName(members[1] as string) }) : fill(t['shared.role'], { org: orgName(members[1] as string), role: members[2] });
        const group = /^group:[0-9]+\.(.+)$/.exec(subject);
        if (group !== null) return fill(t['shared.group'], { name: view.names.get(`group:${group[1] as string}`) ?? (group[1] as string) });
        return subject;
    };
    const covers = (entry: Permission): { what: string; path: string } => {
        const [, branch, name = '', ...rest] = entry.pattern.split('.');
        const path = ['$', ...rest].join('.');
        if (branch === 'data') return { what: fill(t['shared.dataset'], { name }), path };
        if (branch === 'apps') return { what: name === '*' ? t['shared.allApps'] : (view.apps.get(name) ?? name), path };
        return { what: '', path: entry.pattern };
    };
    const rows = view.entries
        .map((entry) => {
            const { what, path } = covers(entry);
            const rights = entry.rights.map((right) => t[`shared.${right}`]).join(', ');
            const until = entry.revokedAt !== undefined ? t['shared.revoked'] : entry.until === undefined ? t['shared.standing'] : date(entry.until, '');
            const revoke = entry.revokedAt !== undefined ? '' : `<form method="post" action="/settings/shared" class="inline"><input type="hidden" name="id" value="${e(entry.id)}"><button class="danger">${e(t['shared.revoke'])}</button></form>`;
            return `<tr><td>${e(holder(entry))}</td><td>${e(what)}</td><td><code>${e(path)}</code></td><td>${e(rights)}</td><td>${e(until)}</td><td>${e(date(entry.lastUsedAt, t['shared.never']))}</td><td>${revoke}</td></tr>`;
        })
        .join('');
    const table =
        view.entries.length === 0
            ? `<p class="muted">${e(t['shared.none'])}</p>`
            : `<div class="table"><table><thead><tr><th>${e(t['shared.to'])}</th><th>${e(t['shared.app'])}</th><th>${e(t['shared.what'])}</th><th>${e(t['shared.rights'])}</th><th>${e(t['shared.until'])}</th><th>${e(t['shared.used'])}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
    return page(view.look, t['shared.pageTitle'], `${top(t, t['shared.title'], [['/', t['shared.back']]])}<p class="muted">${e(t['shared.intro'])}</p>${messages(view)}${table}`);
}
