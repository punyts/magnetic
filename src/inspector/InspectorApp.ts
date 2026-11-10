import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Services, UiToolDefinition } from '@punyts/stateui-mcp';
import { run } from '../stateui/run.js';
import { readJson, writeJsonAtomic } from '../storage/jsonFile.js';

/** The name of the inspector app in Magnetic's system workspace */
export const INSPECTOR_APP = 'inspector';
/**
 * The workspace of Magnetic's own page-driven apps. No account has this id (accounts get random ones), so no person
 * signs in to it and none of its apps is served at `/apps`
 */
export const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000000';

/** The categories of the component library, as the Add tab offers them */
export const COMPONENT_CATEGORIES = ['layout', 'navigation', 'forms', 'data', 'feedback', 'overlays', 'content', 'conversation', 'graphics'] as const;

/** The models of the records the page writes into the inspector */
const MODELS: Record<string, readonly Record<string, unknown>[]> = {
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

const TABS = '$.screens.home.children.tabs.children';

/**
 * The inspector: Properties, Add and State, in tabs. The page fills it: it writes the records of `$.data`, the
 * breadcrumb's items and whole nodes into the `fields` and `detail` panels, and acts on every `emit`
 * (`crumb`, `remove`, `search`, `category`, `place`, `path`, `ask`, and `prop.<name>` from the generated fields)
 */
const INSPECTOR_SCREEN = {
    component: 'panel',
    padding: 'none',
    children: {
        tabs: {
            component: 'tabs',
            on: { change: { command: 'emit', target: 'tab' } },
            children: {
                properties: {
                    component: 'panel',
                    placement: { _tab: 'Properties' },
                    children: {
                        crumbs: { component: 'breadcrumb', items: {}, current: '', on: { select: { command: 'emit', target: 'crumb' } } },
                        heading: { component: 'text', textRole: 'label', _text: 'Press S, then click a part of the app to see its properties.' },
                        fields: { component: 'panel', padding: 'none', children: {} },
                        remove: { component: 'button', variant: 'soft', tone: 'danger', size: 'sm', hidden: true, _title: 'Delete', on: { press: { command: 'emit', target: 'remove' } } }
                    }
                },
                add: {
                    component: 'panel',
                    placement: { _tab: 'Add' },
                    children: {
                        search: { component: 'searchBox', size: 'sm', _label: 'Find a component', _placeholder: 'Find a component', value: '', on: { change: { command: 'emit', target: 'search' } } },
                        category: {
                            component: 'selectField',
                            size: 'sm',
                            _label: 'Category',
                            options: Object.fromEntries([['all', { _label: 'All' }], ...COMPONENT_CATEGORIES.map((name) => [name, { _label: name[0]?.toUpperCase() + name.slice(1) }])]),
                            value: 'all',
                            on: { change: { command: 'emit', target: 'category' } }
                        },
                        hint: { component: 'text', _text: 'Pick a component, then click where it goes in the app.' },
                        cards: {
                            component: 'list',
                            '<-items': '$.data.components',
                            divided: true,
                            _empty: 'No component matches.',
                            row: {
                                component: 'card',
                                elevation: 'flat',
                                interactive: true,
                                '<-_title': '$row.name',
                                '<-_subtitle': '$row.summary',
                                on: { press: { command: 'emit', target: 'place', from: '$row.name' } }
                            }
                        }
                    }
                },
                state: {
                    component: 'panel',
                    placement: { _tab: 'State' },
                    children: {
                        paths: {
                            component: 'tree',
                            '<-records': '$.data.paths',
                            selectable: 'single',
                            density: 'compact',
                            on: { select: { command: 'emit', target: 'path' } }
                        },
                        detail: { component: 'panel', padding: 'none', children: {} },
                        feedTitle: { component: 'text', textRole: 'label', _text: 'Changes' },
                        feed: { component: 'list', '<-items': '$.data.feed', density: 'compact', _empty: 'Use the app to see its state change here.', row: { component: 'text', truncate: 1, '<-_text': '$row.line' } }
                    }
                }
            }
        }
    }
};

/** Where the page writes in the inspector */
export const INSPECTOR_PATHS = {
    tabs: '$.screens.home.children.tabs',
    crumbs: `${TABS}.properties.children.crumbs`,
    heading: `${TABS}.properties.children.heading`,
    fields: `${TABS}.properties.children.fields`,
    remove: `${TABS}.properties.children.remove`,
    detail: `${TABS}.state.children.detail`
} as const;

const DEFINITION = {
    title: 'Inspector',
    data: Object.fromEntries(
        [
            ['components', 'inspector-component'],
            ['paths', 'inspector-path'],
            ['feed', 'inspector-change']
        ].map(([name, model]) => [name, { model, scope: 'persona' }])
    ),
    home: INSPECTOR_SCREEN
};

/** Changes when the definition does, so a system workspace made with an older one gets the new one */
const STAMP = createHash('sha256').update(JSON.stringify({ MODELS, DEFINITION })).digest('hex').slice(0, 16);

/** What a page needs to mount the inspector with `stateuiHost.mount`: the assembled document and its icons */
export interface MountableApp {
    readonly document: Record<string, unknown>;
    readonly icons: Record<string, string>;
}

/**
 * The inspector app the editor page mounts beside the app: a StateUI app made with the tools the agent uses, in
 * Magnetic's system workspace, and made again when Magnetic ships a new definition. The page drives it alone, so only
 * its assembled document is served (`/assets/inspector.json`); nothing of it is synced
 */
export class InspectorApp {
    private built: Promise<MountableApp> | undefined;

    constructor(
        /** The system workspace, held until `release` */
        private readonly workspace: () => Promise<{ readonly services: Services; readonly release: () => void }>,
        private readonly toolsOf: (services: Services) => readonly UiToolDefinition[],
        /** The folder of the system workspace's Magnetic files, for the stamp */
        private readonly stampDir: string
    ) {}

    /** The assembled inspector, made once per run of the server */
    mountable(): Promise<MountableApp> {
        if (this.built === undefined) {
            this.built = this.build();
            this.built.catch(() => (this.built = undefined));
        }
        return this.built;
    }

    private async build(): Promise<MountableApp> {
        const { services, release } = await this.workspace();
        try {
            const tools = this.toolsOf(services);
            const stampFile = join(this.stampDir, 'inspector.json');
            const stamp = (await readJson<{ stamp?: string }>(stampFile))?.stamp;
            const listed = (await services.instanceViews.list()).find((candidate) => candidate.name === INSPECTOR_APP);
            let app = listed === undefined ? undefined : await services.instanceViews.find(listed.id);
            if (app === undefined || stamp !== STAMP) {
                if (app !== undefined) await run(tools, 'ui_delete', { kind: 'apps', name: INSPECTOR_APP, expectedRevision: app.revision });
                const models = JSON.stringify(await run(tools, 'ui_list', { kind: 'models' }).catch(() => ({})));
                for (const [model, operations] of Object.entries(MODELS)) {
                    if (!models.includes(`"${model}"`)) await run(tools, 'ui_model_write', { model, operations });
                }
                const created = await run(tools, 'ui_app_create', { name: INSPECTOR_APP, ...DEFINITION });
                app = typeof created['id'] === 'string' ? await services.instanceViews.find(created['id']) : undefined;
                if (app === undefined) throw new Error('ui_app_create gave no app');
                await writeJsonAtomic(stampFile, { stamp: STAMP });
            }
            const message = await services.instanceViews.message(app, 'attach');
            return { document: message.document as Record<string, unknown>, icons: { ...message.icons } };
        } finally {
            release();
        }
    }
}
