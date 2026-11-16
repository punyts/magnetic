import type { Connection, ConnectionAuth, Endpoint } from '../connections/Connections.js';
import { METHODS } from '../connections/Connections.js';
import { escapeHtml } from '@punyts/stateui-mcp';
import { htmlOpen } from './pages.js';
import type { PageLook } from './pages.js';

/** A workspace whose connections the person can manage: their own, or an org's they are an admin or owner of */
export interface ManagedWorkspace {
    readonly id: string;
    readonly name: string;
}

/** What `GET /settings/connections` shows */
export interface ConnectionsView {
    readonly look: PageLook;
    readonly workspaces: readonly ManagedWorkspace[];
    readonly workspace: ManagedWorkspace;
    readonly connections: readonly Connection[];
    /** Where an OAuth provider sends the person back, to register with it */
    readonly redirectUri: string;
    readonly notice?: string;
    readonly error?: string;
    /**
     * After Connect: the provider's sign-in page, followed by a link. The page's `form-action 'self'` stops a form's
     * redirect to another site, so the sign-in is a link the person follows
     */
    readonly continueTo?: { readonly url: string; readonly host: string };
    /** The answer of the last Try, by connection and endpoint */
    readonly tried?: { readonly connection: string; readonly endpoint: string; readonly status: string; readonly body: string };
}

const e = (value: unknown): string => escapeHtml(String(value));

function form(workspaceId: string, action: string, fields: Record<string, string>, inner: string, className = 'inline'): string {
    const hidden = Object.entries({ w: workspaceId, do: action, ...fields })
        .map(([name, value]) => `<input type="hidden" name="${e(name)}" value="${e(value)}">`)
        .join('');
    return `<form method="post" action="/settings/connections" class="${className}">${hidden}${inner}</form>`;
}

const field = (label: string, name: string, attributes = '', value = ''): string => `<label>${e(label)} <input name="${e(name)}" value="${e(value)}" ${attributes}></label>`;

/** The fields of a sign-in, filled with the current one when there is one */
function authFields(auth?: ConnectionAuth): string {
    const kind = auth?.kind ?? 'none';
    const key = auth?.kind === 'key' ? auth : undefined;
    const oauth = auth?.kind === 'oauth-client' || auth?.kind === 'oauth-code' ? auth : undefined;
    const options = [
        ['none', 'None'],
        ['key', 'A key'],
        ['oauth-client', 'OAuth 2, client credentials'],
        ['oauth-code', 'OAuth 2, someone signs in (Connect)']
    ]
        .map(([value, text]) => `<option value="${value}"${value === kind ? ' selected' : ''}>${text}</option>`)
        .join('');
    return [
        `<label>Sign-in <select name="kind">${options}</select></label>`,
        '<fieldset><legend>For a key</legend>',
        `<label>Sent in <select name="keyIn"><option value="header"${key?.in !== 'query' ? ' selected' : ''}>a header</option><option value="query"${key?.in === 'query' ? ' selected' : ''}>the query</option></select></label>`,
        field('Header or parameter name', 'keyName', 'maxlength="64" placeholder="Authorization"', key?.name ?? ''),
        field('Before the key', 'keyPrefix', 'maxlength="40" placeholder="Bearer "', key?.prefix ?? ''),
        '</fieldset>',
        '<fieldset><legend>For OAuth 2</legend>',
        field('Client id', 'clientId', 'maxlength="300"', oauth?.clientId ?? ''),
        field('Token URL', 'tokenUrl', 'type="url" maxlength="500"', oauth?.tokenUrl ?? ''),
        field('Sign-in URL (for Connect)', 'authorizeUrl', 'type="url" maxlength="500"', auth?.kind === 'oauth-code' ? auth.authorizeUrl : ''),
        field('Scope', 'scope', 'maxlength="500"', oauth?.scope ?? ''),
        '</fieldset>'
    ].join('\n');
}

