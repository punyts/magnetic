import type { Connection, ConnectionAuth, Endpoint } from '../connections/Connections.js';
import { METHODS } from '../connections/Connections.js';
import { escapeHtml } from '@punyts/stateui-mcp';
import { connectionTextsOf } from './connectionText.js';
import type { ConnectionTexts, Said } from './connectionText.js';
import { htmlOpen } from './pages.js';
import type { PageLook } from './pages.js';
import { fill } from './text.js';

/** A workspace whose connections the person can manage: their own (`own`), or an org's they are an admin or owner of */
export interface ManagedWorkspace {
    readonly id: string;
    readonly name: string;
    readonly own?: boolean;
}

/** What `GET /settings/connections` shows */
export interface ConnectionsView {
    readonly look: PageLook;
    readonly workspaces: readonly ManagedWorkspace[];
    readonly workspace: ManagedWorkspace;
    readonly connections: readonly Connection[];
    /** Where an OAuth provider sends the person back, to register with it */
    readonly redirectUri: string;
    /** True: the workspace's org has turned connections off */
    readonly off?: boolean;
    readonly notice?: Said;
    readonly error?: Said;
    /**
     * After Connect: the provider's sign-in page, followed by a link. The page's `form-action 'self'` stops a form's
     * redirect to another site, so the sign-in is a link the person follows
     */
    readonly continueTo?: { readonly url: string; readonly host: string };
    /** The answer of the last Try, by connection and endpoint */
    readonly tried?: { readonly connection: string; readonly endpoint: string; readonly status: string; readonly body: string };
}

const e = (value: unknown): string => escapeHtml(String(value));

/** What a change said, in the page's language: a reason from the server is shown as it came */
function said(t: ConnectionTexts, what: Said): string {
    return typeof what === 'string' ? what : fill(t[what.key], { ...what.values });
}

/** A workspace's name as the page shows it: the person's own is "Yours" in their language */
const nameOf = (t: ConnectionTexts, workspace: ManagedWorkspace): string => (workspace.own === true ? t['connections.own'] : workspace.name);

function form(workspaceId: string, action: string, fields: Record<string, string>, inner: string, className = 'inline'): string {
    const hidden = Object.entries({ w: workspaceId, do: action, ...fields })
        .map(([name, value]) => `<input type="hidden" name="${e(name)}" value="${e(value)}">`)
        .join('');
    return `<form method="post" action="/settings/connections" class="${className}">${hidden}${inner}</form>`;
}

const field = (label: string, name: string, attributes = '', value = ''): string => `<label>${e(label)} <input name="${e(name)}" value="${e(value)}" ${attributes}></label>`;

/** The fields of a sign-in, filled with the current one when there is one */
function authFields(t: ConnectionTexts, auth?: ConnectionAuth): string {
    const kind = auth?.kind ?? 'none';
    const key = auth?.kind === 'key' ? auth : undefined;
    const oauth = auth?.kind === 'oauth-client' || auth?.kind === 'oauth-code' ? auth : undefined;
    const options = [
        ['none', t['connections.kind.none']],
        ['key', t['connections.kind.key']],
        ['oauth-client', t['connections.kind.oauthClient']],
        ['oauth-code', t['connections.kind.oauthCode']]
    ]
        .map(([value, text]) => `<option value="${value}"${value === kind ? ' selected' : ''}>${e(text)}</option>`)
        .join('');
    return [
        `<label>${e(t['connections.signIn'])} <select name="kind">${options}</select></label>`,
        `<fieldset><legend>${e(t['connections.forKey'])}</legend>`,
        `<label>${e(t['connections.sentIn'])} <select name="keyIn"><option value="header"${key?.in !== 'query' ? ' selected' : ''}>${e(t['connections.in.header'])}</option><option value="query"${key?.in === 'query' ? ' selected' : ''}>${e(t['connections.in.query'])}</option></select></label>`,
        field(t['connections.keyName'], 'keyName', 'maxlength="64" placeholder="Authorization"', key?.name ?? ''),
        field(t['connections.keyPrefix'], 'keyPrefix', 'maxlength="40" placeholder="Bearer "', key?.prefix ?? ''),
        '</fieldset>',
        `<fieldset><legend>${e(t['connections.forOauth'])}</legend>`,
        field(t['connections.clientId'], 'clientId', 'maxlength="300"', oauth?.clientId ?? ''),
        field(t['connections.tokenUrl'], 'tokenUrl', 'type="url" maxlength="500"', oauth?.tokenUrl ?? ''),
        field(t['connections.authorizeUrl'], 'authorizeUrl', 'type="url" maxlength="500"', auth?.kind === 'oauth-code' ? auth.authorizeUrl : ''),
        field(t['connections.scope'], 'scope', 'maxlength="500"', oauth?.scope ?? ''),
        '</fieldset>'
    ].join('\n');
}

