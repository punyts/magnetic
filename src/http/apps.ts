import { escapeHtml } from '@punyts/stateui-mcp';
import { FAVICON_LINK } from './logo.js';
import { htmlOpen, schemeCss } from './pages.js';
import type { PageLook } from './pages.js';
import { SCRIPT_TEXTS, textBlock, textsOf } from './text.js';
import { APPS_BOARD, ZOOM_CSS } from './zoom.js';
import { APPS_HEARING } from '../apps/AppsPage.js';
import { HEARING_JS, hearingJs } from './raised.js';

/** One tile on a board: an app on a workspace's board, or a workspace on the Orgs level */
export interface AppTile {
    readonly id: string;
    readonly title: string;
    /** When it changed, who shared it, or the person's role in an org */
    readonly note: string;
    /** Where zooming in on it goes: an app's editor, or the running app for someone who may only use or view it; a workspace's board */
    readonly href: string;
}

/** One level in the bar over a board: a link out, or (no `href`) the level shown */
export interface BoardLevel {
    readonly label: string;
    readonly href?: string;
}

export interface AppsPageOptions {
    /** What the page is called: the workspace's name, or "Orgs" */
    readonly name: string;
    /** The bar over the board, outermost first, ending with the level shown */
    readonly levels: readonly BoardLevel[];
    /** Where Ctrl+Shift+- goes; none on the outermost level */
    readonly out?: string;
    /** The query parameter that names the tile to select: `app` on a workspace's board, `org` on the Orgs level */
    readonly pick: 'app' | 'org';
    /** The tile the query selects, when it is one of the tiles: zooming out arrives on it, so the transition ends there */
    readonly selected?: string;
    /** The panel's label for a screen reader */
    readonly label: string;
    readonly tiles: readonly AppTile[];
    /** The runtime page, on the runtime origin, which the host script is given */
    readonly runtimeUrl: string;
    /** The hash of the page bundle (`/assets/page/<hash>.js`), which runs the board in the page */
    readonly pageBundle: string;
    readonly look: PageLook;
}

/**
 * A level of boards (docs/design/magnetic-zoom.md): `GET /orgs`, the person's own space and their orgs (stage 4), and
 * `GET /orgs/<org>` and `GET /orgs/me`, the apps of a workspace (stage 3), under a level bar. The page has no app of its own: `/assets/apps.js` mounts Magnetic's page `magnetic-apps`
 * (`/assets/apps.json`) and writes the tiles, which the server gives in the page, into its data
 */
export function appsPage(options: AppsPageOptions): string {
    const t = textsOf(options.look.language);
    return [
        '<!doctype html>',
        htmlOpen(options.look),
        '<head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        `<title>${escapeHtml(options.name)} · Magnetic</title>`,
        FAVICON_LINK,
        '<link rel="stylesheet" href="/assets/page.css">',
        '<link rel="stylesheet" href="/assets/apps.css">',
        '</head>',
        `<body class="view apps-board" data-pick="${options.pick}" data-label="${escapeHtml(options.label)}"${options.out === undefined ? '' : ` data-out="${escapeHtml(options.out)}"`} data-runtime-url="${escapeHtml(options.runtimeUrl)}" data-surface="page" data-view-kind="browser" data-mode="${options.look.mode}" data-locale="${options.look.language}">`,
        `<nav class="levels" id="levels" aria-label="${escapeHtml(t['shell.levels'])}">`
            + options.levels.map((level) => level.href === undefined
                ? `<span class="level here" aria-current="page">${escapeHtml(level.label)}</span>`
                : `<a class="level" href="${escapeHtml(level.href)}">${escapeHtml(level.label)}</a>`).join('<span class="level-gap" aria-hidden="true">›</span>')
            + '</nav>',
        '<div class="apps" id="apps"></div>',
        // What a zoom grows or shrinks (zoom.ts): the selected tile, in the middle, or else the whole board
        `<div class="zoom-mark${options.selected !== undefined && options.tiles.some((tile) => tile.id === options.selected) ? ' tile' : ''}" id="zoom-mark" aria-hidden="true"></div>`,
        `<script type="application/json" id="apps-tiles">${JSON.stringify(options.tiles).replace(/</g, '\\u003c')}</script>`,
        textBlock(options.look.language),
        `<script src="/assets/page/${escapeHtml(options.pageBundle)}.js"></script>`,
        '<script type="module" src="/assets/host.js"></script>',
        '<script type="module" src="/assets/apps.js"></script>',
        '</body>',
        '</html>',
        ''
    ].join('\n');
}

