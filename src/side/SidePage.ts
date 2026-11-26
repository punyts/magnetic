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

/**
 * The side panel's data by namespace, each with every section hidden: one record at `$.data.<namespace>` with a model
 * of its own (`magnetic-side-<namespace>`), named for the part of the panel its fields are about. A field's name is
 * unique across the namespaces, so the page script names a field alone and `SIDE_FIELDS` says where it is
 */
export const SIDE_RECORDS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
    // The part shown: its title, its notes, and which of the things to do with it are offered
    part: {
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
        noOpenConnections: true
    },
    // The screens or functions of the part, each pressed to show it
    links: { links: [], linksTitle: '', noLinks: true },
    // The form that adds something: what is typed (`form`), its labels and choices, and its button
    form: {
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
        noRecord: true
    },
    // JSON to edit, and a function's schemas
    code: { code: '', codeLabel: '', noCode: true, noSave: true, noDelete: true, inputs: '', outputs: '', noInputs: true, noOutputs: true },
    // A dataset's records, and the line under them: that there are more, or what a function is
    dataset: { records: [], noRecords: true, more: '', noMore: true },
    // A model's fields
    model: { fields: [], noFields: true },
    // A connection: its base URL, a new secret, its endpoints and what a try answered
    connection: { baseUrl: '', secret: '', noManage: true, noSecret: true, noConnect: true, endpoints: [], noEndpoints: true, tried: '', noTried: true }
};

/** The model of a namespace of the side panel's data */
const modelOf = (namespace: string): string => `${SIDE_APP}-${namespace}`;

/**
 * Where each field the page script names is: a field of the panel's data to its data path (`title` to
 * `$.data.part.title`), made from the records. The script (src/http/views.ts, `sideWrite`) keeps the field names
 * and writes each at its path here
 */
export const SIDE_FIELDS: Readonly<Record<string, string>> = (() => {
    const paths: Record<string, string> = {};
    for (const [namespace, blank] of Object.entries(SIDE_RECORDS)) {
        for (const name of Object.keys(blank)) {
            if (paths[name] !== undefined) throw new Error(`The side panel's field ${name} is in two namespaces`);
            paths[name] = `$.data.${namespace}.${name}`;
        }
    }
    return paths;
})();

/** The data path of a field of the side panel, or of a part of one (`form.name`) */
function s(field: string): string {
    const [name, ...rest] = field.split('.');
    const path = SIDE_FIELDS[name as string];
    if (path === undefined) throw new Error(`The side panel has no field ${String(name)}`);
    return [path, ...rest].join('.');
}

