import { escapeHtml } from '@punyts/stateui-mcp';

export interface HomePageOptions {
    /** The id of the person's "Your apps" app */
    readonly appId: string;
    /** The runtime page the app frame loads, on the runtime origin */
    readonly runtimeUrl: string;
    /** The hash of the 3D chunk, when the server has one */
    readonly chunk3d?: string;
    /** The sync namespace of the app's instance */
    readonly namespace: string;
}

/**
 * `GET /`: the person's "Your apps", a StateUI app, filling the window. The host script (`/assets/host.js`) runs it as
 * it runs any app; `/assets/home.js` acts on what it emits: `open` an app, `create` one and `signout`
 */
export function homePage(options: HomePageOptions): string {
    return [
        '<!doctype html>',
        '<html lang="en">',
        '<head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<title>Your apps · Magnetic</title>',
        '<link rel="stylesheet" href="/assets/page.css">',
        '<link rel="stylesheet" href="/assets/home.css">',
        '</head>',
        `<body class="view home" data-app-id="${escapeHtml(options.appId)}" data-runtime-url="${escapeHtml(options.runtimeUrl)}"${options.chunk3d === undefined ? '' : ` data-chunk-3d="${escapeHtml(options.chunk3d)}"`} data-view-kind="browser" data-namespace="${escapeHtml(options.namespace)}" data-status="loading">`,
        '<p class="notice" id="notice" role="alert" hidden></p>',
        '<script type="module" src="/assets/home.js"></script>',
        '<script type="module" src="/assets/host.js"></script>',
        '</body>',
        '</html>',
        ''
    ].join('\n');
}

/** `/assets/home.css`, after the host's `page.css` */
export const HOME_CSS = `html, body.home { height: 100%; margin: 0; overflow: hidden; }
.notice { position: fixed; z-index: 2; left: 50%; top: 1rem; transform: translateX(-50%); margin: 0; padding: 0.5rem 0.9rem; border-radius: 0.75rem; background: #c0392b; color: #fff; font: 0.9rem system-ui, sans-serif; box-shadow: 0 8px 24px rgba(20, 24, 40, 0.2); }
.notice[hidden] { display: none; }
`;

/**
 * `/assets/home.js`: what the home app emits, raised on the page by the host script as `stateui:emit`. `open` goes to
 * an app, `create` makes one (`POST /new`, answered with its id) and opens its editor, `signout` signs out
 */
export const HOME_JS = String.raw`const notice = document.getElementById('notice');
const APP_ID = /^[A-Za-z0-9-]{1,64}$/;
let busy = false;

function say(message) {
    notice.textContent = message;
    notice.hidden = false;
    setTimeout(() => { notice.hidden = true; }, 6000);
}

async function create(name) {
    if (busy) return;
    if (typeof name !== 'string' || name.trim() === '') { say('Give the app a name first.'); return; }
    busy = true;
    try {
        const response = await fetch('/new', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams({ name }).toString() });
        const answer = await response.json().catch(() => ({}));
        if (response.ok && typeof answer.id === 'string' && APP_ID.test(answer.id)) location.assign('/edit/' + encodeURIComponent(answer.id));
        else say(answer.message || 'The app could not be made.');
    } catch { say('The app could not be made. Check the connection.'); }
    finally { busy = false; }
}

addEventListener('stateui:emit', (event) => {
    const { name, payload } = event.detail || {};
    if (name === 'open' && typeof payload === 'string' && APP_ID.test(payload)) location.assign('/apps/' + encodeURIComponent(payload));
    else if (name === 'create') void create(payload);
    else if (name === 'signout') void fetch('/signout', { method: 'POST' }).finally(() => location.assign('/signin'));
});
`;
