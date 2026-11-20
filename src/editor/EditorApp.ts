import type { Services, UiToolDefinition } from '@punyts/stateui-mcp';
import { LOGO_SVG } from '../http/logo.js';
import { textsOf } from '../http/text.js';
import type { Texts } from '../http/text.js';
import { COMPONENT_CATEGORIES } from '../inspector/constants.js';
import type { PageSpec } from '../pages/PageSpec.js';
import { CODE_SOURCE, PersonPages } from '../pages/PersonPages.js';
import type { PageSource } from '../pages/PersonPages.js';
import { LANGUAGE_NAMES, LANGUAGES, MODES } from '../prefs/Preferences.js';
import type { Stamps } from '../storage/Stamps.js';
import { alone } from '../storage/exclusive.js';
import type { Exclusive } from '../storage/exclusive.js';

/** The name of each person's editor, an app of their own in their workspace */
export const EDITOR_APP = 'magnetic-editor';

/**
 * The editor as a StateUI app: panels floating over the canvas, as Magnetic's editor has always looked. The page lays
 * the editor over the whole window, above the canvas, in the page itself; its screen and stage let presses through
 * (`passThrough`), it and its app draw no surface (`seeThrough`), and its panels take the presses, so the canvas shows
 * and a click anywhere else reaches it and the app on it.
 *
 * The page drives the editor through its data and its emits only, never through the paths of its nodes, so a person (or
 * the agent) can move, restyle, add or drop any panel and the rest keeps working:
 *
 * - The page writes `$.data.editor` (one record: the app's name, the tool, the zoom, the status, which panels are open,
 *   the selection's breadcrumb and details, the person's choices) and the lists `messages`, `calls`, `links`,
 *   `components`, `paths` and `feed`.
 * - The editor emits what the person does (see `EDITOR_EMITS`), which the page acts on.
 * - Two parts are found by their key wherever they are: `stage`, the full-window area whose children float (each is
 *   let through), and `propertyFields`, the panel the page fills with a field per property of the selected node. The
 *   inspector's tabs follow `$.data.editor.tab`.
 */
export const EDITOR_KEYS = { stage: 'stage', propertyFields: 'propertyFields' } as const;

/** What the editor emits, for the page's script */
export const EDITOR_EMITS = [
    'home', 'open', 'size', 'zoomIn', 'zoomOut', 'zoomReset', 'zoomFit', 'tool', 'view', 'layerLayout', 'layerData', 'layerLogic',
    'share', 'shareClose', 'shareRight', 'shareMake', 'linkCopy', 'linkRevoke', 'prefs', 'prefsClose', 'mode', 'language',
    'chat.send', 'chatToggle', 'chatClose', 'keepOpen', 'model', 'stop', 'idea1', 'idea2', 'idea3', 'focusClear', 'addToChat',
    'inspectorClose', 'tab', 'crumb', 'remove', 'search', 'category', 'place', 'grab', 'dragMove', 'dragEnd', 'library', 'libraryClose', 'screensPanel', 'screensClose', 'screenGo', 'screenNew', 'screenAdd', 'screenRenameText', 'screenRename', 'screenCopy', 'screenHome', 'screenDelete', 'screenColumns', 'path', 'ask',
    'connectionsPanel', 'connectionsClose', 'connectionsManage', 'connectionAsk', 'sharedPanel', 'sharedClose', 'sharedManage', 'sharedAsk',
    'feedback', 'feedbackClose', 'feedbackKind', 'feedbackText', 'feedbackSend'
] as const;

const E = '$.data.editor';

/** The fields of `$.data.editor` that are true until the page says otherwise: what starts hidden */
const HIDDEN_AT_FIRST = [
    'noSelection', 'noDetail', 'noFocus', 'noDataLine', 'noNotice', 'cannotRemove', 'notWorking', 'notBlank', 'noStatus', 'noModels', 'noMessages',
    'chatHidden', 'inspectorHidden', 'shareHidden', 'prefsHidden', 'hintHidden', 'drawerHidden', 'narrowHidden', 'libraryHidden', 'screensHidden', 'isHome', 'notHome', 'noScreensStatus',
    'connectionsHidden', 'noConnectionsStatus', 'cannotManage', 'sharedHidden', 'noSharedStatus', 'cannotManageData', 'feedbackHidden', 'noBudget'
];

