import { escapeHtml } from '@punyts/stateui-mcp';
import { FAVICON_LINK } from './logo.js';
import { htmlOpen, schemeCss } from './pages.js';
import type { PageLook } from './pages.js';
import { SCRIPT_TEXTS, textBlock, textsOf } from './text.js';
import { HOME_HEARING } from '../home/HomeApp.js';
import { HEARING_JS, hearingJs } from './raised.js';

export interface HomePageOptions {
    /** The id of the person's "Your apps" app */
    readonly appId: string;
    /** The runtime page, on the runtime origin, which the host script is given */
    readonly runtimeUrl: string;
    /** The hash of the page bundle (`/assets/page/<hash>.js`), which runs the app in the page */
    readonly pageBundle: string;
    /** The hash of the 3D chunk, when the server has one */
    readonly chunk3d?: string;
    /** The sync namespace of the app's instance */
    readonly namespace: string;
    readonly look: PageLook;
}

/**
 * `GET /`: the person's "Your apps", a StateUI app, filling the window. The host script (`/assets/host.js`) runs it as
 * it runs any app, in the page itself on the page bundle (`data-surface="page"`, on `[data-app-frame]`); `/assets/home.js` acts on what it hears from it: `open` an app, `create` one and `signout`
 */
export function homePage(options: HomePageOptions): string {
    return [
        '<!doctype html>',
        htmlOpen(options.look),
        '<head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        `<title>${escapeHtml(textsOf(options.look.language)['home.pageTitle'])}</title>`,
        FAVICON_LINK,
        '<link rel="stylesheet" href="/assets/page.css">',
        '<link rel="stylesheet" href="/assets/home.css">',
        '</head>',
        `<body class="view home" data-app-id="${escapeHtml(options.appId)}" data-runtime-url="${escapeHtml(options.runtimeUrl)}" data-surface="page"${options.chunk3d === undefined ? '' : ` data-chunk-3d="${escapeHtml(options.chunk3d)}"`} data-view-kind="browser" data-namespace="${escapeHtml(options.namespace)}" data-mode="${options.look.mode}" data-locale="${options.look.language}" data-status="loading">`,
        '<div class="home-app" data-app-frame></div>',
        '<p class="notice" id="notice" role="alert" hidden></p>',
        textBlock(options.look.language),
        `<script src="/assets/page/${escapeHtml(options.pageBundle)}.js"></script>`,
        '<script type="module" src="/assets/home.js"></script>',
        '<script type="module" src="/assets/host.js"></script>',
        '</body>',
        '</html>',
        ''
    ].join('\n');
}

/** `/assets/home.css`, after the host's `page.css` */
export const HOME_CSS = `${schemeCss('--paper: #ffffff;', '--paper: #15171c;')}
html, body.home { height: 100%; margin: 0; overflow: hidden; background: var(--paper); }
.home-app { position: fixed; inset: 0; overflow: auto; }
.notice { position: fixed; z-index: 2; left: 50%; top: 1rem; transform: translateX(-50%); margin: 0; padding: 0.5rem 0.9rem; border-radius: 0.75rem; background: #c0392b; color: #fff; font: 0.9rem system-ui, sans-serif; box-shadow: 0 8px 24px rgba(20, 24, 40, 0.2); }
.notice[hidden] { display: none; }
.notice .reset { margin-left: 0.5rem; font: inherit; padding: 0.2rem 0.6rem; border-radius: 0.5rem; border: 1px solid #fff; background: transparent; color: inherit; cursor: pointer; }
`;

/**
 * `/assets/home.js`: what the home app's nodes with an `@id` raise, reported on the page by the host script as
 * `stateui:raised` and read by `HOME_HEARING`. `open` goes to
 * an app, `shareAccept` and `shareReject` answer an app shared with the person (`POST /shares/<id>/accept|reject`), `create` makes one (`POST /new`, answered with its id) and opens its editor, `orgs` opens the org settings, `signout` signs out, and `mode`
 * and `language` keep the person's choice (`POST /prefs`) and load the page again in it, `editEditor` opens the person's
 * editor in the editor and `resetEditor` puts it back to Magnetic's
 */
