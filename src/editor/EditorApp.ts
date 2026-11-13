import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Services, UiToolDefinition } from '@punyts/stateui-mcp';
import { LOGO_SVG } from '../http/logo.js';
import { textsOf } from '../http/text.js';
import type { Texts } from '../http/text.js';
import { COMPONENT_CATEGORIES } from '../inspector/constants.js';
import { LANGUAGE_NAMES, LANGUAGES, MODES } from '../prefs/Preferences.js';
import { writeLocales } from '../stateui/localize.js';
import { run } from '../stateui/run.js';
import { readJson, writeJsonAtomic } from '../storage/jsonFile.js';

/** The name of each person's editor, an app of their own in their workspace */
export const EDITOR_APP = 'magnetic-editor';

/**
 * The editor as a StateUI app: panels floating over the canvas, as Magnetic's editor has always looked. The page lays
 * the editor's frame over the whole window, above the canvas, and lets through only the editor's panels (it clips the
 * frame to the boxes of the stage's children, which the frame reports as they move), so a click anywhere else reaches
 * the canvas and the app on it.
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
    'home', 'open', 'size', 'zoomIn', 'zoomOut', 'zoomReset', 'zoomFit', 'tool', 'showTheme', 'showLayout', 'showData', 'showLogic', 'showScreens',
    'share', 'shareClose', 'shareRight', 'shareMake', 'linkCopy', 'linkRevoke', 'prefs', 'prefsClose', 'mode', 'language',
    'chat.send', 'chatToggle', 'chatClose', 'keepOpen', 'model', 'stop', 'idea1', 'idea2', 'idea3', 'focusClear',
    'inspectorClose', 'tab', 'crumb', 'remove', 'search', 'category', 'place', 'path', 'ask'
] as const;

const E = '$.data.editor';

/** The fields of `$.data.editor` that are true until the page says otherwise: what starts hidden */
const HIDDEN_AT_FIRST = [
    'noSelection', 'noDetail', 'noFocus', 'noDataLine', 'noNotice', 'cannotRemove', 'notWorking', 'notBlank', 'noStatus', 'noModels', 'noMessages',
    'chatHidden', 'inspectorHidden', 'shareHidden', 'prefsHidden', 'hintHidden', 'drawerHidden'
];

/** The models of the editor's data */
const MODELS: Record<string, readonly Record<string, unknown>[]> = {
    'magnetic-editor': [
        ...['appName', 'zoom', 'status', 'focus', 'dataLine', 'inspectorStatus', 'heading', 'detailPath', 'detailValue', 'detailShown', 'detailRead', 'detailWritten', 'shareStatus', 'prefsStatus', 'notice', 'note'].map((field) => ({ op: 'set', field, type: 'string', default: '' })),
        { op: 'set', field: 'size', type: 'string', default: 'desktop' },
        { op: 'set', field: 'tool', type: 'string', default: 'use' },
        { op: 'set', field: 'shareRight', type: 'string', default: 'use' },
        { op: 'set', field: 'mode', type: 'string', default: 'system' },
        { op: 'set', field: 'language', type: 'string', default: 'en' },
        { op: 'set', field: 'crumb', type: 'string', default: '' },
        { op: 'set', field: 'crumbs', type: 'object', default: {} },
        { op: 'set', field: 'tab', type: 'string', default: 'properties' },
        { op: 'set', field: 'model', type: 'string', default: '' },
        { op: 'set', field: 'models', type: 'object', default: {} },
        ...['working', 'blank', 'hasMessages', 'keepOpen', ...HIDDEN_AT_FIRST].map((field) => ({ op: 'set', field, type: 'boolean', default: HIDDEN_AT_FIRST.includes(field) })),
        { op: 'set', field: 'show', type: 'object', default: { theme: false, layout: false, data: false, logic: false, screens: false } }
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

const emit = (target: string, from?: string): Record<string, unknown> => ({ command: 'emit', target, ...(from !== undefined && { from }) });
const button = (title: string, target: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ component: 'button', size: 'sm', variant: 'ghost', _title: title, on: { press: emit(target) }, ...extra });
const icon = (title: string, target: string, name: string, extra: Record<string, unknown> = {}): Record<string, unknown> => button(title, target, { icon: name, iconPosition: 'only', ...extra });
const caption = (text: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ component: 'text', textRole: 'caption', _text: text, ...extra });
const bound = (path: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ component: 'text', '<-_text': path, ...extra });