function authLine(connection: Connection): string {
    const auth = connection.auth;
    switch (auth.kind) {
        case 'none':
            return 'No sign-in.';
        case 'key':
            return `A key in the ${auth.in === 'header' ? `${auth.name} header` : `${auth.name} query parameter`}: ${connection.keySet ? 'set' : 'not set yet'}.`;
        case 'oauth-client':
            return `OAuth 2 client credentials as ${auth.clientId}; client secret ${connection.clientSecretSet ? 'set' : 'not set yet'}.`;
        case 'oauth-code':
            return `OAuth 2 sign-in as ${auth.clientId}; client secret ${connection.clientSecretSet ? 'set' : 'not set'}; ${connection.connected ? 'connected' : 'not connected yet'}.`;
    }
}

function endpointRow(view: ConnectionsView, connection: Connection, endpoint: Endpoint): string {
    const query = Object.entries(endpoint.query ?? {})
        .map(([key, value]) => `${key}=${value}`)
        .join('&');
    const tried = view.tried !== undefined && view.tried.connection === connection.name && view.tried.endpoint === endpoint.name ? view.tried : undefined;
    return [
        `<tr><td><code>${e(endpoint.name)}</code></td><td>${e(endpoint.method)} <code>${e(endpoint.path)}</code>${query === '' ? '' : ` <code>?${e(query)}</code>`}</td><td>${endpoint.records === undefined ? 'a value' : `records at <code>${e(endpoint.records)}</code>`}</td>`,
        '<td>',
        form(view.workspace.id, 'try', { id: connection.id, endpoint: endpoint.name }, `<input name="params" aria-label="Params of ${e(endpoint.name)}" placeholder="city=oslo&amp;units=metric" maxlength="2000"> <button>Try</button>`),
        form(view.workspace.id, 'removeEndpoint', { id: connection.id, endpoint: endpoint.name }, `<button class="link" aria-label="Remove ${e(endpoint.name)}">Remove</button>`),
        '</td></tr>',
        tried === undefined ? '' : `<tr><td colspan="4"><p class="muted">Answered ${e(tried.status)}:</p><pre class="answer">${e(tried.body)}</pre></td></tr>`
    ].join('');
}

function connectionSection(view: ConnectionsView, connection: Connection): string {
    const w = view.workspace.id;
    const secretField = connection.auth.kind === 'key' ? 'key' : connection.auth.kind === 'none' ? undefined : 'clientSecret';
    return [
        `<section class="connection" aria-labelledby="c-${e(connection.name)}">`,
        `<h2 id="c-${e(connection.name)}">${e(connection.name)}</h2>`,
        `<p><code>${e(connection.baseUrl)}</code></p>`,
        `<p class="muted">${e(authLine(connection))}</p>`,
        secretField === undefined
            ? ''
            : form(
                  w,
                  'secret',
                  { id: connection.id, field: secretField },
                  `<label>${secretField === 'key' ? 'Key' : 'Client secret'} <input name="value" type="password" autocomplete="off" maxlength="4000" placeholder="${connection[secretField === 'key' ? 'keySet' : 'clientSecretSet'] ? 'Set: type a new one to replace it' : 'Not set'}"></label> <button>Keep it</button>`
              ),
        connection.auth.kind === 'oauth-code' ? form(w, 'connect', { id: connection.id }, `<button class="primary">${connection.connected ? 'Connect again' : 'Connect'}</button>`) : '',
        '<h3>Endpoints</h3>',
        connection.endpoints.length === 0
            ? '<p class="muted">No endpoints yet: an app can call only the endpoints named here.</p>'
            : `<div class="table"><table><thead><tr><th>Name</th><th>Call</th><th>Answers</th><th></th></tr></thead><tbody>${connection.endpoints.map((endpoint) => endpointRow(view, connection, endpoint)).join('')}</tbody></table></div>`,
        '<details><summary>Add an endpoint</summary>',
        form(
            w,
            'endpoint',
            { id: connection.id },
            [
                field('Name', 'name', 'required maxlength="40" pattern="[a-z][a-z0-9-]*" placeholder="forecast"'),
                `<label>Method <select name="method">${METHODS.map((method) => `<option>${method}</option>`).join('')}</select></label>`,
                field('Path', 'path', 'required maxlength="500" placeholder="/forecast/{city}"'),
                `<label>Query, one per line <textarea name="query" rows="3" maxlength="2000" placeholder="units={units}"></textarea></label>`,
                `<label>JSON body (POST, PUT, PATCH) <textarea name="body" rows="3" maxlength="8000" placeholder='{"title": "{title}"}'></textarea></label>`,
                field('Records at (a dotted path in the answer; empty for the whole answer)', 'records', 'maxlength="200" placeholder="data.items"'),
                '<button class="primary">Add the endpoint</button>'
            ].join('\n'),
            'stack'
        ),
        '</details>',
        '<details><summary>Change the address or sign-in</summary>',
        form(w, 'update', { id: connection.id }, [field('Base URL', 'baseUrl', 'type="url" required maxlength="500"', connection.baseUrl), authFields(connection.auth), '<button>Save</button>'].join('\n'), 'stack'),
        '</details>',
        form(w, 'remove', { id: connection.id }, `<label class="check"><input type="checkbox" name="confirm" value="yes" required> Delete ${e(connection.name)}: apps that call it stop working</label> <button class="danger">Delete</button>`),
        '</section>'
    ].join('\n');
}

