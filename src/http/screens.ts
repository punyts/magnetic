import { SCREEN_COLUMNS } from '../editor/EditorApp.js';
import { SCRIPT_TEXTS } from './text.js';

/**
 * `/assets/screens.js`: the app's screens in the editor, after `/assets/shell.js` and `/assets/inspect.js`.
 *
 * - **The Screens panel** (the editor app's `screens`, beside the rail in the library's place) lists the screens from
 *   `GET /edit/<id>/screens`, marks the one worked on, and adds, renames, copies, deletes one and chooses the one the
 *   app opens on with `POST /edit/<id>/screens`, through the same tools as the agent's.
 * - **The canvas** shows every screen as a frame, in the order of the app's screens, in rows of five (Screens in a row
 *   on the panel changes it, kept in this browser), 160px apart. The
 *   live frame (the app itself, synced, inspected and edited) sits in the slot of the screen it shows. Every other
 *   screen is a preview: a panel of the host (`stateuiHost.mount`) loaded with the app's document opened on that
 *   screen, given the live frame's data and kept in step with it from `stateui:change`. A preview runs nothing of its
 *   own that is kept, and a cover over it takes the pointer: pressing it makes its screen the one worked on, so the
 *   live frame navigates there and the board moves so that it stays where it was on the screen.
 * - **Weight:** only previews in view are mounted, at most `MAX_LIVE` of them; one scrolled out of view is disposed and
 *   shows its name until it comes back.
 * - The live frame following a route the app moved to (a navigate in the app) moves to that screen's slot too.
 * - A new document (the body's `data-revision`) reloads the list and mounts the previews again with it.
 */