/** The models of the editor's data */
const MODELS: Record<string, readonly Record<string, unknown>[]> = {
    'magnetic-editor': [
        ...['appName', 'workspaceName', 'connectionsStatus', 'sharedStatus', 'zoom', 'status', 'dataLine', 'inspectorStatus', 'heading', 'detailPath', 'detailValue', 'detailShown', 'detailRead', 'detailWritten', 'shareStatus', 'prefsStatus', 'notice', 'note', 'feedbackText', 'feedbackStatus', 'budgetLine'].map((field) => ({ op: 'set', field, type: 'string', default: '' })),
        { op: 'set', field: 'size', type: 'string', default: 'desktop' },
        { op: 'set', field: 'feedbackKind', type: 'string', default: 'bug' },
        { op: 'set', field: 'tool', type: 'string', default: 'use' },
        { op: 'set', field: 'shareRight', type: 'string', default: 'use' },
        { op: 'set', field: 'mode', type: 'string', default: 'system' },
        { op: 'set', field: 'language', type: 'string', default: 'en' },
        { op: 'set', field: 'crumb', type: 'string', default: '' },
        { op: 'set', field: 'crumbs', type: 'object', default: {} },
        // What the next request is about: a chip per thing, keyed by an id the page gives it
        { op: 'set', field: 'focusItems', type: 'object', default: {} },
        // What the view shown sends the agent: a fixed chip per part (the view, and in Screens each layer that is on)
        { op: 'set', field: 'contextItems', type: 'object', default: {} },
        // The person's agent use, in cents of their whole budget, and the ring's tone (accent, then warning, then danger)
        { op: 'set', field: 'budgetUsed', type: 'number', default: 0 },
        { op: 'set', field: 'budgetTotal', type: 'number', default: 1 },
        { op: 'set', field: 'budgetTone', type: 'string', default: 'accent' },
        { op: 'set', field: 'tab', type: 'string', default: 'properties' },
        { op: 'set', field: 'model', type: 'string', default: '' },
        { op: 'set', field: 'models', type: 'object', default: {} },
        ...['working', 'blank', 'hasMessages', 'keepOpen', 'wideHidden', 'chatOff', 'notScreensView', 'noBoard', 'isNarrow', ...HIDDEN_AT_FIRST].map((field) => ({ op: 'set', field, type: 'boolean', default: HIDDEN_AT_FIRST.includes(field) })),
        // The view the canvas shows (Screens, Statenet, Theme, Logic), and the layers on the screen tiles
        { op: 'set', field: 'view', type: 'string', default: 'screens' },
        { op: 'set', field: 'layers', type: 'object', default: { layout: false, data: false, logic: false } },
        // How the rail's buttons look: solid while on, ghost while off (the page writes them with the tool and the layers)
        { op: 'set', field: 'toolLook', type: 'object', default: { use: 'solid', move: 'ghost', select: 'ghost' } },
        { op: 'set', field: 'libraryLook', type: 'string', default: 'ghost' },
        { op: 'set', field: 'libraryTone', type: 'string', default: 'neutral' },
        { op: 'set', field: 'screensLook', type: 'string', default: 'ghost' },
        { op: 'set', field: 'screensTone', type: 'string', default: 'neutral' },
        { op: 'set', field: 'connectionsLook', type: 'string', default: 'ghost' },
        { op: 'set', field: 'connectionsTone', type: 'string', default: 'neutral' },
        { op: 'set', field: 'sharedLook', type: 'string', default: 'ghost' },
        { op: 'set', field: 'sharedTone', type: 'string', default: 'neutral' },
        // The Screens panel: the screen worked on, the names typed, and what the last change said
        ...['screenName', 'screenRename', 'screenNew', 'screensStatus'].map((field) => ({ op: 'set', field, type: 'string', default: '' })),
        // How many screens the canvas lays side by side before it starts a new row
        { op: 'set', field: 'screenColumns', type: 'string', default: 'n5' },
        { op: 'set', field: 'layerLook', type: 'object', default: { layout: 'ghost', data: 'ghost', logic: 'ghost' } },
        // And their tone: the accent while on, the ink while off
        { op: 'set', field: 'toolTone', type: 'object', default: { use: 'accent', move: 'neutral', select: 'neutral' } },
        { op: 'set', field: 'layerTone', type: 'object', default: { layout: 'neutral', data: 'neutral', logic: 'neutral' } }
    ],
    'magnetic-message': [
        { op: 'set', field: 'id', type: 'string', required: true },
        { op: 'set', field: 'author', type: 'string', required: true },
        { op: 'set', field: 'text', type: 'string' },
        { op: 'set', field: 'time', type: 'string' }
    ],
    'magnetic-call': [
        { op: 'set', field: 'id', type: 'string', required: true },
        { op: 'set', field: 'line', type: 'string', required: true }
    ],
    'magnetic-link': [
        { op: 'set', field: 'id', type: 'string', required: true },
        { op: 'set', field: 'title', type: 'string', required: true },
        { op: 'set', field: 'note', type: 'string' },
        { op: 'set', field: 'url', type: 'string' },
        { op: 'set', field: 'revoked', type: 'boolean' }
    ],
    'magnetic-connection': [
        { op: 'set', field: 'id', type: 'string', required: true },
        { op: 'set', field: 'title', type: 'string', required: true },
        { op: 'set', field: 'subtitle', type: 'string' }
    ],
    'magnetic-screen': [
        { op: 'set', field: 'id', type: 'string', required: true },
        { op: 'set', field: 'name', type: 'string', required: true },
        { op: 'set', field: 'title', type: 'string' },
        { op: 'set', field: 'note', type: 'string' },
        { op: 'set', field: 'current', type: 'boolean' }
    ],
    'inspector-component': [
        { op: 'set', field: 'id', type: 'string', required: true },
        { op: 'set', field: 'name', type: 'string', required: true },
        { op: 'set', field: 'summary', type: 'string' }
    ],
    'inspector-path': [
        { op: 'set', field: 'id', type: 'string', required: true },
        { op: 'set', field: 'label', type: 'string', required: true },
        { op: 'set', field: 'parentId', type: 'string' },
        { op: 'set', field: 'hasChildren', type: 'boolean' }
    ],
    'inspector-change': [
        { op: 'set', field: 'id', type: 'string', required: true },
        { op: 'set', field: 'line', type: 'string', required: true }
    ]
};

/**
 * The editor's own icons: the glyphs of the old hand-written editor, as 24×24 outline path data the app carries of its
 * own (ui_icons_write's format), so its buttons draw them rather than the nearest icons of the set. `minus` and `plus`
 * win over the set's icons of those names. The old `prefs` circle is a path here, since an app icon is path data only
 */
export const EDITOR_ICONS = {
    chat: { outline: ['M4 5h16v11H9l-5 4z'] },
    send: { outline: ['M12 19V5M5 12l7-7 7 7'] },
    pointer: { outline: ['M5 3l14 8-6 2-3 6z'] },
    select: { outline: ['M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4', 'M10 10l7 3-3 1-1 3z'] },
    hand: {
        outline: ['M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5v-6a1.5 1.5 0 0 1 3 0V11M14 6.5a1.5 1.5 0 0 1 3 0V11M17 8.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-2.7L4.3 14a1.5 1.5 0 0 1 2.4-1.8L8 14']
    },
    minus: { outline: ['M5 12h14'] },
    plus: { outline: ['M12 5v14M5 12h14'] },
    fit: { outline: ['M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'] },
    components: { outline: ['M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z', 'M17 14v6M14 17h6'] },
    screens: { outline: ['M3 6h7v12H3zM14 6h7v12h-7z'] },
    connections: { outline: ['M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0z', 'M12 16v5'] },
    'shared-data': { outline: ['M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z', 'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6', 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'] },
    bug: { outline: ['M9 9h6a3 3 0 0 1 3 3v3a6 6 0 0 1-12 0v-3a3 3 0 0 1 3-3z', 'M9 9V8a3 3 0 0 1 6 0v1M12 12v9M6 13H3M21 13h-3M6.5 18L4 20M17.5 18l2.5 2M7 10L5 8M17 10l2-2'] },
    prefs: { outline: ['M4 12a8 8 0 1 0 16 0a8 8 0 1 0 -16 0', { d: 'M12 4a8 8 0 0 0 0 16z', fill: true }] }
} as const;

const emit = (target: string, from?: string): Record<string, unknown> => ({ command: 'emit', target, ...(from !== undefined && { from }) });
const button = (title: string, target: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ component: 'button', size: 'sm', variant: 'ghost', _title: title, on: { press: emit(target) }, ...extra });
const icon = (title: string, target: string, name: string, extra: Record<string, unknown> = {}): Record<string, unknown> => button(title, target, { icon: name, iconPosition: 'only', corners: 'pill', tone: 'neutral', ...extra });
const caption = (text: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ component: 'text', textRole: 'caption', _text: text, ...extra });
const bound = (path: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ component: 'text', '<-_text': path, ...extra });

