import { isDeepStrictEqual } from 'node:util';
import { escapeHtml } from '@punyts/stateui-mcp';
import type { ManagedWorkspace } from './connectionsPage.js';
import { htmlOpen } from './pages.js';
import type { PageLook } from './pages.js';
import { requestsTextsOf } from './requestsText.js';
import type { RequestsTextKey, RequestsTexts } from './requestsText.js';
import { fill } from './text.js';

/** What the page says after a decision: a text of its own with values */
export type RequestsSaid = { readonly key: RequestsTextKey; readonly values?: Readonly<Record<string, string>> };

/** One waiting request as the list shows it: no values */
export interface ListedRequest {
    readonly workspace: ManagedWorkspace;
    readonly dataset: string;
    readonly id: string;
    readonly by: string;
    readonly at: Date;
    readonly until: Date;
}

/** What `GET /requests` shows */
export interface RequestsView {
    readonly look: PageLook;
    readonly requests: readonly ListedRequest[];
    readonly notice?: RequestsSaid;
    readonly error?: RequestsSaid;
}

/** One request opened: the change asked for and the records as they are */
export interface RequestDetail {
    readonly look: PageLook;
    readonly workspace: ManagedWorkspace;
    readonly dataset: string;
    readonly id: string;
    readonly by: string;
    readonly at: Date;
    readonly until: Date;
    readonly path: string;
    /** `set`, `replace`, `merge` or `delete` */
    readonly op: string;
    readonly value?: unknown;
    /** The dataset's records now */
    readonly records: Readonly<Record<string, unknown>>;
}

/** One row of what a request changes: a field (or a record's key) as it is and as asked */
export interface ChangeRow {
    readonly name: string;
    readonly now: unknown;
    readonly asked: unknown;
}

const e = (value: unknown): string => escapeHtml(String(value));

const RECORDS = '$.data.records';

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * What a request changes, as a heading and the rows that differ: a record's fields, the keys of the records for a
 * write of them all, or one value at a deeper path
 */
export function changeOf(t: RequestsTexts, detail: Pick<RequestDetail, 'dataset' | 'path' | 'op' | 'value' | 'records'>): { heading: string; rows: ChangeRow[] } {
    const asked = detail.op === 'delete' ? undefined : detail.value;
    if (detail.path === RECORDS) {
        const next = isObject(asked) ? (detail.op === 'merge' ? { ...detail.records, ...asked } : asked) : {};
        const keys = [...new Set([...Object.keys(detail.records), ...Object.keys(next)])];
        return { heading: fill(t['requests.whole'], { dataset: detail.dataset }), rows: keys.filter((key) => !isDeepStrictEqual(detail.records[key], next[key])).map((key) => ({ name: key, now: detail.records[key], asked: next[key] })) };
    }
    const [key = '', ...rest] = detail.path.startsWith(`${RECORDS}.`) ? detail.path.slice(RECORDS.length + 1).split('.') : [];
    const record = detail.records[key];
    if (rest.length === 0 && key !== '') {
        if (detail.op === 'delete') return { heading: fill(t['requests.removeRecord'], { key }), rows: isObject(record) ? Object.entries(record).map(([name, now]) => ({ name, now, asked: undefined })) : [] };
        const before = isObject(record) ? record : {};
        const after = isObject(asked) ? (detail.op === 'merge' ? { ...before, ...asked } : asked) : {};
        const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])];
        return {
            heading: fill(t[record === undefined ? 'requests.newRecord' : 'requests.record'], { key }),
            rows: fields.filter((name) => !isDeepStrictEqual(before[name], after[name])).map((name) => ({ name, now: before[name], asked: after[name] }))
        };
    }
    let now: unknown = record;
    for (const segment of rest) now = isObject(now) ? now[segment] : undefined;
    return { heading: fill(t['requests.at'], { path: detail.path }), rows: [{ name: rest.join('.') || key, now, asked }] };
}

const when = (look: PageLook, at: Date): string => new Intl.DateTimeFormat(look.language, { dateStyle: 'medium', timeStyle: 'short' }).format(at);

const shown = (t: RequestsTexts, value: unknown): string => (value === undefined ? `<span class="muted">${e(t['requests.nothing'])}</span>` : `<code>${e(JSON.stringify(value))}</code>`);

