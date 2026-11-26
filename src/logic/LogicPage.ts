import { textsOf } from '../http/text.js';
import type { PageSpec } from '../pages/PageSpec.js';
import { hearingIds } from '../http/raised.js';
import type { Hearing } from '../http/raised.js';

/** The app name of the Logic view's page, in every workspace that has it */
export const LOGIC_APP = 'magnetic-logic';

/** The groups of a logic module's units and the kind of unit each holds, in the order New offers them */
export const UNIT_GROUPS = { machines: 'machine', rules: 'rule', tables: 'table', computes: 'compute', effects: 'effect' } as const;

/** The groups of a logic module's units */
export const LOGIC_GROUPS: readonly string[] = Object.keys(UNIT_GROUPS);

/** Where a unit runs: the lanes, in the order they show */
export const LANES = ['server', 'browser'] as const;

const L = '$.data.logic';

/** What the page script hears of the Logic view (src/http/raised.ts): the kind of unit is kept as it changes, for New */
export const LOGIC_HEARING: Hearing = {
    'unit.press': { name: 'open', from: 'row.id' },
    'toServer.press': { name: 'move', from: 'row.id' },
    'toBrowser.press': { name: 'move', from: 'row.id' },
    'deleteUnit.press': { name: 'delete', from: 'row.id' },
    'lanes.move': { name: 'move' },
    'back.press': { name: 'back' },
    'group.change': { keep: '$.data.logic.group' },
    'create.press': { name: 'create', from: '$.data.logic.group' }
};
const field = (name: string, type: string, value: unknown): Record<string, unknown> => ({ op: 'set', field: name, type, default: value });

const action = (icon: string, title: string, hidden: string, id: string, tone?: string): Record<string, unknown> => ({
    component: 'button',
    icon,
    iconPosition: 'only',
    size: 'sm',
    variant: 'ghost',
    _title: title,
    '<-hidden': hidden,
    ...(tone !== undefined && { tone }),
    '@id': id
});

/**
 * One unit's card in its lane, drawn for each record of `units`: its name as the card's title, its kind, what it does in a
 * line and the paths it reads and writes. Pressing it opens it; its buttons move it to the other lane and delete it. They
 * sit in the card's row itself, since a panel that does not grow sizes to nothing there. A unit from a logic module the
 * app uses has neither (`fixed`); one that must stay on the server cannot go to the browser
 */
function unitCard(t: ReturnType<typeof textsOf>): Record<string, unknown> {
    return {
        component: 'card',
        interactive: true,
        padding: 'sm',
        '<-selected': '$row.chosen',
        '<-_title': '$row.title',
        layout: { type: 'row', gap: 'sm', align: 'start' },
        '@id': 'unit',
        children: {
            body: {
                component: 'panel',
                padding: 'none',
                placement: { grow: 1 },
                layout: { type: 'column', gap: 'none' },
                children: {
                    kind: { component: 'text', textRole: 'caption', tone: 'accent', caps: true, '<-_text': '$row.kind' },
                    does: { component: 'text', textRole: 'caption', truncate: 1, '<-_text': '$row.does' },
                    paths: { component: 'text', textRole: 'caption', muted: true, truncate: 1, '<-_text': '$row.paths' }
                }
            },
            toServer: action('chevron-left', t['views.moveToServer'], '$row.noServer', 'toServer'),
            toBrowser: action('chevron-right', t['views.moveToBrowser'], '$row.noBrowser', 'toBrowser'),
            delete: action('trash', t['views.delete'], '$row.fixed', 'deleteUnit', 'danger')
        }
    };
}

/**
 * The Logic view as a page of Magnetic's (docs/design/magnetic-editor-in-page.md, B4b): the app's units in two lanes,
 * Server and Browser, and the screens' handlers below. The page script (`views.ts`) drives it through `$.data.logic` and
 * hears it through the ids of its nodes only (`LOGIC_HEARING`):
 *
 * - It writes `units` (one record per unit: `id` its group and name, `runs` its lane, `order` its place in the lane,
 *   `kind`, `title`, `does`, `paths`, `chosen`, `fixed`, `noServer` and `noBrowser`), `handlers` (one record per
 *   handler: `id`, `screen` and `does`), `hasUnits`, `noHandlers`, `status`, `refusal` with `noRefusal`, and `noBack`.
 * - It hears `open` with a unit's id, `move` with a unit's id (its button: to the other lane) or with the board's
 *   `{ key, from, to, index }` (a card dragged to a lane), `delete` with a unit's id, `create` with the group of the new
 *   unit, and `back` (to Statenet).
 */