/** `GET /settings/connections`: a workspace's connections to outside APIs, and making one */
export function connectionsPage(view: ConnectionsView): string {
    const w = view.workspace.id;
    const tabs =
        view.workspaces.length < 2
            ? ''
            : `<nav class="tabs">${view.workspaces.map((workspace) => (workspace.id === w ? `<strong>${e(workspace.name)}</strong>` : `<a href="/settings/connections?w=${e(workspace.id)}">${e(workspace.name)}</a>`)).join(' · ')}</nav>`;
    const body = [
        `<header><h1>Connections</h1><nav><a class="button" href="/">Your apps</a></nav></header>`,
        '<p class="muted">Outside APIs the apps of a workspace can call. Their keys and secrets stay on the server: no app, page or agent ever sees them. An app calls only the endpoints named here, on the connection\'s own host.</p>',
        tabs,
        view.notice === undefined ? '' : `<p class="notice" role="status">${e(view.notice)}</p>`,
        view.continueTo === undefined ? '' : `<p class="notice" role="status">Sign in at the provider to connect it: <a class="button primary" href="${e(view.continueTo.url)}">Sign in at ${e(view.continueTo.host)}</a></p>`,
        view.error === undefined ? '' : `<p class="error" role="alert">${e(view.error)}</p>`,
        view.connections.length === 0 ? `<p class="muted">${e(view.workspace.name)} has no connections yet.</p>` : view.connections.map((connection) => connectionSection(view, connection)).join('\n'),
        '<h2>Make a connection</h2>',
        form(
            w,
            'create',
            {},
            [
                field('Name', 'name', 'required maxlength="40" pattern="[a-z][a-z0-9-]*" placeholder="weather"'),
                field('Base URL', 'baseUrl', 'type="url" required maxlength="500" placeholder="https://api.example.com/v1"'),
                authFields(),
                `<label>Key or client secret <input name="secret" type="password" autocomplete="off" maxlength="4000"></label>`,
                `<p class="muted">For OAuth sign-in, register this redirect URI with the provider: <code>${e(view.redirectUri)}</code></p>`,
                '<button class="primary">Make the connection</button>'
            ].join('\n'),
            'stack'
        )
    ].join('\n');
    return ['<!doctype html>', htmlOpen(view.look), '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">', '<title>Connections · Magnetic</title>', '<link rel="stylesheet" href="/assets/magnetic.css"></head>', `<body><main class="settings">${body}</main></body></html>`].join('\n');
}
