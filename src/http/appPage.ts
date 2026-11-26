import { escapeHtml } from '@punyts/stateui-mcp';
import type { PageAppDocument } from '../pages/PageApps.js';
import { FAVICON_LINK } from './logo.js';
import { HEARING_JS } from './raised.js';
import type { Hearing } from './raised.js';
import { htmlOpen, schemeCss } from './pages.js';
import type { PageLook } from './pages.js';

/**
 * What a page app's node does when the page hears it, set by the server: go to an address, or post a form to one and go
 * where it answers (`{id}` in either is the payload). Nothing else can happen, whatever the app raises
 */
export type PageAction = { readonly go: string } | { readonly post: string; readonly form?: Readonly<Record<string, string>> };

export interface AppPageOptions {
    readonly look: PageLook;
    readonly title: string;
    /** The runtime page, on the runtime origin, which the host script is given */
    readonly runtimeUrl: string;
    /** The hash of the page bundle (`/assets/page/<hash>.js`), which runs the app in the page */
    readonly pageBundle: string;
    readonly app: PageAppDocument;
    /** What the page writes into the app's data once it is ready */
    readonly data: Readonly<Record<string, unknown>>;
    /** What the page hears of the app's nodes with an `@id`, by the names of `actions` */
    readonly hearing: Hearing;
    /** What each name the page hears does */
    readonly actions: Readonly<Record<string, PageAction>>;
    /**
     * True when the app is an admin's published version: a page whose app is not ready in time loads again at
     * `?page=default`, Magnetic's own
     */
    readonly fallback?: boolean;
}

/** JSON in a page, never run: `<` is escaped so nothing in it can close the block */
function block(id: string, value: unknown): string {
    return `<script type="application/json" id="${id}">${JSON.stringify(value).replace(/</g, '\\u003c')}</script>`;
}

/**
 * One of Magnetic's own pages as a StateUI app (sign in, a share link): the app fills the window, run in the page itself
 * on the page bundle (`stateuiHost.mount` with `inPage`, no live app, nothing synced), which the page drives alone. The page writes its data and does what the server
 * set for each name it hears (`/assets/app-page.js`)
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
        `<body class="view app-page" data-runtime-url="${escapeHtml(options.runtimeUrl)}" data-surface="page" data-mode="${options.look.mode}" data-locale="${options.look.language}"${options.fallback === true ? ' data-fallback="default"' : ''}>`,
        '<div class="page-app" id="page-app"></div>',
        block('page-app-document', options.app),
        block('page-app-data', options.data),
        block('page-app-hearing', options.hearing),
        block('page-app-actions', options.actions),
        `<script src="/assets/page/${escapeHtml(options.pageBundle)}.js"></script>`,
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
.page-app { position: fixed; inset: 0; }
.page-app > .stateui-panel { position: absolute; inset: 0; overflow: auto; }
`;

/** `/assets/app-page.js`, after the host script */
export const APP_PAGE_JS = String.raw`${HEARING_JS}const read = (id) => JSON.parse(document.getElementById(id).textContent);
const app = read('page-app-document');
const hearing = hearingOf(read('page-app-hearing'));
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

holder.addEventListener('stateui:raised', (event) => {
    const heard = hearing.heard(event.detail);
    const action = heard && Object.hasOwn(actions, heard.name) ? actions[heard.name] : undefined;
    if (action) void act(action, heard.payload);
});

const panel = window.stateuiHost.mount(holder, { ...app, inPage: true }, document.title);
let ready = false;
// A published page that does not load gives way to Magnetic's own, so a bad publish locks nobody out
if (document.body.dataset.fallback === 'default') {
    setTimeout(() => {
        if (ready) return;
        const url = new URL(location.href);
        url.searchParams.set('page', 'default');
        location.replace(url.href);
    }, 10000);
}
holder.addEventListener('stateui:ready', () => {
    ready = true;
    for (const [path, value] of Object.entries(data)) hearing.keep(path, value);
    panel.write(Object.entries(data).map(([path, value]) => ({ path, value })));
});
`;
