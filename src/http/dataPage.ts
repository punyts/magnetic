import { escapeHtml } from '@punyts/stateui-mcp';
import { dataTextsOf } from './dataText.js';
import type { DataSaid, DataTexts } from './dataText.js';
import type { ManagedWorkspace } from './connectionsPage.js';
import { htmlOpen } from './pages.js';
import type { PageLook } from './pages.js';
import { fill } from './text.js';

/** Who a dataset is shared with, or who shared one: a person (name and email) or an org */
export interface Principal {
    readonly id: string;
    readonly name: string;
    readonly email?: string;
    readonly org?: boolean;
}

/** One dataset of the workspace, with the shares that hold now */
export interface OwnDataset {
    readonly name: string;
    readonly model: string;
    readonly count: number;
    readonly shares: ReadonlyArray<{ readonly id: string; readonly with: Principal }>;
}

/** One dataset another owner shared with the workspace */
export interface SharedDataset {
    readonly dataset: string;
    readonly owner: Principal;
}

/** What `GET /settings/data` shows */
export interface DataView {
    readonly look: PageLook;
    readonly workspaces: readonly ManagedWorkspace[];
    readonly workspace: ManagedWorkspace;
    readonly datasets: readonly OwnDataset[];
    readonly sharedWithUs: readonly SharedDataset[];
    /** False: this server has no signing key, so nothing can be shared */
    readonly canShare: boolean;
    readonly notice?: DataSaid;
    readonly error?: DataSaid;
}

const e = (value: unknown): string => escapeHtml(String(value));

const said = (t: DataTexts, what: DataSaid): string => (typeof what === 'string' ? what : fill(t[what.key], { ...what.values }));

const nameOf = (t: DataTexts, workspace: ManagedWorkspace): string => (workspace.own === true ? t['data.own'] : workspace.name);

/** A principal as the page names it */
export const principalName = (t: DataTexts, principal: Principal): string =>
    principal.org === true ? fill(t['data.org'], { name: principal.name }) : principal.email === undefined ? principal.name : fill(t['data.person'], { name: principal.name, email: principal.email });

function form(workspaceId: string, action: string, fields: Record<string, string>, inner: string): string {
    const hidden = Object.entries({ w: workspaceId, do: action, ...fields })
        .map(([name, value]) => `<input type="hidden" name="${e(name)}" value="${e(value)}">`)
        .join('');
    return `<form method="post" action="/settings/data" class="inline">${hidden}${inner}</form>`;
}

function datasetSection(t: DataTexts, view: DataView, dataset: OwnDataset): string {
    const w = view.workspace.id;
    const shares =
        dataset.shares.length === 0
            ? `<p class="muted">${e(t['data.notShared'])}</p>`
            : `<ul>${dataset.shares
                  .map((share) => {
                      const name = principalName(t, share.with);
                      return `<li>${e(name)} ${form(w, 'stop', { id: share.id }, `<button class="link" aria-label="${e(fill(t['data.stopOf'], { dataset: dataset.name, name }))}">${e(t['data.stop'])}</button>`)}</li>`;
                  })
                  .join('')}</ul>`;
    return [
        `<section class="connection" aria-labelledby="d-${e(dataset.name)}">`,
        `<h3 id="d-${e(dataset.name)}">${e(dataset.name)}</h3>`,
        `<p class="muted">${e(fill(t['data.summary'], { count: String(dataset.count), model: dataset.model }))}</p>`,
        `<h4>${e(t['data.sharedWith'])}</h4>`,
        shares,
        view.canShare
            ? form(w, 'share', { dataset: dataset.name }, `<label>${e(t['data.shareWith'])} <input name="to" required maxlength="200" autocomplete="off"></label> <button class="primary">${e(t['data.share'])}</button>`)
            : '',
        '</section>'
    ].join('\n');
}

/** `GET /settings/data`: a workspace's datasets and whom they are shared with, and the datasets shared with it */
export function dataPage(view: DataView): string {
    const t = dataTextsOf(view.look.language);
    const w = view.workspace.id;
    const here = nameOf(t, view.workspace);
    const tabs =
        view.workspaces.length < 2
            ? ''
            : `<nav class="tabs">${view.workspaces.map((workspace) => (workspace.id === w ? `<strong>${e(nameOf(t, workspace))}</strong>` : `<a href="/settings/data?w=${e(workspace.id)}">${e(nameOf(t, workspace))}</a>`)).join(' · ')}</nav>`;
    const theirs =
        view.sharedWithUs.length === 0
            ? `<p class="muted">${e(fill(t['data.theirsNone'], { workspace: here }))}</p>`
            : [
                  `<p class="muted">${e(t['data.theirsIntro'])}</p>`,
                  `<div class="table"><table><thead><tr><th>${e(t['data.column.dataset'])}</th><th>${e(t['data.column.owner'])}</th><th>${e(t['data.column.read'])}</th></tr></thead><tbody>`,
                  view.sharedWithUs
                      .map((shared) => `<tr><td><code>${e(shared.dataset)}</code></td><td>${e(principalName(t, shared.owner))}</td><td><code>${e(JSON.stringify({ owner: shared.owner.id, dataset: shared.dataset }))}</code></td></tr>`)
                      .join(''),
                  '</tbody></table></div>'
              ].join('');
    const body = [
        `<header><h1>${e(t['data.title'])}</h1><nav><a class="button" href="/">${e(t['data.back'])}</a></nav></header>`,
        `<p class="muted">${e(t['data.intro'])}</p>`,
        tabs,
        view.canShare ? '' : `<p class="notice" role="note">${e(t['data.unavailable'])}</p>`,
        view.notice === undefined ? '' : `<p class="notice" role="status">${e(said(t, view.notice))}</p>`,
        view.error === undefined ? '' : `<p class="error" role="alert">${e(said(t, view.error))}</p>`,
        `<h2>${e(t['data.ours'])}</h2>`,
        view.datasets.length === 0 ? `<p class="muted">${e(fill(t['data.none'], { workspace: here }))}</p>` : view.datasets.map((dataset) => datasetSection(t, view, dataset)).join('\n'),
        `<h2>${e(t['data.theirs'])}</h2>`,
        theirs
    ].join('\n');
    return [
        '<!doctype html>',
        htmlOpen(view.look),
        '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
        `<title>${e(t['data.pageTitle'])}</title>`,
        '<link rel="stylesheet" href="/assets/magnetic.css"></head>',
        `<body><main class="settings">${body}</main></body></html>`
    ].join('\n');
}
