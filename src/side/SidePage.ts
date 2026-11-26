import { hiddenBy } from '../pages/own.js';
import { pageSpec } from '../pages/PageSpec.js';
import { textsOf } from '../http/text.js';
import type { PageSpec } from '../pages/PageSpec.js';
import { hearingIds } from '../http/raised.js';
import type { Hearing } from '../http/raised.js';

/** The app name of the side panel's page, in every workspace that has it */
export const SIDE_APP = 'magnetic-side';

/** The types a model's field takes, as `ui_model_write` takes them */
export const FIELD_TYPES: readonly string[] = ['string', 'number', 'integer', 'boolean', 'array', 'object', 'any', 'url'];

/** The methods an endpoint of a connection takes */
export const METHODS: readonly string[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const S = '$.data.side';

/**
 * What the page script hears of the side panel (src/http/raised.ts). The fields it reads when a button is pressed are
 * kept as they change: the base URL, the secret, the code and the form's name, choice and second line; a record's value
 * in the form comes with its row (`recordValue`)
 */
export const SIDE_HEARING: Hearing = {
    'close.press': { name: 'close' },
    'openApp.press': { name: 'openApp' },
    'openLogic.press': { name: 'openLogic' },
    'editTheme.press': { name: 'editTheme' },
    'makeDefault.press': { name: 'makeDefault' },
    'removeTheme.press': { name: 'removeTheme' },
    'use.press': { name: 'use' },
    'openConnections.press': { name: 'openConnections' },
    'link.press': { name: 'link', from: 'row.id' },
    'code.change': { name: 'code', keep: '$.data.side.code' },
    'save.press': { name: 'save', from: '$.data.side.code' },
    'delete.press': { name: 'delete' },
    'cell.change': { name: 'cell', from: 'row', merge: 'value' },
    'removeRecord.press': { name: 'removeRecord', from: 'row.key' },
    'fieldType.change': { name: 'fieldType', from: 'row', merge: 'type' },
    'removeField.press': { name: 'removeField', from: 'row.name' },
    'baseUrl.change': { keep: '$.data.side.baseUrl' },
    'saveUrl.press': { name: 'baseUrl', from: '$.data.side.baseUrl' },
    'secret.change': { keep: '$.data.side.secret' },
    'keep.press': { name: 'secret', from: '$.data.side.secret' },
    'connect.press': { name: 'connect' },
    'try.press': { name: 'try', from: 'row.endpoint' },
    'removeEndpoint.press': { name: 'removeEndpoint', from: 'row.endpoint' },
    'name.change': { keep: '$.data.side.form.name' },
    'choice.change': { name: 'choose', keep: '$.data.side.form.choice', from: '$.data.side.form.choice' },
    'second.change': { keep: '$.data.side.form.second' },
    'recordValue.input': { name: 'recordValue', from: 'row', merge: 'value' },
    'recordValue.change': { name: 'recordValue', from: 'row', merge: 'value' },
    'submit.press': { name: 'submit', from: '$.data.side.form' }
};
const field = (name: string, type: string, value: unknown): Record<string, unknown> => ({ op: 'set', field: name, type, default: value });
const options = (values: readonly string[]): Record<string, { _label: string }> => Object.fromEntries(values.map((value) => [value, { _label: value }]));
const row = (children: Record<string, unknown>, hidden?: string): Record<string, unknown> => ({
    component: 'panel',
    padding: 'none',
    layout: { type: 'row', gap: 'sm', align: 'end', wrap: true },
    ...(hidden !== undefined && hiddenBy(hidden)),
    children
});
const column = (children: Record<string, unknown>, hidden?: string): Record<string, unknown> => ({
    component: 'panel',
    padding: 'none',
    layout: { type: 'column', gap: 'sm' },
    ...(hidden !== undefined && hiddenBy(hidden)),
    children
});
const act = (title: string, id: string, hidden: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    component: 'button',
    size: 'sm',
    variant: 'outline',
    _title: title,
    ...hiddenBy(hidden),
    ...extra,
    '@id': id
});
const remove = (title: string, id: string, hidden: string): Record<string, unknown> => ({
    component: 'button',
    icon: 'x',
    iconPosition: 'only',
    size: 'sm',
    variant: 'ghost',
    tone: 'danger',
    '<-_title': title,
    ...hiddenBy(hidden),
    '@id': id
});
const note = (text: string, hidden: string): Record<string, unknown> => ({ component: 'text', textRole: 'caption', muted: true, '<-_text': text, ...hiddenBy(hidden) });