/** A panel floating over the canvas, at its place on the stage, as tight as the old editor's */
function float(placement: Record<string, string>, children: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { component: 'panel', elevation: 'raised', bordered: true, padding: 'sm', density: 'compact', placement, layout: { type: 'column', gap: 'sm' }, children, ...extra };
}

/** Lengths that follow the window, as the old editor's CSS did: never wider than the window less its margins */
const fit = (width: string): string => `min(${width}, calc(100% - 24px))`;
/** Below 760px the rail runs along the top, so what opens under the top corners starts lower */
const BELOW_RAIL = 'clamp(64px, (760px - 100vw) * 1000, 116px)';
/**
 * The inspector: at the right, below the corners, 320px wide; below 760px a sheet across the bottom, 45% of the height,
 * as the old editor's was, so the app stays in sight above it
 */
const INSPECTOR = {
    right: '12px',
    // Above the chat bar, also when it shows what the next request is about on a line of its own
    bottom: '100px',
    // (760px - 100vw) * 1000 is far below the lower bound from 760px up and far above the upper one below it
    y: 'clamp(64px, (760px - 100vw) * 1000, calc(55vh - 100px))',
    width: `clamp(${fit('320px')}, (760px - 100vw) * 1000, calc(100% - 24px))`
};
/**
 * The component library: right of the rail, below the corners, 288px wide and down to the bottom of the window less its
 * margin; while the centred chat bar (640px) would reach under it, below 1432px, it stops above the chat bar. Below 760px
 * a sheet across the bottom, as the inspector is
 */
const LIBRARY = {
    x: 'clamp(12px, (100vw - 760px) * 1000, 96px)',
    bottom: 'clamp(12px, (1432px - 100vw) * 1000, 100px)',
    y: 'clamp(76px, (760px - 100vw) * 1000, calc(55vh - 100px))',
    width: `clamp(${fit('288px')}, (760px - 100vw) * 1000, calc(100% - 24px))`
};
/** Below 1120px the chat bar reaches the zoom's corner, so the zoom sits above it */
const ABOVE_CHAT = 'clamp(12px, (1120px - 100vw) * 1000, 80px)';

/** A row inside a floating panel; a spacer that grows pushes what follows it to the end */
function row(children: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { component: 'panel', padding: 'none', layout: { type: 'row', gap: 'sm', align: 'center' }, children, ...extra };
}
const spacer = (): Record<string, unknown> => ({ component: 'panel', padding: 'none', placement: { grow: 1 }, children: {} });

/** Magnetic's logo, as the frame (which has no network) can show it */
const LOGO = `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString('base64')}`;

/** The row of a top corner: the gap between its parts as wide as the corner's own padding, so the spaces are even */
const CORNER_ROW = { layout: { type: 'row', gap: 'md', align: 'center' } };

/** The corner at the top left: Magnetic's logo (back to the apps), the app's name, the frame size, its turn and Open; as wide as they are, up to half the window */
function nameCorner(t: Texts): Record<string, unknown> {
    return float({ x: '12px', y: '12px', maxWidth: 'max(calc(50% - 32px), calc(100% - 120px))' }, {
        bar: row({
            home: { component: 'image', src: LOGO, _alt: t['shell.allApps'], interactive: true, backdrop: false, ratio: '1:1', fit: 'contain', placement: { height: '28px' }, on: { press: emit('home') } },
            name: bound(`${E}.appName`, { textRole: 'heading', truncate: 1, placement: { grow: 1 } }),
            // The workspace the app is in: the person's own, or an org's
            workspace: bound(`${E}.workspaceName`, { textRole: 'caption', muted: true, truncate: 1 }),
            size: {
                component: 'selectField',
                size: 'sm',
                variant: 'soft',
                width: 'auto',
                titlePosition: 'hidden',
                _label: t['shell.frameSize'],
                options: { desktop: { _label: t['shell.size.desktop'] }, tablet: { _label: t['shell.size.tablet'] }, phone: { _label: t['shell.size.phone'] } },
                '<-value': `${E}.size`,
                on: { change: emit('size') }
            },
            // Turns the frame between landscape and portrait: its width and height swap. Below 760px the corner has no room
            turn: icon(t['shell.turn'], 'turn', 'rotate-rectangle', { '<-hidden': `${E}.isNarrow` }),
            // Soft, so its box shows: every part of the bar is then a box with the same space either side
            open: button(t['shell.open'], 'open', { tone: 'accent', variant: 'soft' })
        }, CORNER_ROW)
    });
}

/** The editor's views, in the order the selector shows them (docs/design/magnetic-show-views.md) */
export const EDITOR_VIEWS = ['screens', 'statenet', 'theme', 'logic'] as const;

/**
 * The corner at the top right: the view selector (a segmented control; below 760px a menu on the top rail instead),
 * the bug button (feedback), the person's choices and Share
 */
function shareCorner(t: Texts): Record<string, unknown> {
    return float({ right: '12px', y: '12px' }, {
        bar: row({
            views: { component: 'segmented', size: 'sm', _label: t['shell.view'], options: viewOptions(t), '<-value': `${E}.view`, '<-hidden': `${E}.isNarrow`, on: { change: emit('view') } },
            feedback: icon(t['feedback.open'], 'feedback', 'bug'),
            prefs: icon(t['prefs.open'], 'prefs', 'prefs'),
            share: { component: 'button', size: 'sm', _title: t['shell.share'], on: { press: emit('share') } }
        }, CORNER_ROW)
    });
}

/** The views by name, for the selector */
const viewOptions = (t: Texts): Record<string, unknown> => Object.fromEntries(EDITOR_VIEWS.map((name) => [name, { _label: t[`shell.view.${name}`] }]));

/**
 * The rail at the left, in the Screens view: the pointer tools and panels, one above the other, a line, then the layers
 * the screen tiles show (layout, data, logic). Each is a button that is solid while on (`toolLook`, `layerLook`); a
 * press emits `tool` with the tool's name, or the layer's `layer…`. Below 760px the page shows the same rail along the top
 * instead (`narrow`), led by the view menu, which stays there in the other views when the tools hide
 */