function authLine(t: ConnectionTexts, connection: Connection): string {
    const auth = connection.auth;
    const state = (set: boolean): string => (set ? t['connections.state.set'] : t['connections.state.notSet']);
    switch (auth.kind) {
        case 'none':
            return t['connections.auth.none'];
        case 'key':
            return fill(t[auth.in === 'header' ? 'connections.auth.keyHeader' : 'connections.auth.keyQuery'], { name: auth.name, state: state(connection.keySet) });
        case 'oauth-client':
            return fill(t['connections.auth.oauthClient'], { client: auth.clientId, state: state(connection.clientSecretSet) });
        case 'oauth-code':
            return fill(t['connections.auth.oauthCode'], {
                client: auth.clientId,
                state: state(connection.clientSecretSet),
                connected: connection.connected ? t['connections.state.connected'] : t['connections.state.notConnected']
            });
    }
}

function endpointRow(t: ConnectionTexts, view: ConnectionsView, connection: Connection, endpoint: Endpoint): string {
    const query = Object.entries(endpoint.query ?? {})
        .map(([key, value]) => `${key}=${value}`)
        .join('&');
    const tried = view.tried !== undefined && view.tried.connection === connection.name && view.tried.endpoint === endpoint.name ? view.tried : undefined;
    return [
        `<tr><td><code>${e(endpoint.name)}</code></td><td>${e(endpoint.method)} <code>${e(endpoint.path)}</code>${query === '' ? '' : ` <code>?${e(query)}</code>`}</td><td>${endpoint.records === undefined ? e(t['connections.answersValue']) : `${e(t['connections.answersRecords'])} <code>${e(endpoint.records)}</code>`}</td>`,
        '<td>',
        view.off === true
            ? ''
            : form(
                  view.workspace.id,
                  'try',
                  { id: connection.id, endpoint: endpoint.name },
                  `<input name="params" aria-label="${e(fill(t['connections.paramsOf'], { name: endpoint.name }))}" placeholder="city=oslo&amp;units=metric" maxlength="2000"> <button>${e(t['connections.try'])}</button>`
              ),
        form(view.workspace.id, 'removeEndpoint', { id: connection.id, endpoint: endpoint.name }, `<button class="link" aria-label="${e(fill(t['connections.removeOf'], { name: endpoint.name }))}">${e(t['connections.remove'])}</button>`),
        '</td></tr>',
        tried === undefined ? '' : `<tr><td colspan="4"><p class="muted">${e(fill(t['connections.answered'], { status: tried.status }))}</p><pre class="answer">${e(tried.body)}</pre></td></tr>`
    ].join('');
}

function connectionSection(t: ConnectionTexts, view: ConnectionsView, connection: Connection): string {
    const w = view.workspace.id;
    const secretField = connection.auth.kind === 'key' ? 'key' : connection.auth.kind === 'none' ? undefined : 'clientSecret';
    const isSet = secretField === undefined ? false : connection[secretField === 'key' ? 'keySet' : 'clientSecretSet'];
    return [
        `<section class="connection" aria-labelledby="c-${e(connection.name)}">`,
        `<h2 id="c-${e(connection.name)}">${e(connection.name)}</h2>`,
        `<p><code>${e(connection.baseUrl)}</code></p>`,
        `<p class="muted">${e(authLine(t, connection))}</p>`,
        secretField === undefined
            ? ''
            : form(
                  w,
                  'secret',
                  { id: connection.id, field: secretField },
                  `<label>${e(secretField === 'key' ? t['connections.key'] : t['connections.clientSecret'])} <input name="value" type="password" autocomplete="off" maxlength="4000" placeholder="${e(isSet ? t['connections.secretIsSet'] : t['connections.secretNotSet'])}"></label> <button>${e(t['connections.keep'])}</button>`
              ),
        connection.auth.kind === 'oauth-code' ? form(w, 'connect', { id: connection.id }, `<button class="primary">${e(connection.connected ? t['connections.connectAgain'] : t['connections.connect'])}</button>`) : '',
        `<h3>${e(t['connections.endpoints'])}</h3>`,
        connection.endpoints.length === 0
            ? `<p class="muted">${e(t['connections.noEndpoints'])}</p>`
            : `<div class="table"><table><thead><tr><th>${e(t['connections.column.name'])}</th><th>${e(t['connections.column.call'])}</th><th>${e(t['connections.column.answers'])}</th><th></th></tr></thead><tbody>${connection.endpoints.map((endpoint) => endpointRow(t, view, connection, endpoint)).join('')}</tbody></table></div>`,
        `<details><summary>${e(t['connections.addEndpoint'])}</summary>`,
        form(
            w,
            'endpoint',
            { id: connection.id },
            [
                field(t['connections.name'], 'name', 'required maxlength="40" pattern="[a-z][a-z0-9-]*" placeholder="forecast"'),
                `<label>${e(t['connections.method'])} <select name="method">${METHODS.map((method) => `<option>${method}</option>`).join('')}</select></label>`,
                field(t['connections.path'], 'path', 'required maxlength="500" placeholder="/forecast/{city}"'),
                `<label>${e(t['connections.query'])} <textarea name="query" rows="3" maxlength="2000" placeholder="units={units}"></textarea></label>`,
                `<label>${e(t['connections.body'])} <textarea name="body" rows="3" maxlength="8000" placeholder='{"title": "{title}"}'></textarea></label>`,
                field(t['connections.records'], 'records', 'maxlength="200" placeholder="data.items"'),
                `<button class="primary">${e(t['connections.addTheEndpoint'])}</button>`
            ].join('\n'),
            'stack'
        ),
        '</details>',
        `<details><summary>${e(t['connections.change'])}</summary>`,
        form(w, 'update', { id: connection.id }, [field(t['connections.baseUrl'], 'baseUrl', 'type="url" required maxlength="500"', connection.baseUrl), authFields(t, connection.auth), `<button>${e(t['connections.save'])}</button>`].join('\n'), 'stack'),
        '</details>',
        form(
            w,
            'remove',
            { id: connection.id },
            `<label class="check"><input type="checkbox" name="confirm" value="yes" required> ${e(fill(t['connections.deleteBox'], { name: connection.name }))}</label> <button class="danger">${e(t['connections.delete'])}</button>`
        ),
        '</section>'
    ].join('\n');
}

