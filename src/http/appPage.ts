import { escapeHtml } from '@punyts/stateui-mcp';
import type { PageAppDocument } from '../pages/PageApps.js';
import { FAVICON_LINK } from './logo.js';
import { htmlOpen, schemeCss } from './pages.js';
import type { PageLook } from './pages.js';

/**
 * What a page app's emit does, set by the server: go to an address, or post a form to one and go where it answers
 * (`{id}` in either is the emit's payload). Nothing else can happen, whatever the app emits
 */
export type PageAction = { readonly go: string } | { readonly post: string; readonly form?: Readonly<Record<string, string>> };

export interface AppPageOptions {
    readonly look: PageLook;
    readonly title: string;
    /** The runtime page the app frame loads, on the runtime origin */
    readonly runtimeUrl: string;
    readonly app: PageAppDocument;
    /** What the page writes into the app's data once it is ready */
    readonly data: Readonly<Record<string, unknown>>;
    /** What each emit of the app does */
    readonly actions: Readonly<Record<string, PageAction>>;
}

/** JSON in a page, never run: `<` is escaped so nothing in it can close the block */
function block(id: string, value: unknown): string {
    return `<script type="application/json" id="${id}">${JSON.stringify(value).replace(/</g, '\\u003c')}</script>`;
}

/**
 * One of Magnetic's own pages as a StateUI app (sign in, a share link): the app fills the window in a frame the page
 * drives alone (`stateuiHost.mount`, no live app, nothing synced). The page writes its data and does what the server
 * set for each of its emits (`/assets/app-page.js`)
 */
export function appPage(options: AppPageOptions): string {
    return [
        '<!doctype html>',
        htmlOpen(options.look),
        '<head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        `<title>${escapeHtml(options.title)}</title>`,
        FAVICON_LINK,
        '<link rel="stylesheet" href="/assets/page.css">',
        '<link rel="stylesheet" href="/assets/app-page.css">',
        '</head>',
        `<body class="view app-page" data-runtime-url="${escapeHtml(options.runtimeUrl)}" data-mode="${options.look.mode}" data-locale="${options.look.language}">`,
        '<div class="page-app" id="page-app"></div>',
        block('page-app-document', options.app),
        block('page-app-data', options.data),
        block('page-app-actions', options.actions),
        '<script type="module" src="/assets/host.js"></script>',
        '<script type="module" src="/assets/app-page.js"></script>',
        '</body>',
        '</html>',
        ''
    ].join('\n');
}

/** `/assets/app-page.css` */
export const APP_PAGE_CSS = `${schemeCss('--paper: #ffffff;', '--paper: #15171c;')}
html, body.app-page { height: 100%; margin: 0; overflow: hidden; background: var(--paper); }
.page-app, .page-app iframe { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; display: block; }
`;

/** `/assets/app-page.js`, after the host script */
export const APP_PAGE_JS = String.raw`const read = (id) => JSON.parse(document.getElementById(id).textContent);
const app = read('page-app-document');
const data = read('page-app-data');
const actions = read('page-app-actions');
const holder = document.getElementById('page-app');

function fillIn(text, payload) { return String(text).split('{id}').join(encodeURIComponent(String(payload ?? ''))); }

async function act(action, payload) {
    if (action.go) { location.assign(fillIn(action.go, payload)); return; }
    if (!action.post) return;
    const form = new URLSearchParams();
    for (const [name, value] of Object.entries(action.form || {})) form.set(name, String(value).split('{id}').join(String(payload ?? '')));
    try {
        const response = await fetch(fillIn(action.post, payload), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
        location.assign(response.redirected ? response.url : '/');
    } catch { location.reload(); }
}

holder.addEventListener('stateui:emit', (event) => {
    const { name, payload } = event.detail || {};
    const action = typeof name === 'string' && Object.hasOwn(actions, name) ? actions[name] : undefined;
    if (action) void act(action, payload);
});

const panel = window.stateuiHost.mount(holder, app, document.title);
holder.addEventListener('stateui:ready', () => {
    panel.write(Object.entries(data).map(([path, value]) => ({ path, value })));
});
`;