function rail(t: Texts, narrow = false): Record<string, unknown> {
    const tool = (name: 'use' | 'move' | 'select', key: 'shell.useKey' | 'shell.moveKey' | 'shell.selectKey', glyph: string): Record<string, unknown> => ({
        component: 'button',
        size: 'sm',
        icon: glyph,
        iconPosition: 'only',
        _title: t[key],
        '<-variant': `${E}.toolLook.${name}`,
        '<-tone': `${E}.toolTone.${name}`,
        on: { press: { command: 'emit', target: 'tool', value: name } }
    });
    const layer = (name: 'layout' | 'data' | 'logic', target: string): Record<string, unknown> => ({
        component: 'button',
        size: 'sm',
        fill: !narrow,
        _title: t[`shell.layer.${name}`],
        '<-variant': `${E}.layerLook.${name}`,
        '<-tone': `${E}.layerTone.${name}`,
        on: { press: emit(target) }
    });
    const line = narrow ? 'row' : 'column';
    // Below 760px, the rail's tools are the Screens view's; the view menu shows in every view
    const screensOnly = narrow ? { '<-hidden': `${E}.notScreensView` } : {};
    return float(narrow ? { x: '12px', y: '64px', maxWidth: 'calc(100% - 24px)' } : { x: '12px', center: 'y' }, {
        ...(narrow && {
            viewMenu: { component: 'selectField', size: 'sm', variant: 'soft', width: 'auto', titlePosition: 'hidden', _label: t['shell.view'], options: viewOptions(t), '<-value': `${E}.view`, on: { change: emit('view') } }
        }),
        tools: {
            ...screensOnly,
            component: 'panel',
            padding: 'none',
            layout: { type: line, gap: 'sm', align: 'center' },
            children: {
                use: tool('use', 'shell.useKey', 'pointer'),
                move: tool('move', 'shell.moveKey', 'hand'),
                select: tool('select', 'shell.selectKey', 'select'),
                // Solid while the library shows, as a tool is while it is on
                library: { component: 'button', size: 'sm', icon: 'components', iconPosition: 'only', _title: t['library.open'], '<-variant': `${E}.libraryLook`, '<-tone': `${E}.libraryTone`, on: { press: emit('library') } },
                screens: { component: 'button', size: 'sm', icon: 'screens', iconPosition: 'only', _title: t['screens.open'], '<-variant': `${E}.screensLook`, '<-tone': `${E}.screensTone`, on: { press: emit('screensPanel') } },
                connections: { component: 'button', size: 'sm', icon: 'connections', iconPosition: 'only', _title: t['connectionsPanel.open'], '<-variant': `${E}.connectionsLook`, '<-tone': `${E}.connectionsTone`, on: { press: emit('connectionsPanel') } },
                shared: { component: 'button', size: 'sm', icon: 'shared-data', iconPosition: 'only', _title: t['sharedPanel.open'], '<-variant': `${E}.sharedLook`, '<-tone': `${E}.sharedTone`, on: { press: emit('sharedPanel') } }
            }
        },
        line: { component: 'divider', orientation: narrow ? 'vertical' : 'horizontal', ...screensOnly },
        layersLabel: caption(t['shell.layers'], { caps: true, muted: true, align: 'center', ...screensOnly }),
        layers: {
            ...screensOnly,
            component: 'panel',
            padding: 'none',
            layout: { type: line, gap: 'sm', align: 'stretch' },
            children: { layerLayout: layer('layout', 'layerLayout'), layerData: layer('data', 'layerData'), layerLogic: layer('logic', 'layerLogic') }
        }
    }, narrow ? { '<-hidden': `${E}.narrowHidden`, layout: { type: 'row', gap: 'sm', align: 'center' } } : { '<-hidden': `${E}.wideHidden` });
}

/** The zoom at the bottom right, above the chat bar when the window is too narrow for both; hidden in the views without the board (Theme, Logic) */
function zoom(t: Texts): Record<string, unknown> {
    return float({ right: '12px', bottom: ABOVE_CHAT }, {
        bar: row({
            out: icon(t['shell.zoomOutKey'], 'zoomOut', 'minus'),
            reset: { component: 'button', size: 'sm', variant: 'ghost', tone: 'neutral', '<-_title': `${E}.zoom`, on: { press: emit('zoomReset') } },
            in: icon(t['shell.zoomInKey'], 'zoomIn', 'plus'),
            fit: icon(t['shell.fitKey'], 'zoomFit', 'fit')
        }, { layout: { type: 'row', gap: 'none', align: 'center' } })
    }, { '<-hidden': `${E}.noBoard` });
}