const said = (t: RequestsTexts, what: RequestsSaid): string => fill(t[what.key], { ...what.values });

const workspaceName = (t: RequestsTexts, workspace: ManagedWorkspace): string => (workspace.own === true ? t['requests.own'] : workspace.name);

/** The address of one request's page */
export const requestHref = (workspaceId: string, dataset: string, id: string): string => `/requests/${encodeURIComponent(workspaceId)}/${encodeURIComponent(dataset)}/${encodeURIComponent(id)}`;

function page(look: PageLook, t: RequestsTexts, body: string[]): string {
    return [
        '<!doctype html>',
        htmlOpen(look),
        '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
        `<title>${e(t['requests.pageTitle'])}</title>`,
        '<link rel="stylesheet" href="/assets/magnetic.css"></head>',
        `<body><main class="settings">${body.join('\n')}</main></body></html>`
    ].join('\n');
}

/** `GET /requests`: the changes waiting for the person's decision on the datasets of the workspaces they manage */
export function requestsPage(view: RequestsView): string {
    const t = requestsTextsOf(view.look.language);
    const several = new Set(view.requests.map((request) => request.workspace.id)).size > 1;
    const list =
        view.requests.length === 0
            ? `<p class="muted">${e(t['requests.none'])}</p>`
            : [
                  `<div class="table"><table><thead><tr><th>${e(t['requests.column.dataset'])}</th><th>${e(t['requests.column.by'])}</th><th>${e(t['requests.column.at'])}</th><th>${e(t['requests.column.until'])}</th><th></th></tr></thead><tbody>`,
                  view.requests
                      .map(
                          (request) =>
                              `<tr><td><code>${e(request.dataset)}</code>${several ? ` <span class="muted">${e(workspaceName(t, request.workspace))}</span>` : ''}</td><td>${e(request.by)}</td><td>${e(when(view.look, request.at))}</td><td>${e(when(view.look, request.until))}</td><td><a href="${e(requestHref(request.workspace.id, request.dataset, request.id))}">${e(t['requests.open'])}</a></td></tr>`
                      )
                      .join(''),
                  '</tbody></table></div>'
              ].join('');
    return page(view.look, t, [
        `<header><h1>${e(t['requests.title'])}</h1><nav><a class="button" href="/">${e(t['requests.back'])}</a></nav></header>`,
        `<p class="muted">${e(t['requests.intro'])}</p>`,
        view.notice === undefined ? '' : `<p class="notice" role="status">${e(said(t, view.notice))}</p>`,
        view.error === undefined ? '' : `<p class="error" role="alert">${e(said(t, view.error))}</p>`,
        list
    ]);
}

/** `GET /requests/<workspace>/<dataset>/<id>`: one request, the record as it is and as asked, with Approve and Reject */
export function requestPage(detail: RequestDetail): string {
    const t = requestsTextsOf(detail.look.language);
    const change = changeOf(t, detail);
    const action = requestHref(detail.workspace.id, detail.dataset, detail.id);
    const rows = change.rows.map((row) => `<tr><td><code>${e(row.name)}</code></td><td>${shown(t, row.now)}</td><td>${shown(t, row.asked)}</td></tr>`).join('');
    return page(detail.look, t, [
        `<header><h1>${e(fill(t['requests.detailTitle'], { dataset: detail.dataset }))}</h1><nav><a class="button" href="/requests">${e(t['requests.title'])}</a></nav></header>`,
        `<p class="muted">${e(fill(t['requests.detailBy'], { name: detail.by, at: when(detail.look, detail.at), until: when(detail.look, detail.until) }))}</p>`,
        `<h2>${e(change.heading)}</h2>`,
        `<div class="table"><table><thead><tr><th>${e(t['requests.field'])}</th><th>${e(t['requests.now'])}</th><th>${e(t['requests.asked'])}</th></tr></thead><tbody>${rows}</tbody></table></div>`,
        `<form method="post" action="${e(action)}">`,
        `<label>${e(t['requests.note'])} <textarea name="note" maxlength="500" rows="2"></textarea></label>`,
        `<p><button class="primary" name="do" value="approve">${e(t['requests.approve'])}</button> <button name="do" value="reject">${e(t['requests.reject'])}</button></p>`,
        '</form>'
    ]);
}