/** A panel floating over the canvas, at its place on the stage */
function float(placement: Record<string, string>, children: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { component: 'panel', elevation: 'raised', bordered: true, padding: 'sm', placement, layout: { type: 'column', gap: 'sm' }, children, ...extra };
}

/** A row inside a floating panel; a spacer that grows pushes what follows it to the end */
function row(children: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { component: 'panel', padding: 'none', layout: { type: 'row', gap: 'sm', align: 'center' }, children, ...extra };
}
const spacer = (): Record<string, unknown> => ({ component: 'panel', padding: 'none', placement: { grow: 1 }, children: {} });

/** Magnetic's logo, as the frame (which has no network) can show it */
const LOGO = `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString('base64')}`;

/** The corner at the top left: back to the apps, Magnetic's logo, the app's name, the frame size and Open */
function nameCorner(t: Texts): Record<string, unknown> {
    return float({ x: '12px', y: '12px', width: '470px' }, {
        bar: row({
            home: icon(t['shell.allApps'], 'home', 'arrow-left'),
            logo: { component: 'image', src: LOGO, decorative: true, ratio: '1:1', fit: 'contain', placement: { height: '26px' } },
            name: bound(`${E}.appName`, { textRole: 'label', truncate: 1, placement: { grow: 1 } }),
            size: {
                component: 'selectField',
                size: 'sm',
                titlePosition: 'hidden',
                _label: t['shell.frameSize'],
                options: { desktop: { _label: t['shell.size.desktop'] }, tablet: { _label: t['shell.size.tablet'] }, phone: { _label: t['shell.size.phone'] } },
                '<-value': `${E}.size`,
                on: { change: emit('size') }
            },
            open: button(t['shell.open'], 'open')
        })
    });
}

/** The corner at the top right: the person's choices and Share */
function shareCorner(t: Texts): Record<string, unknown> {
    return float({ right: '12px', y: '12px', width: '180px' }, {
        bar: row({
            spacer: spacer(),
            prefs: icon(t['prefs.open'], 'prefs', 'sun-moon'),
            share: { component: 'button', size: 'sm', _title: t['shell.share'], on: { press: emit('share') } }
        })
    });
}

/** The rail at the left: the pointer tools, and what the agent is shown with the next request */
function rail(t: Texts): Record<string, unknown> {
    const show = (name: 'theme' | 'layout' | 'data' | 'logic' | 'screens', target: string): Record<string, unknown> => ({
        component: 'switchField',
        size: 'sm',
        _label: t[`shell.toggle.${name}`],
        '<-checked': `${E}.show.${name}`,
        on: { change: emit(target) }
    });
    return float({ x: '12px', y: '30%', width: '132px' }, {
        tools: {
            component: 'segmented',
            size: 'sm',
            iconOnly: true,
            _label: t['shell.pointer'],
            options: { use: { _label: t['shell.useKey'], icon: 'pointer' }, move: { _label: t['shell.moveKey'], icon: 'hand-stop' }, select: { _label: t['shell.selectKey'], icon: 'marquee-2' } },
            '<-value': `${E}.tool`,
            on: { change: emit('tool') }
        },
        showLabel: caption(t['shell.show']),
        showTheme: show('theme', 'showTheme'),
        showLayout: show('layout', 'showLayout'),
        showData: show('data', 'showData'),
        showLogic: show('logic', 'showLogic'),
        showScreens: show('screens', 'showScreens')
    });
}