/** The chat bar at the bottom: what the next request is about, the request, the model and Send */
function chatBar(t: Texts): Record<string, unknown> {
    // The lines above the bar sit in from its rounded ends, as the old ones did (0.9rem)
    const line = (children: Record<string, unknown>, hidden: string): Record<string, unknown> =>
        row(children, { padding: 'md', theme: { panel: { padding: '0px 14px' } }, '<-hidden': hidden });
    return float({ center: 'x', bottom: '12px', width: fit('640px') }, {
        status: line({ text: bound(`${E}.status`, { textRole: 'caption', placement: { grow: 1 } }) }, `${E}.noStatus`),
        // Each thing the next request is about is a chip with its own ×; Clear takes them all
        focus: line({
            about: { component: 'text', textRole: 'caption', _text: t['chat.about'] },
            chips: { component: 'chipList', size: 'sm', placement: { grow: 1 }, _label: t['chat.about'], '<-items': `${E}.focusItems`, on: { remove: emit('focusRemove') } },
            clear: button(t['chat.clear'], 'focusClear')
        }, `${E}.noFocus`),
        dataLine: line({ text: bound(`${E}.dataLine`, { textRole: 'caption', placement: { grow: 1 } }) }, `${E}.noDataLine`),
        bar: {
            component: 'panel',
            padding: 'none',
            // One line however narrow, as the old chat bar was: the request narrows, the buttons keep their size. Every
            // part is one height, so the row lines them up both at one line and, at the bottom, as the request grows
            layout: { type: 'row', gap: 'md', align: 'end', wrap: false },
            // The small controls of the bar are as tall as the request (36px), as the old bar's were, with icons to match
            theme: { size: { control: { sm: '{size.control.md}' }, icon: { sm: '{size.icon.md}' } } },
            children: {
                chat: icon(t['shell.showChat'], 'chatToggle', 'chat'),
                // What the view shown tells the agent with each request: fixed chips, the view and in Screens each layer on, as tall
                // as the bar's controls (a chip is three quarters of the control height)
                view: { component: 'chipList', size: 'md', tone: 'accent', theme: { size: { control: { md: '48px' } } }, removable: false, _label: t['chat.view'], '<-items': `${E}.contextItems` },
                input: {
                    component: 'textareaField',
                    variant: 'ghost',
                    placement: { grow: 1 },
                    // Round at one line, like the bar around it, so its focus ring follows the bar's shape; the text sits in
                    // from the round ends, as the lines above it do
                    theme: { control: { radius: '18px', padding: { inline: '14px' } } },
                    _label: t['shell.request'],
                    _placeholder: t['shell.placeholder'],
                    titlePosition: 'hidden',
                    autoGrow: true,
                    rows: 1,
                    sendOnEnter: true,
                    // Off while the person may not ask the agent (their agent use is spent); the agent-use ring's tip says why
                    '<-disabled': `${E}.chatOff`,
                    on: { send: [emit('chat.send'), { command: 'clear' }] }
                },
                // The person's agent use as a ring, used against the whole budget; its tip says what is used and left, or,
                // once it is spent, that they can carry on by hand
                budget: {
                    component: 'tooltip',
                    side: 'top',
                    delay: 0,
                    '<-_text': `${E}.budgetLine`,
                    '<-hidden': `${E}.noBudget`,
                    // A small dial, 24px across, in the middle of the bar's height (36px)
                    placement: { height: '36px' },
                    trigger: { component: 'progress', shape: 'ring', size: 'sm', theme: { size: { icon: { sm: '9.6px' } } }, _label: t['chat.budgetRing'], '<-value': `${E}.budgetUsed`, '<-max': `${E}.budgetTotal`, '<-tone': `${E}.budgetTone` }
                },
                model: { component: 'selectField', size: 'sm', variant: 'soft', corners: 'pill', width: 20, titlePosition: 'hidden', _label: t['shell.model'], '<-options': `${E}.models`, '<-value': `${E}.model`, '<-hidden': `${E}.noModels`, on: { change: emit('model') } },
                send: { component: 'button', size: 'sm', corners: 'pill', _title: t['shell.send'], icon: 'send', iconPosition: 'only', '<-disabled': `${E}.chatOff`, on: { press: { command: 'send', target: '^bar.children.input' } } }
            }
        }
        // A round end at one line (half its 50px height), and the same corners when the lines above it show, as the
        // old bar's 1.6rem: a pill would round a taller bar into a lozenge
    }, { theme: { panel: { radius: '25px' } } });
}

/** The chat above the bar: the conversation, and the agent's activity while it works */
function chatPanel(t: Texts): Record<string, unknown> {
    return float(
        { center: 'x', bottom: '76px', width: fit('640px'), height: 'min(480px, calc(100% - 176px))' },
        {
            head: row({ title: { component: 'text', textRole: 'label', placement: { grow: 1 }, _text: t['shell.chat'] }, close: icon(t['shell.closeChat'], 'chatClose', 'x') }),
            empty: caption(t['chat.empty'], { '<-hidden': `${E}.hasMessages` }),
            messages: { component: 'messageList', '<-records': '$.data.messages', '<-hidden': `${E}.noMessages`, placement: { grow: 1 } },
            drawer: {
                component: 'panel',
                padding: 'none',
                '<-hidden': `${E}.drawerHidden`,
                layout: { type: 'column', gap: 'sm' },
                children: {
                    head: row({
                        title: { component: 'text', textRole: 'label', placement: { grow: 1 }, _text: t['shell.activity'] },
                        keep: { component: 'switchField', size: 'sm', _label: t['shell.keepOpen'], '<-checked': `${E}.keepOpen`, on: { change: emit('keepOpen') } },
                        stop: { component: 'button', size: 'sm', variant: 'soft', tone: 'danger', _title: t['shell.stop'], '<-hidden': `${E}.notWorking`, on: { press: emit('stop') } }
                    }),
                    note: bound(`${E}.note`, { textRole: 'caption', truncate: 2 }),
                    calls: { component: 'list', '<-items': '$.data.calls', density: 'compact', placement: { height: '120px' }, row: { component: 'text', truncate: 1, textRole: 'caption', '<-_text': '$row.line' } }
                }
            }
        },
        { '<-hidden': `${E}.chatHidden`, layout: { type: 'column', gap: 'sm' } }
    );
}

/** Over a blank app's frame: what to do first, and ideas to start from */
function blankHint(t: Texts): Record<string, unknown> {
    const idea = (n: 1 | 2 | 3): Record<string, unknown> => ({ component: 'card', elevation: 'flat', padding: 'sm', interactive: true, _subtitle: t[`shell.idea${n}`], on: { press: emit(`idea${n}`) } });
    return float(
        { center: 'both', width: fit('480px') },
        {
            title: { component: 'text', textRole: 'heading', _text: t['shell.blankTitle'] },
            text: caption(t['shell.blankText']),
            idea1: idea(1),
            idea2: idea(2),
            idea3: idea(3)
        },
        { '<-hidden': `${E}.hintHidden`, padding: 'md' }
    );
}

/** The Properties tab: the breadcrumb, what the selected node is, a field per property, and Delete */
function propertiesTab(t: Texts): Record<string, unknown> {
    return {
        component: 'panel',
        placement: { _tab: t['inspector.properties'] },
        padding: 'sm',
        layout: { type: 'column', gap: 'sm' },
        children: {
            crumbs: { component: 'breadcrumb', '<-items': `${E}.crumbs`, '<-current': `${E}.crumb`, '<-hidden': `${E}.noSelection`, on: { select: emit('crumb') } },
            heading: bound(`${E}.heading`, { textRole: 'label' }),
            // What to do with the selected node, above its fields so it is always in sight: give it to the agent with
            // the next request, or delete it
            actions: row({
                addToChat: { component: 'button', variant: 'soft', size: 'sm', icon: 'message-plus', _title: t['inspector.addToChat'], on: { press: emit('addToChat') } },
                remove: { component: 'button', variant: 'soft', tone: 'danger', size: 'sm', '<-hidden': `${E}.cannotRemove`, _title: t['inspector.delete'], on: { press: emit('remove') } }
            }, { '<-hidden': `${E}.noSelection` }),
            [EDITOR_KEYS.propertyFields]: { component: 'panel', padding: 'none', children: {} }
        }
    };
}

/**
 * The Connections panel, in the library's place beside the rail (the three take turns): the outside APIs of the app's
 * workspace and their endpoints, never a key. Pressing an endpoint asks the agent to show what it answers; Manage opens
 * the Connections page for those who manage the workspace's connections
 */