export const LOGIC: PageSpec = {
    name: LOGIC_APP,
    title: 'Logic',
    themed: true,
    required: hearingIds(LOGIC_HEARING),
    sample: {
        [L]: {
            units: [
                { id: 'machines.checkout', runs: 'server', order: 1, kind: 'Machine', title: 'checkout', does: 'idle → paying when $.data.cart.pay', paths: 'reads $.data.cart', chosen: false, fixed: false, noServer: true, noBrowser: true },
                { id: 'rules.total', runs: 'browser', order: 1, kind: 'Rule', title: 'total', does: 'when $.data.cart.items → set', paths: 'writes $.data.cart.total', chosen: false, fixed: false, noServer: false, noBrowser: true }
            ],
            handlers: [{ id: 'h1', screen: 'cart', does: '.pay · press → set $.data.cart.paying' }],
            hasUnits: true,
            noHandlers: false
        }
    },
    models: {
        [LOGIC_APP]: [
            field('units', 'array', []),
            field('handlers', 'array', []),
            field('group', 'string', 'rules'),
            field('hasUnits', 'boolean', true),
            field('noHandlers', 'boolean', true),
            field('status', 'string', ''),
            field('refusal', 'string', ''),
            field('noRefusal', 'boolean', true),
            field('noBack', 'boolean', true)
        ]
    },
    definition: () => {
        const t = textsOf('en');
        return {
            title: t['shell.view.logic'],
            data: { logic: { model: LOGIC_APP, scope: 'person' } },
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
                            back: { component: 'button', size: 'sm', variant: 'outline', _title: t['views.backToGraph'], '<-hidden': `${L}.noBack`, '@id': 'back' },
                            group: {
                                component: 'selectField',
                                _label: t['views.unitKind'],
                                width: 18,
                                size: 'sm',
                                options: Object.fromEntries(Object.entries(UNIT_GROUPS).map(([group, kind]) => [group, { _label: t[`views.unit.${kind}`] }])),
                                '<-value': `${L}.group`,
                                '@id': 'group'
                            },
                            create: { component: 'button', size: 'sm', icon: 'plus', _title: t['views.newUnit'], '@id': 'create' },
                            status: { component: 'text', textRole: 'caption', muted: true, placement: { grow: 1 }, align: 'end', '<-_text': `${L}.status` }
                        }
                    },
                    refused: { component: 'alert', tone: 'danger', '<-_text': `${L}.refusal`, '<-hidden': `${L}.noRefusal` },
                    none: { component: 'text', muted: true, _text: t['views.noUnits'], '<-hidden': `${L}.hasUnits` },
                    notes: {
                        component: 'panel',
                        padding: 'none',
                        layout: { type: 'row', gap: 'md' },
                        children: {
                            server: { component: 'text', textRole: 'caption', muted: true, placement: { grow: 1 }, _text: t['views.lane.server'] },
                            browser: { component: 'text', textRole: 'caption', muted: true, placement: { grow: 1 }, _text: t['views.lane.browser'] }
                        }
                    },
                    lanes: {
                        component: 'board',
                        columnField: 'runs',
                        orderField: 'order',
                        labelField: 'title',
                        cardHeight: 'lg',
                        theme: { board: { column: '440px', height: '420px' } },
                        columns: Object.fromEntries(LANES.map((lane) => [lane, { _title: t[`views.runs.${lane}`] }])),
                        '<-records': `${L}.units`,
                        card: unitCard(t),
                        '@id': 'lanes'
                    },
                    handlersTitle: { component: 'text', textRole: 'label', _text: t['views.handlers'], '<-hidden': `${L}.noHandlers` },
                    handlersNote: { component: 'text', textRole: 'caption', muted: true, _text: t['views.handlersNote'], '<-hidden': `${L}.noHandlers` },
                    handlers: {
                        component: 'list',
                        divided: true,
                        placement: { height: '160px' },
                        '<-hidden': `${L}.noHandlers`,
                        '<-items': `${L}.handlers`,
                        row: {
                            component: 'panel',
                            padding: 'none',
                            layout: { type: 'row', gap: 'sm', align: 'center' },
                            children: {
                                screen: { component: 'text', textRole: 'label', '<-_text': '$row.screen' },
                                does: { component: 'text', truncate: 1, placement: { grow: 1 }, '<-_text': '$row.does' }
                            }
                        }
                    }
                }
            }
        };
    }
};