/** `GET /settings/connections`: a workspace's connections to outside APIs, and making one */
export function connectionsPage(view: ConnectionsView): string {
    const t = connectionTextsOf(view.look.language);
    const w = view.workspace.id;
    const here = nameOf(t, view.workspace);
    const tabs =
        view.workspaces.length < 2
            ? ''
            : `<nav class="tabs">${view.workspaces.map((workspace) => (workspace.id === w ? `<strong>${e(nameOf(t, workspace))}</strong>` : `<a href="/settings/connections?w=${e(workspace.id)}">${e(nameOf(t, workspace))}</a>`)).join(' · ')}</nav>`;
    const body = [
        `<header><h1>${e(t['connections.title'])}</h1><nav><a class="button" href="/">${e(t['connections.back'])}</a></nav></header>`,
        `<p class="muted">${e(t['connections.intro'])}</p>`,
        tabs,
        view.off === true ? `<p class="notice" role="note">${e(fill(t['connections.off'], { org: here }))}</p>` : '',
        view.notice === undefined ? '' : `<p class="notice" role="status">${e(said(t, view.notice))}</p>`,
        view.continueTo === undefined
            ? ''
            : `<p class="notice" role="status">${e(t['connections.continue'])} <a class="button primary" href="${e(view.continueTo.url)}">${e(fill(t['connections.signInAt'], { host: view.continueTo.host }))}</a></p>`,
        view.error === undefined ? '' : `<p class="error" role="alert">${e(said(t, view.error))}</p>`,
        view.connections.length === 0 ? `<p class="muted">${e(fill(t['connections.none'], { workspace: here }))}</p>` : view.connections.map((connection) => connectionSection(t, view, connection)).join('\n'),
        `<h2>${e(t['connections.makeTitle'])}</h2>`,
        form(
            w,
            'create',
            {},
            [
                field(t['connections.name'], 'name', 'required maxlength="40" pattern="[a-z][a-z0-9-]*" placeholder="weather"'),
                field(t['connections.baseUrl'], 'baseUrl', 'type="url" required maxlength="500" placeholder="https://api.example.com/v1"'),
                authFields(t),
                `<label>${e(t['connections.secret'])} <input name="secret" type="password" autocomplete="off" maxlength="4000"></label>`,
                `<p class="muted">${e(t['connections.redirect'])} <code>${e(view.redirectUri)}</code></p>`,
                `<button class="primary">${e(t['connections.make'])}</button>`
            ].join('\n'),
            'stack'
        )
    ].join('\n');
    return [
        '<!doctype html>',
        htmlOpen(view.look),
        '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
        `<title>${e(t['connections.pageTitle'])}</title>`,
        '<link rel="stylesheet" href="/assets/magnetic.css"></head>',
        `<body><main class="settings">${body}</main></body></html>`
    ].join('\n');
}