/** Everything the panel shows, hidden, by field: what the page script writes before it shows one kind of part */
export const SIDE_BLANK: Readonly<Record<string, unknown>> = Object.assign({}, ...Object.values(SIDE_RECORDS)) as Record<string, unknown>;

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
    'code.change': { name: 'code', keep: s('code') },
    'save.press': { name: 'save', from: s('code') },
    'delete.press': { name: 'delete' },
    'cell.change': { name: 'cell', from: 'row', merge: 'value' },
    'removeRecord.press': { name: 'removeRecord', from: 'row.key' },
    'fieldType.change': { name: 'fieldType', from: 'row', merge: 'type' },
    'removeField.press': { name: 'removeField', from: 'row.name' },
    'baseUrl.change': { keep: s('baseUrl') },
    'saveUrl.press': { name: 'baseUrl', from: s('baseUrl') },
    'secret.change': { keep: s('secret') },
    'keep.press': { name: 'secret', from: s('secret') },
    'connect.press': { name: 'connect' },
    'try.press': { name: 'try', from: 'row.endpoint' },
    'removeEndpoint.press': { name: 'removeEndpoint', from: 'row.endpoint' },
    'name.change': { keep: s('form.name') },
    'choice.change': { name: 'choose', keep: s('form.choice'), from: s('form.choice') },
    'second.change': { keep: s('form.second') },
    'recordValue.input': { name: 'recordValue', from: 'row', merge: 'value' },
    'recordValue.change': { name: 'recordValue', from: 'row', merge: 'value' },
    'submit.press': { name: 'submit', from: s('form') }
};
/**
 * The side panel as a page of Magnetic's (docs/design/magnetic-editor-in-page.md, B4c): what Statenet opens beside a
 * card and the Logic view opens for a unit. One panel of sections, each shown when the part has it; the page script
 * (`views.ts`) writes its data, a record for each part of the panel (`SIDE_RECORDS`: the blank first, `SIDE_BLANK`, then
 * the part's own, each field at its path in `SIDE_FIELDS`), and hears it through the ids
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
    records: Object.keys(SIDE_RECORDS).map((namespace) => ({ path: `$.data.${namespace}`, model: modelOf(namespace) })),
    name: SIDE_APP,
    title: 'Side panel',
    themed: true,
    required: hearingIds(SIDE_HEARING),
    sample: {
        '$.data.part': { ...SIDE_RECORDS['part'], title: 'stock', note: 'Records of the model item', noNote: false },
        '$.data.dataset': {
            ...SIDE_RECORDS['dataset'],
            records: [
                { id: 'bolt/name', key: 'bolt', keyShown: 'bolt', field: 'name', value: 'Bolt', label: 'bolt name', noRemove: false, removeText: 'Remove bolt' },
                { id: 'bolt/count', key: 'bolt', keyShown: '', field: 'count', value: '12', label: 'bolt count', noRemove: true, removeText: '' }
            ],
            noRecords: false
        },
        '$.data.form': {
            ...SIDE_RECORDS['form'],
            form: { name: '', choice: '', second: '', record: [{ id: 'name', label: 'name', value: '' }, { id: 'count', label: 'count', value: '' }] },
            noForm: false,
            noRecord: false,
            formNote: 'New record',
            submitText: 'Add'
        }
    },
    models: Object.fromEntries(
        Object.entries(SIDE_RECORDS).map(([namespace, blank]) => [
            modelOf(namespace),
            Object.entries(blank).map(([name, value]) => field(name, Array.isArray(value) ? 'array' : typeof value === 'object' ? 'object' : typeof value, value))
        ])
    ),
    definition: () => {
        const t = textsOf('en');
        return {
            title: 'Side panel',
            data: Object.fromEntries(Object.keys(SIDE_RECORDS).map((namespace) => [namespace, { model: modelOf(namespace), scope: 'person' }])),
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
                            title: { component: 'text', textRole: 'heading', element: 'h3', placement: { grow: 1 }, '<-_text': s('title') },
                            close: { component: 'button', icon: 'x', iconPosition: 'only', size: 'sm', variant: 'ghost', _title: t['views.close'], '@id': 'close' }
                        }
                    },
                    notes: column({
                        note: note(s('note'), s('noNote')),
                        detail: { component: 'text', '<-_text': s('detail'), 'own:hidden': s('noDetail') },
                        path: note(s('path'), s('noPath'))
                    }, s('noNotes')),
                    actions: row({
                        openApp: act(t['views.openApp'], 'openApp', s('noOpenApp'), { variant: 'solid' }),
                        openLogic: act(t['views.openLogic'], 'openLogic', s('noOpenLogic'), { variant: 'solid' }),
                        editTheme: act(t['views.editTheme'], 'editTheme', s('noEditTheme'), { variant: 'solid' }),
                        makeDefault: act(t['views.makeDefault'], 'makeDefault', s('noMakeDefault')),
                        removeTheme: act(t['views.removeTheme'], 'removeTheme', s('noRemoveTheme'), { tone: 'danger' }),
                        use: act(t['views.useInApp'], 'use', s('noUse'), { variant: 'solid' }),
                        openConnections: act(t['views.openConnections'], 'openConnections', s('noOpenConnections'), { variant: 'solid' })
                    }, s('noActions')),
                    linksPart: column({
                        linksTitle: { component: 'text', textRole: 'label', element: 'h4', '<-_text': s('linksTitle') },
                        links: {
                            component: 'list',
                            rowHeight: 'sm',
                            divided: true,
                            placement: { height: '160px' },
                            '<-items': s('links'),
                            row: { component: 'button', size: 'sm', variant: 'ghost', '<-_title': '$row.label', '@id': 'link' }
                        }
                    }, s('noLinks')),
                    codePart: column({
                        code: { component: 'textarea', rows: 12, '<-_label': s('codeLabel'), '<-value': s('code'), '@id': 'code' },
                        buttons: row({
                            save: act(t['views.save'], 'save', s('noSave'), { variant: 'solid' }),
                            delete: act(t['views.delete'], 'delete', s('noDelete'), { tone: 'danger' })
                        })
                    }, s('noCode')),
                    inputsTitle: { component: 'text', textRole: 'label', element: 'h4', _text: t['views.fn.inputs'], 'own:hidden': s('noInputs') },
                    inputs: { component: 'codeBlock', language: 'json', size: 'sm', wrap: true, '<-code': s('inputs'), 'own:hidden': s('noInputs') },
                    outputsTitle: { component: 'text', textRole: 'label', element: 'h4', _text: t['views.fn.outputs'], 'own:hidden': s('noOutputs') },
                    outputs: { component: 'codeBlock', language: 'json', size: 'sm', wrap: true, '<-code': s('outputs'), 'own:hidden': s('noOutputs') },
                    records: {
                        component: 'table',
                        density: 'compact',
                        placement: { height: '280px' },
                        '<-items': s('records'),
                        'own:hidden': s('noRecords'),
                        columns: {
                            key: { _title: t['views.kind.record'], field: 'keyShown', width: '80px' },
                            field: { _title: t['views.kind.field'], field: 'field', width: '90px' },
                            value: { _title: t['views.value'], width: '1fr', cell: { component: 'input', size: 'sm', '<-value': '$row.value', '<-_label': '$row.label', '@id': 'cell' } },
                            remove: { _title: '', width: '40px', cell: remove('$row.removeText', 'removeRecord', '$row.noRemove') }
                        }
                    },
                    more: note(s('more'), s('noMore')),
                    fields: {
                        component: 'list',
                        rowHeight: 'lg',
                        divided: true,
                        placement: { height: '240px' },
                        '<-items': s('fields'),
                        'own:hidden': s('noFields'),
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
                            baseUrl: { component: 'textField', _label: t['views.baseUrl'], placement: { grow: 1 }, '<-value': s('baseUrl'), '@id': 'baseUrl' },
                            saveUrl: act(t['views.save'], 'saveUrl', s('noManage'))
                        }),
                        secretRow: row({
                            secret: { component: 'textField', inputType: 'password', _label: t['views.newSecret'], placement: { grow: 1 }, '<-value': s('secret'), '@id': 'secret' },
                            keep: act(t['views.keep'], 'keep', s('noSecret'))
                        }, s('noSecret')),
                        connect: act(t['views.connect'], 'connect', s('noConnect'))
                    }, s('noManage')),
                    endpointsPart: column({
                        endpointsTitle: { component: 'text', textRole: 'label', element: 'h4', _text: t['views.endpoints'] },
                        endpoints: {
                            component: 'table',
                            density: 'compact',
                            placement: { height: '200px' },
                            '<-items': s('endpoints'),
                            columns: {
                                name: { _title: t['views.endpointName'], field: 'name', width: '1fr' },
                                does: { _title: t['views.endpointPath'], field: 'does', width: '2fr' },
                                try: { _title: '', width: '64px', cell: act(t['views.try'], 'try', '$row.noManage', { variant: 'ghost' }) },
                                remove: { _title: '', width: '40px', cell: remove('$row.removeText', 'removeEndpoint', '$row.noManage') }
                            }
                        },
                        tried: { component: 'codeBlock', size: 'sm', wrap: true, '<-code': s('tried'), 'own:hidden': s('noTried') }
                    }, s('noEndpoints')),
                    form: column({
                        formNote: { component: 'text', textRole: 'label', '<-_text': s('formNote') },
                        name: { component: 'textField', '<-_label': s('nameLabel'), '<-value': s('form.name'), 'own:hidden': s('noName'), '@id': 'name' },
                        choice: { component: 'selectField', '<-_label': s('choiceLabel'), '<-options': s('choices'), '<-value': s('form.choice'), 'own:hidden': s('noChoice'), '@id': 'choice' },
                        second: { component: 'textField', '<-_label': s('secondLabel'), '<-value': s('form.second'), 'own:hidden': s('noSecond'), '@id': 'second' },
                        record: {
                            component: 'list',
                            rowHeight: 'md',
                            placement: { height: '200px' },
                            '<-items': s('form.record'),
                            'own:hidden': s('noRecord'),
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
                        submit: { component: 'button', size: 'sm', variant: 'solid', '<-_title': s('submitText'), '@id': 'submit' }
                    }, s('noForm'))
                }
            }
        };
    }
});