/** The zoom at the bottom right */
function zoom(t: Texts): Record<string, unknown> {
    return float({ right: '12px', bottom: '12px', width: '196px' }, {
        bar: row({
            out: icon(t['shell.zoomOutKey'], 'zoomOut', 'minus'),
            reset: { component: 'button', size: 'sm', variant: 'ghost', '<-_title': `${E}.zoom`, on: { press: emit('zoomReset') } },
            in: icon(t['shell.zoomInKey'], 'zoomIn', 'plus'),
            fit: icon(t['shell.fitKey'], 'zoomFit', 'maximize')
        })
    });
}

/** The chat bar at the bottom: what the next request is about, the request, the model and Send */
function chatBar(t: Texts): Record<string, unknown> {
    return float({ x: '30%', bottom: '12px', width: '40%' }, {
        status: bound(`${E}.status`, { textRole: 'caption', '<-hidden': `${E}.noStatus` }),
        focus: row({ about: bound(`${E}.focus`, { textRole: 'caption', placement: { grow: 1 } }), clear: button(t['chat.clear'], 'focusClear') }, { '<-hidden': `${E}.noFocus` }),
        dataLine: bound(`${E}.dataLine`, { textRole: 'caption', '<-hidden': `${E}.noDataLine` }),
        bar: {
            component: 'panel',
            padding: 'none',
            layout: { type: 'row', gap: 'sm', align: 'end' },
            children: {
                chat: icon(t['shell.showChat'], 'chatToggle', 'message'),
                input: {
                    component: 'textareaField',
                    placement: { grow: 1 },
                    _label: t['shell.request'],
                    _placeholder: t['shell.placeholder'],
                    titlePosition: 'hidden',
                    autoGrow: true,
                    rows: 1,
                    sendOnEnter: true,
                    on: { send: [emit('chat.send'), { command: 'clear' }] }
                },
                model: { component: 'selectField', size: 'sm', titlePosition: 'hidden', _label: t['shell.model'], '<-options': `${E}.models`, '<-value': `${E}.model`, '<-hidden': `${E}.noModels`, on: { change: emit('model') } },
                send: { component: 'button', _title: t['shell.send'], icon: 'arrow-up', iconPosition: 'only', on: { press: { command: 'send', target: '^bar.children.input' } } }
            }
        }
    });
}

/** The chat above the bar: the conversation, and the agent's activity while it works */
function chatPanel(t: Texts): Record<string, unknown> {
    return float(
        { x: '30%', bottom: '96px', width: '40%', height: '52%' },
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
        { x: '34%', y: '30%', width: '32%' },
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
            [EDITOR_KEYS.propertyFields]: { component: 'panel', padding: 'none', children: {} },
            remove: { component: 'button', variant: 'soft', tone: 'danger', size: 'sm', '<-hidden': `${E}.cannotRemove`, _title: t['inspector.delete'], on: { press: emit('remove') } }
        }
    };
}