function connectionsPanel(t: Texts): Record<string, unknown> {
    return float(
        LIBRARY,
        {
            head: row({
                title: { component: 'text', textRole: 'label', placement: { grow: 1 }, _text: t['connectionsPanel.title'] },
                close: icon(t['connectionsPanel.close'], 'connectionsClose', 'x')
            }),
            hint: caption(t['connectionsPanel.hint']),
            status: bound(`${E}.connectionsStatus`, { textRole: 'caption', muted: true, '<-hidden': `${E}.noConnectionsStatus` }),
            list: {
                component: 'list',
                '<-items': '$.data.connections',
                rowHeight: 'xl',
                placement: { grow: 1 },
                row: { component: 'card', elevation: 'flat', padding: 'sm', interactive: true, '<-_title': '$row.title', '<-_subtitle': '$row.subtitle', on: { press: emit('connectionAsk', '$row.id') } }
            },
            manage: button(t['connectionsPanel.manage'], 'connectionsManage', { variant: 'soft', '<-hidden': `${E}.cannotManage` })
        },
        { '<-hidden': `${E}.connectionsHidden` }
    );
}

/**
 * The Shared data panel, in the library's place too: the datasets other owners shared with the app's workspace, read
 * only, with who shared each and its fields. Pressing one asks the agent to show it in the app; Manage data opens the
 * Data page for those who manage the workspace
 */
function sharedPanel(t: Texts): Record<string, unknown> {
    return float(
        LIBRARY,
        {
            head: row({
                title: { component: 'text', textRole: 'label', placement: { grow: 1 }, _text: t['sharedPanel.title'] },
                close: icon(t['sharedPanel.close'], 'sharedClose', 'x')
            }),
            hint: caption(t['sharedPanel.hint']),
            status: bound(`${E}.sharedStatus`, { textRole: 'caption', muted: true, '<-hidden': `${E}.noSharedStatus` }),
            list: {
                component: 'list',
                '<-items': '$.data.shared',
                rowHeight: 'xl',
                placement: { grow: 1 },
                row: { component: 'card', elevation: 'flat', padding: 'sm', interactive: true, '<-_title': '$row.title', '<-_subtitle': '$row.subtitle', on: { press: emit('sharedAsk', '$row.id') } }
            },
            manage: button(t['sharedPanel.manage'], 'sharedManage', { variant: 'soft', '<-hidden': `${E}.cannotManageData` })
        },
        { '<-hidden': `${E}.sharedHidden` }
    );
}

/**
 * The component library, a panel of its own beside the rail, shown when the editor opens on a wide window: find a
 * component by its words (narrowed as they are typed) or its category, then drag it onto the app, or press it and click
 * where it goes
 */
function library(t: Texts): Record<string, unknown> {
    return float(
        LIBRARY,
        {
            head: row({
                title: { component: 'text', textRole: 'label', placement: { grow: 1 }, _text: t['library.title'] },
                close: icon(t['library.close'], 'libraryClose', 'x')
            }),
            body: libraryBody(t)
        },
        { '<-hidden': `${E}.libraryHidden` }
    );
}

/** The choices of how many screens the canvas lays side by side in a row */
export const SCREEN_COLUMNS = [1, 2, 3, 4, 5, 6, 8, 10] as const;

/**
 * The Screens panel, in the library's place beside the rail (the two take turns): the app's screens, the one worked
 * on marked, a new one by name, and what can be done to the one worked on. Each screen shows on the canvas as a frame
 * of its own; pressing one here or there makes it the screen the editor works on
 */
function screensPanel(t: Texts): Record<string, unknown> {
    const name = (target: string, label: string, valuePath: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
        component: 'textField',
        size: 'sm',
        _label: label,
        '<-value': valuePath,
        placement: { grow: 1 },
        on: { change: emit(target) },
        ...extra
    });
    return float(
        LIBRARY,
        {
            head: row({
                title: { component: 'text', textRole: 'label', placement: { grow: 1 }, _text: t['screens.title'] },
                close: icon(t['screens.close'], 'screensClose', 'x')
            }),
            hint: caption(t['screens.pick']),
            columns: {
                component: 'selectField',
                size: 'sm',
                _label: t['screens.columns'],
                // keyed n1, n2…: a key may not be integer-like
                options: Object.fromEntries(SCREEN_COLUMNS.map((count) => [`n${count}`, { _label: String(count) }])),
                '<-value': `${E}.screenColumns`,
                on: { change: emit('screenColumns') }
            },
            list: {
                component: 'list',
                '<-items': '$.data.screens',
                rowHeight: 'xl',
                placement: { grow: 1 },
                row: { component: 'card', elevation: 'flat', padding: 'sm', interactive: true, '<-selected': '$row.current', '<-_title': '$row.title', '<-_subtitle': '$row.note', on: { press: emit('screenGo', '$row.name') } }
            },
            add: row({ name: name('screenNew', t['screens.new'], `${E}.screenNew`, { _placeholder: t['screens.newPlaceholder'] }), go: button(t['screens.add'], 'screenAdd', { variant: 'soft', tone: 'accent' }) }, { layout: { type: 'row', gap: 'sm', align: 'end' } }),
            thisTitle: { component: 'text', textRole: 'label', _text: t['screens.this'] },
            rename: row({ name: name('screenRenameText', t['screens.rename'], `${E}.screenRename`), go: button(t['screens.rename'], 'screenRename', { variant: 'soft' }) }, { layout: { type: 'row', gap: 'sm', align: 'end' } }),
            actions: row({
                copy: button(t['screens.copy'], 'screenCopy', { variant: 'soft' }),
                home: button(t['screens.makeHome'], 'screenHome', { variant: 'soft', '<-hidden': `${E}.isHome` }),
                isHome: caption(t['screens.isHome'], { muted: true, '<-hidden': `${E}.notHome` }),
                remove: button(t['screens.delete'], 'screenDelete', { variant: 'soft', tone: 'danger' })
            }, { layout: { type: 'row', gap: 'sm', align: 'center', wrap: true } }),
            status: bound(`${E}.screensStatus`, { textRole: 'caption', tone: 'danger', '<-hidden': `${E}.noScreensStatus` })
        },
        { '<-hidden': `${E}.screensHidden` }
    );
}