/** `/assets/apps.css`, after the host's `page.css`: the level bar and the board under it */
export const APPS_CSS = `${schemeCss(
    '--ink: #1b1d22; --muted: #5d6470; --paper: #ffffff; --soft: #f3f4f7; --accent: #3047d8; --dot: #c9cdd6;',
    '--ink: #e8eaee; --muted: #a2a8b3; --paper: #15171c; --soft: #1e2128; --accent: #8c9cff; --dot: #353a45;'
)}
html, body.apps-board { height: 100%; margin: 0; overflow: hidden; }
body.view.apps-board { display: block; font-family: system-ui, sans-serif; color: var(--ink); background: var(--paper); }
.apps { position: fixed; inset: 2.25rem 0 0; overflow: hidden; }
.levels { position: fixed; top: 0; left: 0; right: 0; z-index: 2; box-sizing: border-box; height: 2.25rem; display: flex; align-items: center; gap: 0.4rem; padding: 0 0.75rem; overflow: hidden; white-space: nowrap; border-bottom: 1px solid var(--dot); background: var(--soft); color: var(--muted); font: 0.85rem system-ui, sans-serif; }
.levels .level { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: inherit; text-decoration: none; border-radius: 0.3rem; padding: 0.15rem 0.3rem; }
.levels a.level:hover, .levels a.level:focus-visible { color: var(--accent); background: var(--paper); outline: none; }
.levels .here { color: var(--ink); font-weight: 600; }
${ZOOM_CSS}`;

/**
 * \`/assets/apps.js\`: a board of tiles, a workspace's apps or the Orgs level. It mounts the board's page, writes the tiles
 * in rows of five, and acts on what it hears from the board (`APPS_HEARING`) and on the zoom chords:
 * - a press on a card, or Ctrl+Shift+= (Cmd on a Mac) on the selected card or else the one most in view, zooms in: it
 *   goes where the card's \`href\` says (an app's editor or the running app, or a workspace's board);
 * - Ctrl+Shift+- zooms out to the page's \`data-out\`, the level outside; the Orgs level has none;
 * - \`?app=<id>\` (\`?org=<id>\` on the Orgs level, \`data-pick\`) selects that card and brings it into view, where zooming
 *   out of the level inside arrives; a press on the empty canvas lets it go. The view fits every card when none is selected.
 */