export const HOME_JS = String.raw`${SCRIPT_TEXTS}${HEARING_JS}${hearingJs('hearing', HOME_HEARING)}const notice = document.getElementById('notice');
const APP_ID = /^[A-Za-z0-9-]{1,64}$/;
let busy = false;

function say(message) {
    notice.textContent = message;
    notice.hidden = false;
    setTimeout(() => { notice.hidden = true; }, 6000);
}

async function create(name) {
    if (busy) return;
    if (typeof name !== 'string' || name.trim() === '') { say(T['home.nameFirst']); return; }
    busy = true;
    try {
        const response = await fetch('/new', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams({ name }).toString() });
        const answer = await response.json().catch(() => ({}));
        if (response.ok && typeof answer.id === 'string' && APP_ID.test(answer.id)) location.assign('/edit/' + encodeURIComponent(answer.id));
        else say(answer.message || T['home.notMade']);
    } catch { say(T['home.notMadeOffline']); }
    finally { busy = false; }
}

// The person's editor and this page are apps of theirs: open one in the editor, or put it back to Magnetic's
async function editor(path) {
    try {
        const response = await fetch(path, { method: 'POST' });
        const answer = await response.json().catch(() => ({}));
        if (!response.ok || typeof answer.id !== 'string' || !APP_ID.test(answer.id)) throw new Error('refused');
        if (path === '/editor' || path === '/home') location.assign('/edit/' + encodeURIComponent(answer.id));
        else if (path === '/home/reset') location.reload();
        else say(T['home.resetDone']);
    } catch { say(T['home.notMade']); }
}

// A changed Your apps that does not load leaves the person a way back: Reset, on the page itself
setTimeout(() => {
    if (document.body.dataset.status === 'ready') return;
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'reset';
    reset.textContent = T['home.resetHome'];
    reset.addEventListener('click', () => void editor('/home/reset'));
    notice.replaceChildren(document.createTextNode(T['home.broken'] + ' '), reset);
    notice.hidden = false;
}, 10000);

// An invite waiting here: joined, it opens the org; declined, it goes
async function answerInvite(id, join) {
    try {
        const response = await fetch('/orgs/invites/' + encodeURIComponent(id) + (join ? '/accept' : '/decline'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const answer = await response.json().catch(() => ({}));
        if (!response.ok) { say(answer.message || T['home.joinFailed']); return; }
        if (join && typeof answer.id === 'string' && APP_ID.test(answer.id)) location.assign('/settings/orgs/' + encodeURIComponent(answer.id));
        else location.reload();
    } catch { say(T['home.joinFailed']); }
}

// An app shared with the person: accepted, it joins their apps; rejected, once confirmed, it goes
async function answerShare(id, accept) {
    if (!accept && !confirm(T['home.rejectConfirm'])) return;
    try {
        const response = await fetch('/shares/' + encodeURIComponent(id) + (accept ? '/accept' : '/reject'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        if (!response.ok) throw new Error('refused');
        location.reload();
    } catch { say(T['home.answerFailed']); }
}

async function choose(change) {
    if (document.documentElement.dataset.mode === change.mode || document.documentElement.lang === change.language) return;
    try {
        const response = await fetch('/prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) });
        if (!response.ok) throw new Error('refused');
        location.reload();
    } catch { say(T['prefs.failed']); }
}

addEventListener('stateui:raised', (event) => {
    const heard = hearing.heard(event.detail);
    if (!heard) return;
    const { name, payload } = heard;
    if (name === 'open' && typeof payload === 'string' && APP_ID.test(payload)) location.assign('/apps/' + encodeURIComponent(payload));
    else if (name === 'create') void create(payload);
    else if ((name === 'mode' || name === 'language') && typeof payload === 'string') void choose({ [name]: payload });
    else if (name === 'editEditor') void editor('/editor');
    else if (name === 'resetEditor') { if (confirm(T['home.resetConfirm'])) void editor('/editor/reset'); }
    else if (name === 'editHome') void editor('/home');
    else if (name === 'resetHome') { if (confirm(T['home.resetHomeConfirm'])) void editor('/home/reset'); }
    else if (name === 'orgs') location.assign('/settings/orgs');
    else if (name === 'connections') location.assign('/settings/connections');
    else if (name === 'data') location.assign('/settings/data');
    else if (name === 'requests') location.assign('/requests');
    else if (name === 'device') location.assign('/settings/device');
    else if (name === 'billing') location.assign('/settings/billing');
    else if (name === 'admin') location.assign('/admin');
    else if (name === 'openOrg' && typeof payload === 'string' && APP_ID.test(payload)) location.assign('/settings/orgs/' + encodeURIComponent(payload));
    else if ((name === 'inviteJoin' || name === 'inviteDecline') && typeof payload === 'string' && APP_ID.test(payload)) void answerInvite(payload, name === 'inviteJoin');
    else if ((name === 'shareAccept' || name === 'shareReject') && typeof payload === 'string' && APP_ID.test(payload)) void answerShare(payload, name === 'shareAccept');
    else if (name === 'signout') void fetch('/signout', { method: 'POST' }).finally(() => location.assign('/signin'));
});
`;