/** The Add tab: find a component by its words or its category, then click where it goes */
function addTab(t: Texts): Record<string, unknown> {
    return {
        component: 'panel',
        placement: { _tab: t['inspector.add'] },
        padding: 'sm',
        layout: { type: 'column', gap: 'sm' },
        children: {
            search: { component: 'searchBox', size: 'sm', _label: t['inspector.find'], _placeholder: t['inspector.find'], value: '', on: { change: emit('search') } },
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
                placement: { height: 'calc(100vh - 360px)' },
                _empty: t['inspector.noMatch'],
                row: { component: 'card', elevation: 'flat', padding: 'sm', interactive: true, '<-_title': '$row.name', '<-_subtitle': '$row.summary', on: { press: emit('place', '$row.name') } }
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

/** The inspector at the right: its title and close button, what it is doing, and its three tabs */
function inspector(t: Texts): Record<string, unknown> {
    return float(
        { right: '12px', y: '64px', bottom: '80px', width: '320px' },
        {
            head: row({
                title: { component: 'text', textRole: 'label', _text: t['shell.inspector'] },
                status: bound(`${E}.inspectorStatus`, { textRole: 'caption', truncate: 1, placement: { grow: 1 } }),
                close: icon(t['shell.closeInspector'], 'inspectorClose', 'x')
            }),
            tabs: { component: 'tabs', '<-active': `${E}.tab`, on: { change: emit('tab') }, children: { properties: propertiesTab(t), add: addTab(t), state: stateTab(t) } }
        },
        { '<-hidden': `${E}.inspectorHidden` }
    );
}

/** Share, under its button: who may do what with a new link, and the links made, each with Copy and Revoke */
function shareSheet(t: Texts): Record<string, unknown> {
    return float(
        { right: '12px', y: '64px', width: '352px' },
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
        { right: '12px', y: '64px', width: '240px' },
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
 * The editor's screen: a stage as big as the window, whose children float over the canvas at their places (the adhoc
 * layout holds each to its edges): the name corner, the Share corner, the rail, the zoom, the chat bar and the chat,
 * the inspector, the two sheets, the blank app's hint and the notice
 */
function editorScreen(t: Texts): Record<string, unknown> {
    return {
        component: 'panel',
        padding: 'none',
        layout: { type: 'column', gap: 'none' },
        children: {
            [EDITOR_KEYS.stage]: {
                component: 'panel',
                padding: 'none',
                placement: { height: 'calc(100vh - 0px)' },
                layout: { type: 'adhoc' },
                children: {
                    nameCorner: nameCorner(t),
                    shareCorner: shareCorner(t),
                    rail: rail(t),
                    zoom: zoom(t),
                    hint: blankHint(t),
                    chat: chatPanel(t),
                    chatBar: chatBar(t),
                    inspector: inspector(t),
                    share: shareSheet(t),
                    prefs: prefsSheet(t),
                    notice: float({ x: '30%', y: '12px', width: '40%' }, { text: bound(`${E}.notice`, { tone: 'danger' }) }, { '<-hidden': `${E}.noNotice` })
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
        paths: { model: 'inspector-path', scope: 'persona' },
        feed: { model: 'inspector-change', scope: 'persona' }
    };
    return { title: t['editor.title'], data, home: editorScreen(t) };
}


/** Changes when Magnetic ships a new editor: a person's editor they never changed is made again from it */
export const EDITOR_STAMP = createHash('sha256').update(JSON.stringify({ MODELS, definition: definition(), texts: ['de', 'fr', 'es'].map((language) => textsOf(language as 'de')) })).digest('hex').slice(0, 16);

/** The editor's assembled document and icons, as a page mounts it */
export interface EditorDocument {
    readonly id: string;
    readonly document: Record<string, unknown>;
    readonly icons: Record<string, string>;
}

/** Writes every field of the models the editor needs, so a workspace with an older editor gets the new fields too */
async function ensureModels(tools: readonly UiToolDefinition[]): Promise<void> {
    for (const [model, operations] of Object.entries(MODELS)) {
        const existing = await run(tools, 'ui_get', { kind: 'models', name: model }).catch(() => undefined);
        const revision = existing === undefined ? undefined : existing['revision'];
        await run(tools, 'ui_model_write', { model, operations, ...(typeof revision === 'number' && { expectedRevision: revision }) });
    }
}

/** Makes the editor app in a workspace, in English with the other languages as locales; answers its id and revision */
async function makeEditor(tools: readonly UiToolDefinition[]): Promise<{ id: string; revision: number }> {
    await ensureModels(tools);
    const made = definition();
    const created = await run(tools, 'ui_app_create', { name: EDITOR_APP, ...made });
    if (typeof created['id'] !== 'string') throw new Error('ui_app_create gave no id');
    const revision = await writeLocales(tools, EDITOR_APP, { home: made['home'] }, typeof created['revision'] === 'number' ? created['revision'] : 1);
    return { id: created['id'], revision };
}

/**
 * Each person's editor: an app in their own workspace (\`magnetic-editor\`), made from Magnetic's the first time they
 * edit, and made again when Magnetic ships a new one, unless they changed theirs (its revision is no longer the one
 * Magnetic left). They can open it in the editor like any app, and reset it to Magnetic's
 */
export class EditorApps {
    constructor(
        private readonly toolsOf: (services: Services) => readonly UiToolDefinition[],
        /** The folder of each user's data, `users/` */
        private readonly usersDir: string
    ) {}

    private stampFile(userId: string): string {
        return join(this.usersDir, userId, 'magnetic', 'editor.json');
    }

    /** The id of a person's editor, making it when they have none, or when Magnetic's changed and theirs did not */
    async id(services: Services, userId: string): Promise<string> {
        const kept = await readJson<{ stamp?: string; revision?: number }>(this.stampFile(userId));
        const existing = (await services.instanceViews.list()).find((app) => app.name === EDITOR_APP);
        if (existing !== undefined) {
            const untouched = kept?.revision === existing.revision;
            if (kept?.stamp === EDITOR_STAMP || !untouched) return existing.id;
        }
        return this.make(services, userId, existing?.revision);
    }

    /** Puts a person's editor back to Magnetic's */
    async reset(services: Services, userId: string): Promise<string> {
        const existing = (await services.instanceViews.list()).find((app) => app.name === EDITOR_APP);
        return this.make(services, userId, existing?.revision);
    }

    private async make(services: Services, userId: string, replacing: number | undefined): Promise<string> {
        const tools = this.toolsOf(services);
        if (replacing !== undefined) await run(tools, 'ui_delete', { kind: 'apps', name: EDITOR_APP, expectedRevision: replacing });
        const made = await makeEditor(tools);
        await writeJsonAtomic(this.stampFile(userId), { stamp: EDITOR_STAMP, revision: made.revision });
        return made.id;
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

/**
 * Magnetic's own editor, in its system workspace: the one a person gets when theirs does not load (`?editor=default`),
 * made once per run of the server
 */
export class DefaultEditor {
    private built: Promise<EditorDocument> | undefined;

    constructor(
        private readonly workspace: () => Promise<{ readonly services: Services; readonly release: () => void }>,
        private readonly toolsOf: (services: Services) => readonly UiToolDefinition[],
        private readonly stampDir: string
    ) {}

    document(): Promise<EditorDocument> {
        if (this.built === undefined) {
            this.built = this.build();
            this.built.catch(() => (this.built = undefined));
        }
        return this.built;
    }

    private async build(): Promise<EditorDocument> {
        const { services, release } = await this.workspace();
        try {
            const tools = this.toolsOf(services);
            const stampFile = join(this.stampDir, 'editor.json');
            const stamp = (await readJson<{ stamp?: string }>(stampFile))?.stamp;
            let existing = (await services.instanceViews.list()).find((app) => app.name === EDITOR_APP);
            if (existing === undefined || stamp !== EDITOR_STAMP) {
                if (existing !== undefined) await run(tools, 'ui_delete', { kind: 'apps', name: EDITOR_APP, expectedRevision: existing.revision });
                await makeEditor(tools);
                await writeJsonAtomic(stampFile, { stamp: EDITOR_STAMP });
                existing = (await services.instanceViews.list()).find((app) => app.name === EDITOR_APP);
            }
            const app = existing === undefined ? undefined : await services.instanceViews.find(existing.id);
            if (app === undefined) throw new Error('The default editor could not be made');
            const message = await services.instanceViews.message(app, 'attach');
            return { id: app.id, document: message.document as Record<string, unknown>, icons: { ...message.icons } };
        } finally {
            release();
        }
    }
}