function libraryBody(t: Texts): Record<string, unknown> {
    return {
        component: 'panel',
        padding: 'none',
        placement: { grow: 1 },
        layout: { type: 'column', gap: 'sm' },
        children: {
            search: { component: 'searchBox', size: 'sm', _label: t['inspector.find'], _placeholder: t['inspector.find'], value: '', on: { input: emit('search'), change: emit('search') } },
            category: {
                component: 'selectField',
                size: 'sm',
                _label: t['inspector.category'],
                options: Object.fromEntries([['all', { _label: t['inspector.all'] }], ...COMPONENT_CATEGORIES.map((name) => [name, { _label: t[`inspector.cat.${name}`] }])]),
                value: 'all',
                on: { change: emit('category') }
            },
            hint: caption(t['inspector.pick']),
            cards: {
                component: 'list',
                '<-items': '$.data.components',
                rowHeight: 'xl',
                placement: { grow: 1 },
                _empty: t['inspector.noMatch'],
                // A drag source: the card holds the pointer and says where it is, so the page sees the drag cross out of
                // the editor's frame (which covers the window) onto the canvas, and takes the drop. Rows have one fixed
                // height, so the summary keeps to one line: a second ran into the next card
                row: {
                    component: 'card',
                    elevation: 'flat',
                    padding: 'sm',
                    interactive: true,
                    draggable: true,
                    layout: { type: 'column', gap: 'none' },
                    children: {
                        name: { component: 'text', textRole: 'label', truncate: 1, '<-_text': '$row.name' },
                        summary: { component: 'text', textRole: 'caption', truncate: 1, muted: true, '<-_text': '$row.summary' }
                    },
                    on: { press: emit('place', '$row.name'), dragStart: emit('grab', '$row.name'), dragMove: emit('dragMove'), dragEnd: emit('dragEnd') }
                }
            }
        }
    };
}

/** The State tab: `$.data` as a tree, what uses the chosen path, and the changes as they happen */
function stateTab(t: Texts): Record<string, unknown> {
    return {
        component: 'panel',
        placement: { _tab: t['inspector.state'] },
        padding: 'sm',
        layout: { type: 'column', gap: 'sm' },
        children: {
            paths: { component: 'tree', '<-records': '$.data.paths', selectable: 'single', density: 'compact', placement: { height: 'calc(100vh - 520px)' }, on: { select: emit('path') } },
            detail: {
                component: 'panel',
                padding: 'none',
                '<-hidden': `${E}.noDetail`,
                layout: { type: 'column', gap: 'sm' },
                children: {
                    path: bound(`${E}.detailPath`, { textRole: 'label' }),
                    value: bound(`${E}.detailValue`, { textRole: 'caption' }),
                    shown: bound(`${E}.detailShown`, { textRole: 'caption' }),
                    read: bound(`${E}.detailRead`, { textRole: 'caption' }),
                    written: bound(`${E}.detailWritten`, { textRole: 'caption' }),
                    ask: { component: 'button', size: 'sm', variant: 'soft', _title: t['inspect.ask'], on: { press: emit('ask') } }
                }
            },
            feedTitle: { component: 'text', textRole: 'label', _text: t['inspector.changes'] },
            feed: { component: 'list', '<-items': '$.data.feed', density: 'compact', placement: { height: '140px' }, _empty: t['inspector.noChanges'], row: { component: 'text', truncate: 1, textRole: 'caption', '<-_text': '$row.line' } }
        }
    };
}

/** The inspector at the right: its title and close button, what it is doing, and its two tabs, Properties and State (the library is a panel of its own) */
function inspector(t: Texts): Record<string, unknown> {
    return float(
        INSPECTOR,
        {
            head: row({
                title: { component: 'text', textRole: 'label', _text: t['shell.inspector'] },
                status: bound(`${E}.inspectorStatus`, { textRole: 'caption', truncate: 1, placement: { grow: 1 } }),
                close: icon(t['shell.closeInspector'], 'inspectorClose', 'x')
            }),
            // The tabs take the inspector's height below its head, and the open tab scrolls
            tabs: { component: 'tabs', placement: { grow: 1 }, '<-active': `${E}.tab`, on: { change: emit('tab') }, children: { properties: propertiesTab(t), state: stateTab(t) } }
        },
        { '<-hidden': `${E}.inspectorHidden` }
    );
}

/** Share, under its button: who may do what with a new link, and the links made, each with Copy and Revoke */
function shareSheet(t: Texts): Record<string, unknown> {
    return float(
        { right: '12px', y: BELOW_RAIL, width: fit('352px') },
        {
            head: row({ title: { component: 'text', textRole: 'label', placement: { grow: 1 }, _text: t['shell.shareThis'] }, close: icon(t['editor.close'], 'shareClose', 'x') }),
            make: {
                component: 'panel',
                padding: 'none',
                layout: { type: 'row', gap: 'sm', align: 'end' },
                children: {
                    right: {
                        component: 'selectField',
                        size: 'sm',
                        placement: { grow: 1 },
                        _label: t['shell.shareCan'],
                        options: { use: { _label: t['shell.right.use'] }, view: { _label: t['shell.right.view'] }, remix: { _label: t['shell.right.remix'] } },
                        '<-value': `${E}.shareRight`,
                        on: { change: emit('shareRight') }
                    },
                    make: { component: 'button', size: 'sm', _title: t['shell.makeLink'], on: { press: emit('shareMake') } }
                }
            },
            note: caption(t['shell.shareNote']),
            status: bound(`${E}.shareStatus`, { textRole: 'caption' }),
            links: {
                component: 'list',
                '<-items': '$.data.links',
                divided: true,
                rowHeight: 'xl',
                placement: { height: '200px' },
                _empty: t['share.none'],
                row: row({
                    text: {
                        component: 'panel',
                        padding: 'none',
                        placement: { grow: 1 },
                        layout: { type: 'column', gap: 'none' },
                        children: { title: { component: 'text', textRole: 'label', '<-_text': '$row.title' }, note: { component: 'text', textRole: 'caption', truncate: 1, '<-_text': '$row.note' } }
                    },
                    copy: { component: 'button', size: 'sm', variant: 'soft', _title: t['share.copy'], '<-hidden': '$row.revoked', on: { press: emit('linkCopy', '$row.id') } },
                    revoke: { component: 'button', size: 'sm', variant: 'ghost', tone: 'danger', _title: t['share.revoke'], '<-hidden': '$row.revoked', on: { press: emit('linkRevoke', '$row.id') } }
                })
            }
        },
        { '<-hidden': `${E}.shareHidden`, padding: 'md' }
    );
}

