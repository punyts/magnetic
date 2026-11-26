import { hiddenBy } from '../pages/own.js';
import { pageSpec } from '../pages/PageSpec.js';
import { textsOf } from '../http/text.js';
import type { PageSpec } from '../pages/PageSpec.js';
import { hearingIds } from '../http/raised.js';
import type { Hearing } from '../http/raised.js';

/** The app name of the Theme view's page, in every workspace that has it */
export const THEME_APP = 'magnetic-theme';

/** The modes the page shows a column and a specimen for: the modes every theme has */
export const THEME_MODES = ['light', 'dark', 'contrast'] as const;

/** The presets a new theme starts from, as `ui_theme_create` takes them */
export const THEME_PRESETS: readonly string[] = ['clean', 'moody', 'playful', 'professional'];

const T = '$.data.theme';

/**
 * What the page script hears of the Theme view (src/http/raised.ts): a token's value cell sends its row with the new
 * value in the field of its column, and the preset is kept as it changes, for Create
 */
export const THEME_HEARING: Hearing = {
    'back.press': { name: 'back' },
    'choose.change': { name: 'choose' },
    'makeDefault.press': { name: 'default' },
    'clone.press': { name: 'clone' },
    'cloneShared.press': { name: 'clone' },
    'remove.press': { name: 'remove' },
    'add.change': { name: 'add' },
    'preset.change': { keep: '$.data.theme.preset' },
    'create.press': { name: 'create', from: '$.data.theme.preset' },
    'editAll.press': { name: 'editAll' },
    ...Object.fromEntries(['all', ...THEME_MODES].map((column) => [`${column}Value.change`, { name: 'token', from: 'row', merge: column }]))
};
const field = (name: string, type: string, value: unknown): Record<string, unknown> => ({ op: 'set', field: name, type, default: value });

/**
 * One token's value for all modes (`all`) or in one mode, edited in place: the value the theme sets there, or empty with
 * the value it shows as the placeholder. A change sends the whole record, its new value in the field of the column. A
 * mode's cell is disabled for a token no mode may set (`modesLocked`), the value for all modes by `locked`
 */
function valueCell(column: string): Record<string, unknown> {
    return {
        component: 'input',
        '<-value': `$row.${column}`,
        '<-_placeholder': `$row.${column}Shown`,
        '<-_label': `$row.${column}Label`,
        '<-disabled': column === 'all' ? '$row.locked' : '$row.modesLocked',
        '@id': `${column}Value`
    };
}

/**
 * The theme in one mode, drawn with its own colours: its surface, border and text, and a button in its accent. The
 * colours are the theme's values, not tokens of the page's own theme
 */
function specimen(mode: string, title: string, text: string, button: string): Record<string, unknown> {
    const at = `${T}.specimens.${mode}`;
    return {
        component: 'drawing',
        viewBox: { x: 0, y: 0, width: 240, height: 120 },
        _title: title,
        children: {
            surface: { component: 'rect', x: 1, y: 1, width: 238, height: 118, radius: 12, '<-fill': `${at}.surface`, '<-stroke': `${at}.border` },
            title: { component: 'drawText', _text: title, x: 16, y: 30, fontSize: 16, '<-fill': `${at}.text` },
            sample: { component: 'drawText', _text: text, x: 16, y: 54, fontSize: 9, '<-fill': `${at}.text` },
            pill: { component: 'rect', x: 16, y: 74, width: 84, height: 28, radius: 14, '<-fill': `${at}.accent` },
            label: { component: 'drawText', _text: button, x: 58, y: 88, anchor: 'middle', baseline: 'middle', fontSize: 11, '<-fill': `${at}.accentOn` }
        }
    };
}

const tool = (title: string, id: string, hidden?: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    component: 'button',
    size: 'sm',
    variant: 'outline',
    _title: title,
    ...(hidden !== undefined && hiddenBy(hidden)),
    ...extra,
    '@id': id
});

/**
 * The Theme view as a page of Magnetic's (docs/design/magnetic-editor-in-page.md, B4b): the app's themes, the chosen one
 * as a specimen per mode above its tokens, each token's value for all modes and in each mode, edited in place. The page
 * script (`views.ts`) drives it through `$.data.theme` and hears it through the ids of its nodes only (`THEME_HEARING`):
 *
 * - It writes `themes` (the app's themes as options, keyed by name), `chosen`, `others` (the workspace's themes the app
 *   does not use, as options), `specimens` (per mode: `surface`, `border`, `text`, `accent`, `accentOn`),
 *   `tokens` (one record per token: `id` its path, `group`, `name`, `all` and each mode's value set by the theme, with
 *   `<column>Shown` and `<column>Label`, `locked` and `modesLocked`: shared, or a token no mode may set), `sharedText` (other apps use the theme), what is
 *   hidden (`noTheme` and `hasTheme`, `notShared`, `noDefault`, `noClone`, `noRemove`, `noOthers`, `noBack`), `status`
 *   (saving, saved) and `refusal` with `noRefusal` (why a change was refused).
 * - It hears `choose` with a theme's name, `token` with a token's record once a value is changed, `editAll` (edit a
 *   shared theme for every app), `clone`, `default`, `remove`, `add` with a theme's name, `create` with the preset
 *   and `back` (to Statenet).
 */