export const APPS_JS = String.raw`${SCRIPT_TEXTS}const host = window.stateuiHost;
const holder = document.getElementById('apps');
const TILES = JSON.parse(document.getElementById('apps-tiles').textContent || '[]');
const BOARD = ${JSON.stringify(APPS_BOARD)};
const A = '$.data.apps';
/** Room left around the cards when the view fits them, in the window's pixels */
const MARGIN = 48;
const OUT = document.body.dataset.out || null;
let selected = new URLSearchParams(location.search).get(document.body.dataset.pick || 'app');
if (!TILES.some((tile) => tile.id === selected)) selected = null;
/** The board's view, as the canvas last reported it */
const view = { x: 0, y: 0, zoom: 1 };
let panel = null;

/** Where a card is on the board, in the board's pixels, by its place in the rows */
function boxOf(index) {
    return { x: (index % BOARD.columns) * (BOARD.width + BOARD.gap), y: Math.floor(index / BOARD.columns) * (BOARD.height + BOARD.gap), width: BOARD.width, height: BOARD.height };
}

function records() {
    return TILES.map((tile, index) => ({ id: tile.id, title: tile.title, note: tile.note, selected: tile.id === selected, column: 'c' + (index % BOARD.columns), row: Math.floor(index / BOARD.columns) }));
}

function theme() {
    const rows = Math.ceil(Math.max(1, TILES.length) / BOARD.columns);
    const card = BOARD.height + BOARD.gap;
    return { board: { column: BOARD.width + 'px', card: card + 'px', gap: BOARD.gap + 'px', height: rows * card + 'px' }, space: { gap: { md: BOARD.gap + 'px' } } };
}

/** The view that shows the selected card in the middle at full size, or else every card */
function startView() {
    const width = holder.clientWidth || innerWidth;
    const height = holder.clientHeight || innerHeight;
    const index = TILES.findIndex((tile) => tile.id === selected);
    if (index >= 0) {
        const box = boxOf(index);
        return { x: Math.round(width / 2 - (box.x + box.width / 2)), y: Math.round(height / 2 - (box.y + box.height / 2)), zoom: 1 };
    }
    const columns = Math.min(BOARD.columns, Math.max(1, TILES.length));
    const rows = Math.ceil(Math.max(1, TILES.length) / BOARD.columns);
    const across = columns * BOARD.width + (columns - 1) * BOARD.gap;
    const down = rows * BOARD.height + (rows - 1) * BOARD.gap;
    const zoom = Math.min(1, (width - 2 * MARGIN) / across, (height - 2 * MARGIN) / down);
    return { x: Math.round((width - across * zoom) / 2), y: Math.round(Math.max(MARGIN, (height - down * zoom) / 2)), zoom: Number(zoom.toFixed(3)) };
}

/** The card with the most of it in view, or null when none is */
function mostInView() {
    const width = holder.clientWidth || innerWidth;
    const height = holder.clientHeight || innerHeight;
    let most = null;
    let largest = 0;
    TILES.forEach((tile, index) => {
        const box = boxOf(index);
        const left = view.x + box.x * view.zoom;
        const top = view.y + box.y * view.zoom;
        const across = Math.min(left + box.width * view.zoom, width) - Math.max(left, 0);
        const down = Math.min(top + box.height * view.zoom, height) - Math.max(top, 0);
        const area = across > 0 && down > 0 ? across * down : 0;
        if (area > largest) { largest = area; most = tile.id; }
    });
    return most;
}

const mark = document.getElementById('zoom-mark');

/** Zooming in on a card: where it goes, growing out of the card (the mark moves over it first) */
function zoomInto(id) {
    const index = TILES.findIndex((candidate) => candidate.id === id);
    if (index < 0) return;
    const box = boxOf(index);
    const at = holder.getBoundingClientRect();
    mark.classList.remove('tile');
    Object.assign(mark.style, { left: at.left + view.x + box.x * view.zoom + 'px', top: at.top + view.y + box.y * view.zoom + 'px', width: box.width * view.zoom + 'px', height: box.height * view.zoom + 'px', right: 'auto', bottom: 'auto' });
    location.assign(TILES[index].href);
}

/** Zooming out: the level outside, the whole board shrinking into its tile there */
function zoomOut() {
    if (!OUT) return;
    mark.classList.remove('tile');
    mark.removeAttribute('style');
    location.assign(OUT);
}

function draw() {
    if (!panel) return;
    panel.write([
        { path: A + '.tiles', value: records() },
        { path: A + '.lanes', value: Object.fromEntries(Array.from({ length: BOARD.columns }, (_, index) => ['c' + index, { _title: '' }])) },
        { path: A + '.filled', value: TILES.length > 0 }
    ]);
}

/** The state path of the node a key names in a document */
function keyPath(doc, key) {
    const visit = (node, at) => {
        if (!node || typeof node !== 'object') return null;
        for (const [name, child] of Object.entries(node.children || {})) {
            if (name === key) return at + '.children.' + name;
            const found = visit(child, at + '.children.' + name);
            if (found) return found;
        }
        return null;
    };
    for (const [name, screen] of Object.entries(doc.screens || {})) {
        const found = visit(screen.root, '$.screens.' + name);
        if (found) return found;
    }
    return null;
}

${HEARING_JS}${hearingJs('board', APPS_HEARING)}
holder.addEventListener('stateui:raised', (event) => {
    const heard = board.heard(event.detail);
    if (!heard) return;
    const { name, payload } = heard;
    if (name === 'press') { const id = typeof payload === 'string' ? payload : payload && payload.id; if (typeof id === 'string') zoomInto(id); }
    else if (name === 'canvas') { if (selected !== null) { selected = null; draw(); } }
    else if (name === 'view' && payload && [payload.x, payload.y, payload.zoom].every(Number.isFinite)) Object.assign(view, { x: payload.x, y: payload.y, zoom: payload.zoom });
});

/** 'in' for Ctrl+Shift+= (Ctrl+Shift++ on the keypad), 'out' for Ctrl+Shift+-, else null; Cmd on a Mac */
function zoomChord(event) {
    if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return null;
    if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') return 'in';
    if (event.key === '_' || event.key === '-' || event.code === 'NumpadSubtract') return 'out';
    return null;
}
document.addEventListener('keydown', (event) => {
    const level = zoomChord(event);
    if (!level) return;
    event.preventDefault();
    if (level === 'out') { zoomOut(); return; }
    const id = selected ?? mostInView();
    if (id) zoomInto(id);
});

(async () => {
    const response = await fetch('/assets/apps.json', { headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const served = await response.json();
    const canvas = keyPath(served.document, 'canvas');
    panel = host.mount(holder, { document: served.document, icons: served.icons, inPage: true }, document.body.dataset.label || T['apps.board']);
    holder.addEventListener('stateui:ready', () => {
        Object.assign(view, startView());
        panel.write([{ path: A + '.view', value: { ...view } }, ...(canvas ? [{ path: canvas + '.content.theme', value: theme() }] : [])]);
        draw();
    }, { once: true });
})();
`;