/** Everything the panel shows, hidden: what the page script writes before it shows one kind of part */
export const SIDE_BLANK: Readonly<Record<string, unknown>> = {
    title: '',
    note: '',
    detail: '',
    path: '',
    noNote: true,
    noDetail: true,
    noPath: true,
    noNotes: true,
    noActions: true,
    noOpenApp: true,
    noOpenLogic: true,
    noEditTheme: true,
    noMakeDefault: true,
    noRemoveTheme: true,
    noUse: true,
    noOpenConnections: true,
    links: [],
    linksTitle: '',
    noLinks: true,
    form: { name: '', choice: '', second: '', record: [] },
    formNote: '',
    nameLabel: '',
    choiceLabel: '',
    secondLabel: '',
    choices: {},
    submitText: '',
    noForm: true,
    noName: true,
    noChoice: true,
    noSecond: true,
    noRecord: true,
    code: '',
    codeLabel: '',
    noCode: true,
    noSave: true,
    noDelete: true,
    inputs: '',
    outputs: '',
    noInputs: true,
    noOutputs: true,
    records: [],
    noRecords: true,
    more: '',
    noMore: true,
    fields: [],
    noFields: true,
    baseUrl: '',
    secret: '',
    noManage: true,
    noSecret: true,
    noConnect: true,
    endpoints: [],
    noEndpoints: true,
    tried: '',
    noTried: true
};

/**
 * The side panel as a page of Magnetic's (docs/design/magnetic-editor-in-page.md, B4c): what Statenet opens beside a
 * card and the Logic view opens for a unit. One panel of sections, each shown when the part has it; the page script
 * (`views.ts`) writes `$.data.side` (the blank first, `SIDE_BLANK`, then the part's own) and hears it through the ids
 * of its nodes (`SIDE_HEARING`), named here as the script acts on them:
 *
 * - The head: `title` and a Close (`close`). Notes: `note`, `detail` and `path`.
 * - Buttons: Open this app (`openApp`), Open in the Logic view (`openLogic`), Edit in the Theme view (`editTheme`), Make
 *   it the default (`makeDefault`), Remove from the app (`removeTheme`), Use in this app (`use`), Open Connections
 *   (`openConnections`).
 * - `links` under `linksTitle`: one record per screen or function (`id`, `label`), pressed to show it (`link` with its id).
 * - A form (`form`: `name`, `choice` among `choices`, `second`, and `record`, one record per field of a new record:
 *   `id`, `label`, `value`), sent with its button (`submit` with the form); a new choice is `choose`.
 * - Code (`code`, `codeLabel`): edited JSON, sent with Save (`save`) and kept as it changes (`code`); Delete (`delete`).
 *   A function's `inputs` and `outputs` schemas.
 * - A dataset's `records`, one record per field of a record (`id`, `key`, `keyShown`, `field`, `value`, `label`,
 *   `noRemove`, `removeText`): a value changed sends the record (`cell`), Remove its key (`removeRecord`).
 * - A model's `fields` (`id`, `name`, `type`, `removeText`): a type changed sends the record (`fieldType`), Remove its
 *   name (`removeField`).
 * - A connection: `baseUrl` (`baseUrl`), a new `secret` (`secret`), Connect (`connect`), its `endpoints` (`id`, `name`, `endpoint`,
 *   `does`, `removeText`) with Try (`try`) and Remove (`removeEndpoint`), and what a try answered (`tried`).
 */