export const THEME: PageSpec = pageSpec({
    record: { path: T, model: THEME_APP },
    name: THEME_APP,
    title: 'Theme',
    themed: true,
    required: hearingIds(THEME_HEARING),
    sample: {
        [T]: {
            themes: { shop: { _label: '★ shop' } },
            chosen: 'shop',
            others: {},
            noOthers: true,
            specimens: Object.fromEntries(THEME_MODES.map((mode) => [mode, mode === 'light' ? { surface: '#ffffff', border: '#d0d0d0', text: '#111111', accent: '#3d5afe', accentOn: '#ffffff' } : { surface: '#15171c', border: '#3a3d45', text: '#f2f2f2', accent: '#8c9eff', accentOn: '#111111' }])),
            tokens: [
                { id: 'color.accent.base', group: 'color', name: 'accent.base', all: '#3d5afe', allShown: '', allLabel: 'color.accent.base', light: '', lightShown: '#3d5afe', lightLabel: 'color.accent.base light', dark: '#8c9eff', darkShown: '', darkLabel: 'color.accent.base dark', contrast: '', contrastShown: '#0000ee', contrastLabel: 'color.accent.base contrast', locked: false, modesLocked: false }
            ]
        }
    },
    models: {
        [THEME_APP]: [
            field('themes', 'object', {}),
            field('chosen', 'string', ''),
            field('others', 'object', {}),
            field('adding', 'string', ''),
            field('preset', 'string', THEME_PRESETS[0]),
            field('specimens', 'object', Object.fromEntries(THEME_MODES.map((mode) => [mode, { surface: '#ffffff', border: '#d0d0d0', text: '#111111', accent: '#3d5afe', accentOn: '#ffffff' }]))),
            field('tokens', 'array', []),
            field('notShared', 'boolean', true),
            field('sharedText', 'string', ''),
            field('noTheme', 'boolean', false),
            field('hasTheme', 'boolean', true),
            field('noDefault', 'boolean', true),
            field('noClone', 'boolean', true),
            field('noRemove', 'boolean', true),
            field('noOthers', 'boolean', true),
            field('status', 'string', ''),
            field('refusal', 'string', ''),
            field('noRefusal', 'boolean', true),
            field('noBack', 'boolean', true)
        ]
    },
    definition: () => {
        const t = textsOf('en');
        const modeTitle = (mode: string): string => t[`views.mode.${mode}` as 'views.mode.light'];
        return {
            title: t['shell.view.theme'],
            data: { theme: { model: THEME_APP, scope: 'person' } },
            home: {
                component: 'panel',
                elevation: 'raised',
                padding: 'md',
                layout: { type: 'column', gap: 'md' },
                children: {
                    head: {
                        component: 'panel',
                        padding: 'none',
                        layout: { type: 'row', gap: 'sm', align: 'end', wrap: true },
                        children: {
                            back: tool(t['views.backToGraph'], 'back', `${T}.noBack`),
                            choose: {
                                component: 'selectField',
                                _label: t['shell.view.theme'],
                                width: 24,
                                size: 'sm',
                                '<-options': `${T}.themes`,
                                '<-value': `${T}.chosen`,
                                'own:hidden': `${T}.noTheme`,
                                '@id': 'choose'
                            },
                            makeDefault: tool(t['views.makeDefault'], 'makeDefault', `${T}.noDefault`),
                            clone: tool(t['views.cloneForApp'], 'clone', `${T}.noClone`),
                            remove: tool(t['views.removeTheme'], 'remove', `${T}.noRemove`, { tone: 'danger' }),
                            add: {
                                component: 'selectField',
                                _label: t['views.addTheme'],
                                width: 22,
                                size: 'sm',
                                '<-options': `${T}.others`,
                                '<-value': `${T}.adding`,
                                'own:hidden': `${T}.noOthers`,
                                '@id': 'add'
                            },
                            preset: {
                                component: 'selectField',
                                _label: t['views.preset'],
                                width: 16,
                                size: 'sm',
                                options: Object.fromEntries(THEME_PRESETS.map((name) => [name, { _label: t[`views.preset.${name}` as 'views.preset.clean'] }])),
                                '<-value': `${T}.preset`,
                                '@id': 'preset'
                            },
                            create: tool(t['views.newTheme'], 'create'),
                            status: { component: 'text', textRole: 'caption', muted: true, placement: { grow: 1 }, align: 'end', '<-_text': `${T}.status` }
                        }
                    },
                    refused: { component: 'alert', tone: 'danger', '<-_text': `${T}.refusal`, 'own:hidden': `${T}.noRefusal` },
                    none: { component: 'text', muted: true, _text: t['views.noTheme'], 'own:hidden': `${T}.hasTheme` },
                    shared: {
                        component: 'alert',
                        tone: 'info',
                        '<-_text': `${T}.sharedText`,
                        'own:hidden': `${T}.notShared`,
                        actions: {
                            component: 'panel',
                            padding: 'none',
                            layout: { type: 'row', gap: 'sm' },
                            children: {
                                editAll: tool(t['views.editForAll'], 'editAll'),
                                cloneShared: tool(t['views.cloneForApp'], 'cloneShared')
                            }
                        }
                    },
                    specimens: {
                        component: 'panel',
                        padding: 'none',
                        'own:hidden': `${T}.noTheme`,
                        layout: { type: 'grid', cols: 3, gap: 'md', collapseBelow: 'md' },
                        children: Object.fromEntries(THEME_MODES.map((mode) => [mode, specimen(mode, modeTitle(mode), t['views.specimenText'], t['views.specimenButton'])]))
                    },
                    tokens: {
                        component: 'table',
                        _empty: t['views.noTheme'],
                        placement: { height: '480px' },
                        'own:hidden': `${T}.noTheme`,
                        '<-items': `${T}.tokens`,
                        columns: {
                            group: { _title: '', field: 'group', width: '100px' },
                            name: { _title: t['views.token'], field: 'name', width: '2fr' },
                            all: { _title: t['views.allModes'], width: '1fr', cell: valueCell('all') },
                            ...Object.fromEntries(THEME_MODES.map((mode) => [mode, { _title: modeTitle(mode), width: '1fr', cell: valueCell(mode) }]))
                        }
                    }
                }
            }
        };
    }
});