export const SCREENS_JS = String.raw`${SCRIPT_TEXTS}const shell = window.magneticShell;
const host = window.stateuiHost;
const editor = shell ? shell.editor : null;
const appId = document.body.dataset.appId;
const base = '/edit/' + encodeURIComponent(appId);
const world = document.getElementById('world');
const artboard = document.getElementById('artboard');
const GAP = 160;
const MAX_LIVE = 6;
const COLUMNS_KEY = 'magnetic.screenColumns';
const COLUMN_CHOICES = ${JSON.stringify(SCREEN_COLUMNS)};

/** How many screens a row holds: what this browser chose, five at first */
function storedColumns() {
    try {
        const kept = Number(localStorage.getItem(COLUMNS_KEY));
        return COLUMN_CHOICES.includes(kept) ? kept : 5;
    } catch { return 5; }
}
let columns = storedColumns();
const NAME = /^[a-z][a-z0-9-]*$/;

let screens = [];
let start = null;
let current = null;
let typedNew = '';
let typedRename = '';
/** The screen typedRename was typed for: a list reloaded under it (a new revision) keeps what was typed */
let renameFor = null;
let revision = document.body.dataset.revision || '';
/** By screen name: the preview's element, its frame holder, and its panel while mounted */
const previews = new Map();

function says(message) { editor.set({ screensStatus: message || '', noScreensStatus: !message }); }

function routeScreen() {
    const snapshot = host && host.snapshot ? host.snapshot() : undefined;
    const route = snapshot && snapshot.route;
    return route && typeof route.screen === 'string' ? route.screen : null;
}

function titleOf(name) {
    const screen = screens.find((candidate) => candidate.name === name);
    return screen ? screen.title : name;
}

async function load() {
    try {
        const response = await fetch(base + '/screens');
        if (response.ok) apply(await response.json());
    } catch { /* offline: the panel keeps what it had */ }
}

function apply(answer) {
    screens = Array.isArray(answer.screens) ? answer.screens : [];
    start = typeof answer.start === 'string' ? answer.start : null;
    if (!current || !screens.some((screen) => screen.name === current)) current = routeScreen() || start || (screens[0] ? screens[0].name : null);
    show();
    layout();
}

/** The panel: the list, the screen worked on and what can be done to it */
function show() {
    editor.list('screens', screens.map((screen) => ({
        id: screen.name,
        name: screen.name,
        title: screen.title,
        note: screen.name === start ? screen.name + ' · ' + T['screens.isHome'] : screen.name,
        current: screen.name === current
    })));
    if (current !== renameFor) { renameFor = current; typedRename = current || ''; }
    editor.set({ screenName: current || '', screenRename: current || '', isHome: current === start, notHome: current !== start, screenColumns: 'n' + columns });
}

function slotOf(name) { return Math.max(0, screens.findIndex((screen) => screen.name === name)); }

/** Where a slot is on the board, in the frame's pixels: across its row, and down the rows */
function placeOf(index, width, height) { return { x: (index % columns) * (width + GAP), y: Math.floor(index / columns) * (height + GAP) }; }

/**
 * Puts the live frame in its screen's slot and a preview in every other. With keep, the board moves so the live frame
 * stays where it was on the screen (the app navigated); without, the board stays and the live frame takes the place of
 * the preview pressed
 */
function layout(keep) {
    if (!current) return;
    const [width, height] = shell.canvas.size();
    const beforeX = Number(artboard.dataset.slotX || 0);
    const beforeY = Number(artboard.dataset.slotY || 0);
    const slot = placeOf(slotOf(current), width, height);
    artboard.dataset.slotX = String(slot.x);
    artboard.dataset.slotY = String(slot.y);
    artboard.style.setProperty('--slot-x', slot.x + 'px');
    artboard.style.setProperty('--slot-y', slot.y + 'px');
    if (keep && (slot.x !== beforeX || slot.y !== beforeY) && document.body.classList.contains('editing')) shell.canvas.shift(slot.x - beforeX, slot.y - beforeY);
    const label = artboard.querySelector('.artboard-label span');
    if (label) label.textContent = (document.body.dataset.appName || '') + (screens.length > 1 ? ' · ' + titleOf(current) : '');
    for (const [name, preview] of previews) {
        if (name === current || !screens.some((screen) => screen.name === name)) dropPreview(name, preview);
    }
    screens.forEach((screen, index) => {
        if (screen.name === current) return;
        let preview = previews.get(screen.name);
        if (!preview) preview = makePreview(screen.name);
        const place = placeOf(index, width, height);
        preview.element.style.left = place.x + 'px';
        preview.element.style.top = place.y + 'px';
        preview.element.style.width = width + 'px';
        preview.element.style.height = height + 'px';
        preview.label.textContent = screen.title;
        preview.cover.setAttribute('aria-label', fill(T['screens.workOn'], { name: screen.title }));
        preview.idle.textContent = screen.title;
    });
}

function makePreview(name) {
    const element = document.createElement('div');
    element.className = 'preview';
    element.dataset.screen = name;
    const label = document.createElement('p');
    label.className = 'artboard-label';
    label.setAttribute('aria-hidden', 'true');
    const labelText = document.createElement('span');
    label.append(labelText);
    const holder = document.createElement('div');
    holder.className = 'preview-frame';
    const idle = document.createElement('div');
    idle.className = 'preview-idle';
    const cover = document.createElement('button');
    cover.type = 'button';
    cover.className = 'preview-cover';
    cover.addEventListener('click', () => choose(name));
    element.append(label, idle, holder, cover);
    world.append(element);
    const preview = { element, label: labelText, holder, cover, idle, panel: null, visible: false };
    previews.set(name, preview);
    seen.observe(element);
    return preview;
}

function dropPreview(name, preview) {
    seen.unobserve(preview.element);
    unmount(preview);
    preview.element.remove();
    previews.delete(name);
}

/** Mounts every preview in view again, with the document and data as they are now */
function remount() {
    for (const preview of previews.values()) {
        unmount(preview);
        if (preview.visible) mount(preview.element.dataset.screen, preview);
    }
}

function mounted() { let count = 0; for (const preview of previews.values()) if (preview.panel) count += 1; return count; }

function mount(name, preview) {
    if (preview.panel || mounted() >= MAX_LIVE || !host || !host.mount) return;
    const snapshot = host.snapshot ? host.snapshot() : undefined;
    if (!snapshot) return;
    const documentOn = Object.assign({}, snapshot.document, { start: name });
    preview.panel = host.mount(preview.holder, { document: documentOn, icons: snapshot.icons }, titleOf(name));
    const writes = Object.entries(snapshot.data || {}).map(([key, value]) => ({ path: '$.data.' + key, value }));
    if (writes.length > 0) preview.panel.write(writes);
    preview.idle.hidden = true;
}

function unmount(preview) {
    if (!preview.panel) return;
    preview.panel.dispose();
    preview.panel = null;
    preview.holder.replaceChildren();
    preview.idle.hidden = false;
}

// Only the previews in view are mounted
const seen = new IntersectionObserver((entries) => {
    for (const entry of entries) {
        const name = entry.target.dataset.screen;
        const preview = previews.get(name);
        if (!preview) continue;
        preview.visible = entry.isIntersecting;
        if (entry.isIntersecting) mount(name, preview);
        else unmount(preview);
    }
}, { root: null, rootMargin: '0px' });

/** Makes a screen the one the editor works on: the live frame goes there */
function choose(name) {
    if (!screens.some((screen) => screen.name === name)) return;
    says('');
    if (host && host.navigate) host.navigate(name);
    current = name;
    show();
    layout();
}

/** One change to the screens; the answer is the new list */
async function change(body) {
    says('');
    try {
        const response = await fetch(base + '/screens', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const answer = await response.json().catch(() => ({}));
        if (!response.ok) { says(answer.message || T['inspect.changeRefused']); return false; }
        apply(answer);
        return true;
    } catch {
        says(T['inspect.requestFailed']);
        return false;
    }
}

function freeName(stem) {
    let name = stem;
    for (let n = 2; screens.some((screen) => screen.name === name); n += 1) name = stem + '-' + n;
    return name;
}

function valueOf(payload) { return payload && typeof payload === 'object' && 'value' in payload ? payload.value : payload; }

async function onEmit(name, payload) {
    switch (name) {
        case 'screenGo': if (typeof payload === 'string') choose(payload); return;
        case 'screenNew': typedNew = String(valueOf(payload) || '').trim(); return;
        case 'screenRenameText': typedRename = String(valueOf(payload) || '').trim(); return;
        case 'screenAdd': {
            const name = typedNew;
            if (!NAME.test(name)) { says(T['screens.nameRule']); return; }
            if (await change({ action: 'add', name })) { typedNew = ''; editor.set({ screenNew: '' }); choose(name); }
            return;
        }
        case 'screenRename': {
            const to = typedRename;
            if (!current || to === current) return;
            if (!NAME.test(to)) { says(T['screens.nameRule']); return; }
            const from = current;
            current = to;
            if (await change({ action: 'rename', name: from, to })) choose(to);
            else { current = from; show(); }
            return;
        }
        case 'screenCopy': {
            if (!current) return;
            const to = freeName(current + '-copy');
            if (await change({ action: 'copy', name: current, to })) choose(to);
            return;
        }
        case 'screenHome': if (current) await change({ action: 'home', name: current }); return;
        case 'screenColumns': {
            const chosen = Number(String(valueOf(payload) || '').replace(/^n/, ''));
            if (!COLUMN_CHOICES.includes(chosen) || chosen === columns) return;
            columns = chosen;
            try { localStorage.setItem(COLUMNS_KEY, String(chosen)); } catch { /* not kept: this page still uses it */ }
            show();
            // The live frame keeps its place on the screen; the others move around it
            layout(true);
            return;
        }
        case 'screenDelete': {
            if (!current || current === start) return;
            if (!confirm(fill(T['screens.deleteConfirm'], { name: titleOf(current) }))) return;
            const gone = current;
            if (await change({ action: 'delete', name: gone })) choose(start || (screens[0] ? screens[0].name : ''));
            return;
        }
    }
}

if (shell && editor && host) {
    editor.onEmit((name, payload) => void onEmit(name, payload));
    editor.onReady(() => show());
    shell.canvas.onSize(() => { layout(); remount(); });
    // The live frame's data reaches the previews; a route the app moved to moves the live frame's slot
    addEventListener('stateui:change', (event) => {
        const detail = event.detail || {};
        const path = typeof detail.path === 'string' ? detail.path : '';
        if (path === '$.data' || path.startsWith('$.data.')) {
            for (const preview of previews.values()) {
                if (!preview.panel) continue;
                if (path === '$.data') preview.panel.write(Object.entries(detail.value || {}).map(([key, value]) => ({ path: '$.data.' + key, value })));
                else if (detail.value !== undefined) preview.panel.write([{ path, value: detail.value }]);
            }
        }
        if (path === '$.route' || path.startsWith('$.route.')) {
            const screen = routeScreen();
            if (screen && screen !== current && screens.some((candidate) => candidate.name === screen)) { current = screen; show(); layout(true); }
        }
    });
    // A new document: the list again, and the previews mounted again with it
    new MutationObserver(() => {
        const next = document.body.dataset.revision || '';
        if (next === revision) return;
        revision = next;
        void load().then(remount);
    }).observe(document.body, { attributes: true, attributeFilter: ['data-revision'] });
    void load();
}
`;