/** The person's choices, under their button: light, dark or the system's, and the language Magnetic speaks */
function prefsSheet(t: Texts): Record<string, unknown> {
    return float(
        { right: '12px', y: BELOW_RAIL, width: fit('240px') },
        {
            head: row({ title: { component: 'text', textRole: 'label', placement: { grow: 1 }, _text: t['prefs.title'] }, close: icon(t['editor.close'], 'prefsClose', 'x') }),
            mode: { component: 'selectField', size: 'sm', _label: t['prefs.mode'], options: Object.fromEntries(MODES.map((mode) => [mode, { _label: t[`prefs.${mode}`] }])), '<-value': `${E}.mode`, on: { change: emit('mode') } },
            language: { component: 'selectField', size: 'sm', _label: t['prefs.language'], options: Object.fromEntries(LANGUAGES.map((language) => [language, { _label: LANGUAGE_NAMES[language] }])), '<-value': `${E}.language`, on: { change: emit('language') } },
            status: bound(`${E}.prefsStatus`, { textRole: 'caption' })
        },
        { '<-hidden': `${E}.prefsHidden`, padding: 'md' }
    );
}

/**
 * Feedback, under the bug button: a bug, a comment or a feature request, in the person's words, sent to whoever runs
 * the server with the app's name, the frame size and the browser
 */
function feedbackSheet(t: Texts): Record<string, unknown> {
    return float(
        { right: '12px', y: BELOW_RAIL, width: fit('352px') },
        {
            head: row({ title: { component: 'text', textRole: 'label', placement: { grow: 1 }, _text: t['feedback.title'] }, close: icon(t['editor.close'], 'feedbackClose', 'x') }),
            kind: {
                component: 'selectField',
                size: 'sm',
                _label: t['feedback.kind'],
                options: { bug: { _label: t['feedback.kind.bug'] }, comment: { _label: t['feedback.kind.comment'] }, feature: { _label: t['feedback.kind.feature'] } },
                '<-value': `${E}.feedbackKind`,
                on: { change: emit('feedbackKind') }
            },
            text: {
                component: 'textareaField',
                size: 'sm',
                rows: 5,
                maxLength: 4000,
                _label: t['feedback.text'],
                _placeholder: t['feedback.placeholder'],
                '<-value': `${E}.feedbackText`,
                on: { change: emit('feedbackText') }
            },
            note: caption(t['feedback.note'], { muted: true }),
            send: row({ status: bound(`${E}.feedbackStatus`, { textRole: 'caption', placement: { grow: 1 } }), send: button(t['feedback.send'], 'feedbackSend', { variant: 'solid', tone: 'accent' }) })
        },
        { '<-hidden': `${E}.feedbackHidden`, padding: 'md' }
    );
}

/**
 * The editor's screen: a stage as big as the window, whose children float over the canvas at their places (the adhoc
 * layout holds each to its edges): the name corner, the Share corner, the rail, the zoom, the chat bar and the chat,
 * the inspector, the two sheets, the blank app's hint and the notice. The stage and the screen let a press anywhere
 * else through to the canvas (`passThrough`)
 */
function editorScreen(t: Texts): Record<string, unknown> {
    return {
        component: 'panel',
        padding: 'none',
        passThrough: true,
        layout: { type: 'column', gap: 'none' },
        children: {
            [EDITOR_KEYS.stage]: {
                component: 'panel',
                padding: 'none',
                passThrough: true,
                placement: { height: 'calc(100vh - 0px)' },
                layout: { type: 'adhoc' },
                children: {
                    nameCorner: nameCorner(t),
                    shareCorner: shareCorner(t),
                    rail: rail(t),
                    railTop: rail(t, true),
                    zoom: zoom(t),
                    hint: blankHint(t),
                    chat: chatPanel(t),
                    chatBar: chatBar(t),
                    library: library(t),
                    screens: screensPanel(t),
                    connections: connectionsPanel(t),
                    shared: sharedPanel(t),
                    inspector: inspector(t),
                    share: shareSheet(t),
                    prefs: prefsSheet(t),
                    feedback: feedbackSheet(t),
                    notice: float({ center: 'x', y: '12px', width: fit('480px') }, { text: bound(`${E}.notice`, { tone: 'danger' }) }, { '<-hidden': `${E}.noNotice` })
                }
            }
        }
    };
}

/** The editor's definition, in English: the other languages are written over it as locales */
function definition(): Record<string, unknown> {
    const t = textsOf('en');
    const data = {
        editor: { model: 'magnetic-editor', scope: 'persona' },
        messages: { model: 'magnetic-message', scope: 'persona' },
        calls: { model: 'magnetic-call', scope: 'persona' },
        links: { model: 'magnetic-link', scope: 'persona' },
        components: { model: 'inspector-component', scope: 'persona' },
        screens: { model: 'magnetic-screen', scope: 'persona' },
        connections: { model: 'magnetic-connection', scope: 'persona' },
        shared: { model: 'magnetic-connection', scope: 'persona' },
        paths: { model: 'inspector-path', scope: 'persona' },
        feed: { model: 'inspector-change', scope: 'persona' }
    };
    return { title: t['editor.title'], data, icons: EDITOR_ICONS, app: { seeThrough: true }, home: editorScreen(t) };
}

/** The editor as a page of Magnetic's, which a person's copy and an admin's draft are made from */
export const EDITOR: PageSpec = {
    name: EDITOR_APP,
    title: 'The editor',
    themed: true,
    required: ['chat.send', 'home'],
    keys: [EDITOR_KEYS.stage, EDITOR_KEYS.propertyFields],
    models: MODELS,
    definition
};

/** The editor's assembled document and icons, as a page mounts it */
export interface EditorDocument {
    readonly id: string;
    readonly document: Record<string, unknown>;
    readonly icons: Record<string, string>;
}

/**
 * Each person's editor: an app in their own workspace (`magnetic-editor`), made from Magnetic's version the first time
 * they edit, and made again when Magnetic's changes, unless they changed theirs (`PersonPages`). They open it in the
 * editor like any app, and reset it to Magnetic's
 */
export class EditorApps extends PersonPages {
    constructor(
        toolsOf: (services: Services) => readonly UiToolDefinition[],
        /** Where the version of each person's editor, and the revision Magnetic left it at, is kept */
        stamps: Stamps,
        /** Keeps two servers from making the same person's editor at once */
        exclusive: Exclusive = alone,
        source: () => PageSource = () => CODE_SOURCE
    ) {
        super(EDITOR, 'editor', toolsOf, stamps, source, exclusive);
    }

    /** A person's editor as the page mounts it */
    async document(services: Services, userId: string): Promise<EditorDocument> {
        const id = await this.id(services, userId);
        const app = await services.instanceViews.find(id);
        if (app === undefined) throw new Error('The editor app is gone');
        const message = await services.instanceViews.message(app, 'attach');
        return { id, document: message.document as Record<string, unknown>, icons: { ...message.icons } };
    }
}