export const SIDE: PageSpec = pageSpec({
    record: { path: S, model: SIDE_APP },
    name: SIDE_APP,
    title: 'Side panel',
    themed: true,
    required: hearingIds(SIDE_HEARING),
    sample: {
        [S]: {
            ...SIDE_BLANK,
            title: 'stock',
            note: 'Records of the model item',
            noNote: false,
            records: [
                { id: 'bolt/name', key: 'bolt', keyShown: 'bolt', field: 'name', value: 'Bolt', label: 'bolt name', noRemove: false, removeText: 'Remove bolt' },
                { id: 'bolt/count', key: 'bolt', keyShown: '', field: 'count', value: '12', label: 'bolt count', noRemove: true, removeText: '' }
            ],
            noRecords: false,
            form: { name: '', choice: '', second: '', record: [{ id: 'name', label: 'name', value: '' }, { id: 'count', label: 'count', value: '' }] },
            noForm: false,
            noRecord: false,
            formNote: 'New record',
            submitText: 'Add'
        }
    },
    models: {
        [SIDE_APP]: Object.entries(SIDE_BLANK).map(([name, value]) => field(name, Array.isArray(value) ? 'array' : typeof value === 'object' ? 'object' : typeof value, value))
    },
    definition: () => {
        const t = textsOf('en');
        return {
            title: 'Side panel',
            data: { side: { model: SIDE_APP, scope: 'person' } },
            home: {
                component: 'panel',
                elevation: 'raised',
                padding: 'md',
                layout: { type: 'column', gap: 'md' },
                children: {
                    head: {
                        component: 'panel',
                        padding: 'none',
                        layout: { type: 'row', gap: 'sm', align: 'start' },
                        children: {
                            title: { component: 'text', textRole: 'heading', element: 'h3', placement: { grow: 1 }, '<-_text': `${S}.title` },
                            close: { component: 'button', icon: 'x', iconPosition: 'only', size: 'sm', variant: 'ghost', _title: t['views.close'], '@id': 'close' }
                        }
                    },
                    notes: column({
                        note: note(`${S}.note`, `${S}.noNote`),
                        detail: { component: 'text', '<-_text': `${S}.detail`, 'own:hidden': `${S}.noDetail` },
                        path: note(`${S}.path`, `${S}.noPath`)
                    }, `${S}.noNotes`),
                    actions: row({
                        openApp: act(t['views.openApp'], 'openApp', `${S}.noOpenApp`, { variant: 'solid' }),
                        openLogic: act(t['views.openLogic'], 'openLogic', `${S}.noOpenLogic`, { variant: 'solid' }),
                        editTheme: act(t['views.editTheme'], 'editTheme', `${S}.noEditTheme`, { variant: 'solid' }),
                        makeDefault: act(t['views.makeDefault'], 'makeDefault', `${S}.noMakeDefault`),
                        removeTheme: act(t['views.removeTheme'], 'removeTheme', `${S}.noRemoveTheme`, { tone: 'danger' }),
                        use: act(t['views.useInApp'], 'use', `${S}.noUse`, { variant: 'solid' }),
                        openConnections: act(t['views.openConnections'], 'openConnections', `${S}.noOpenConnections`, { variant: 'solid' })
                    }, `${S}.noActions`),
                    linksPart: column({
                        linksTitle: { component: 'text', textRole: 'label', element: 'h4', '<-_text': `${S}.linksTitle` },
                        links: {
                            component: 'list',
                            rowHeight: 'sm',
                            divided: true,
                            placement: { height: '160px' },
                            '<-items': `${S}.links`,
                            row: { component: 'button', size: 'sm', variant: 'ghost', '<-_title': '$row.label', '@id': 'link' }
                        }
                    }, `${S}.noLinks`),
                    codePart: column({
                        code: { component: 'textarea', rows: 12, '<-_label': `${S}.codeLabel`, '<-value': `${S}.code`, '@id': 'code' },
                        buttons: row({
                            save: act(t['views.save'], 'save', `${S}.noSave`, { variant: 'solid' }),
                            delete: act(t['views.delete'], 'delete', `${S}.noDelete`, { tone: 'danger' })
                        })
                    }, `${S}.noCode`),
                    inputsTitle: { component: 'text', textRole: 'label', element: 'h4', _text: t['views.fn.inputs'], 'own:hidden': `${S}.noInputs` },
                    inputs: { component: 'codeBlock', language: 'json', size: 'sm', wrap: true, '<-code': `${S}.inputs`, 'own:hidden': `${S}.noInputs` },
                    outputsTitle: { component: 'text', textRole: 'label', element: 'h4', _text: t['views.fn.outputs'], 'own:hidden': `${S}.noOutputs` },
                    outputs: { component: 'codeBlock', language: 'json', size: 'sm', wrap: true, '<-code': `${S}.outputs`, 'own:hidden': `${S}.noOutputs` },
                    records: {
                        component: 'table',
                        density: 'compact',
                        placement: { height: '280px' },
                        '<-items': `${S}.records`,
                        'own:hidden': `${S}.noRecords`,
                        columns: {
                            key: { _title: t['views.kind.record'], field: 'keyShown', width: '80px' },
                            field: { _title: t['views.kind.field'], field: 'field', width: '90px' },
                            value: { _title: t['views.value'], width: '1fr', cell: { component: 'input', size: 'sm', '<-value': '$row.value', '<-_label': '$row.label', '@id': 'cell' } },
                            remove: { _title: '', width: '40px', cell: remove('$row.removeText', 'removeRecord', '$row.noRemove') }
                        }
                    },
                    more: note(`${S}.more`, `${S}.noMore`),
                    fields: {
                        component: 'list',
                        rowHeight: 'lg',
                        divided: true,
                        placement: { height: '240px' },
                        '<-items': `${S}.fields`,
                        'own:hidden': `${S}.noFields`,
                        row: {
                            component: 'panel',
                            padding: 'none',
                            layout: { type: 'row', gap: 'sm', align: 'end' },
                            children: {
                                type: { component: 'selectField', size: 'sm', width: 16, options: options(FIELD_TYPES), '<-_label': '$row.name', '<-value': '$row.type', '@id': 'fieldType' },
                                remove: remove('$row.removeText', 'removeField', '$row.noRemove')
                            }
                        }
                    },
                    connection: column({
                        baseUrlRow: row({
                            baseUrl: { component: 'textField', _label: t['views.baseUrl'], placement: { grow: 1 }, '<-value': `${S}.baseUrl`, '@id': 'baseUrl' },
                            saveUrl: act(t['views.save'], 'saveUrl', `${S}.noManage`)
                        }),
                        secretRow: row({
                            secret: { component: 'textField', inputType: 'password', _label: t['views.newSecret'], placement: { grow: 1 }, '<-value': `${S}.secret`, '@id': 'secret' },
                            keep: act(t['views.keep'], 'keep', `${S}.noSecret`)
                        }, `${S}.noSecret`),
                        connect: act(t['views.connect'], 'connect', `${S}.noConnect`)
                    }, `${S}.noManage`),
                    endpointsPart: column({
                        endpointsTitle: { component: 'text', textRole: 'label', element: 'h4', _text: t['views.endpoints'] },
                        endpoints: {
                            component: 'table',
                            density: 'compact',
                            placement: { height: '200px' },
                            '<-items': `${S}.endpoints`,
                            columns: {
                                name: { _title: t['views.endpointName'], field: 'name', width: '1fr' },
                                does: { _title: t['views.endpointPath'], field: 'does', width: '2fr' },
                                try: { _title: '', width: '64px', cell: act(t['views.try'], 'try', '$row.noManage', { variant: 'ghost' }) },
                                remove: { _title: '', width: '40px', cell: remove('$row.removeText', 'removeEndpoint', '$row.noManage') }
                            }
                        },
                        tried: { component: 'codeBlock', size: 'sm', wrap: true, '<-code': `${S}.tried`, 'own:hidden': `${S}.noTried` }
                    }, `${S}.noEndpoints`),
                    form: column({
                        formNote: { component: 'text', textRole: 'label', '<-_text': `${S}.formNote` },
                        name: { component: 'textField', '<-_label': `${S}.nameLabel`, '<-value': `${S}.form.name`, 'own:hidden': `${S}.noName`, '@id': 'name' },
                        choice: { component: 'selectField', '<-_label': `${S}.choiceLabel`, '<-options': `${S}.choices`, '<-value': `${S}.form.choice`, 'own:hidden': `${S}.noChoice`, '@id': 'choice' },
                        second: { component: 'textField', '<-_label': `${S}.secondLabel`, '<-value': `${S}.form.second`, 'own:hidden': `${S}.noSecond`, '@id': 'second' },
                        record: {
                            component: 'list',
                            rowHeight: 'md',
                            placement: { height: '200px' },
                            '<-items': `${S}.form.record`,
                            'own:hidden': `${S}.noRecord`,
                            row: {
                                component: 'panel',
                                padding: 'none',
                                layout: { type: 'row', gap: 'sm', align: 'center' },
                                children: {
                                    label: { component: 'text', textRole: 'caption', truncate: 1, '<-_text': '$row.label' },
                                    value: { component: 'input', size: 'sm', placement: { grow: 1 }, '<-value': '$row.value', '<-_label': '$row.label', '@id': 'recordValue' }
                                }
                            }
                        },
                        submit: { component: 'button', size: 'sm', variant: 'solid', '<-_title': `${S}.submitText`, '@id': 'submit' }
                    }, `${S}.noForm`)
                }
            }
        };
    }
});
