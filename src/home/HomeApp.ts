import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Services, UiToolDefinition } from '@punyts/stateui-mcp';
import { run } from '../stateui/run.js';
import { readJson, writeJsonAtomic } from '../storage/jsonFile.js';

/** The name of each person's "Your apps" app, which Magnetic makes in their workspace and shows at `/` */
export const HOME_APP = 'your-apps';
/** The model of an app's card on the home app */
const CARD_MODEL = 'app-card';

/** One app as the home app shows it */
export interface HomeCard {
    readonly id: string;
    readonly name: string;
    /** A line under the name: when it changed, or who shared it */
    readonly note: string;
}

/** What the home app holds in `$.data`: the person's apps, and the apps shared with them, each by id */
export interface HomeData {
    readonly apps: readonly HomeCard[];
    readonly shared: readonly HomeCard[];
}

/** The cards of a list, keyed by id in their order, as a record grid reads them */
function byId(cards: readonly HomeCard[]): Record<string, HomeCard> {
    return Object.fromEntries(cards.map((card) => [card.id, card]));
}

/** A grid of app cards; pressing one raises `open` with the app's id */
function grid(records: string): Record<string, unknown> {
    return {
        component: 'recordGrid',
        '<-records': records,
        row: { component: 'card', elevation: 'flat', interactive: true, '<-_title': '$row.name', '<-_subtitle': '$row.note', on: { press: { command: 'emit', target: 'open', from: '$row.id' } } }
    };
}

/**
 * The home screen: a field and a button that make an app (`create`, with the name), the person's apps, the apps
 * shared with them and Sign out (`signout`). Each `emit` reaches the page (`stateui:emit`), whose script acts on it
 */
const HOME_SCREEN = {
    component: 'panel',
    _title: 'Your apps',
    _description: 'Open an app to use it. Press Ctrl+Shift+E in an app to edit it with the agent.',
    children: {
        make: { component: 'textField', _label: 'Make an app', _placeholder: 'Its name, such as Reading list', value: '' },
        create: { component: 'button', _title: 'Make', on: { press: { command: 'emit', target: 'create', from: '$.screens.home.children.make.value' } } },
        apps: grid('$.data.apps'),
        sharedTitle: { component: 'text', textRole: 'label', _text: 'Shared with you' },
        shared: grid('$.data.shared'),
        signout: { component: 'button', variant: 'ghost', _title: 'Sign out', on: { press: { command: 'emit', target: 'signout' } } }
    }
};

/** The fields of an app card */
const CARD_FIELDS = [
    { op: 'set', field: 'id', type: 'string', required: true },
    { op: 'set', field: 'name', type: 'string', required: true },
    { op: 'set', field: 'note', type: 'string' }
];

/** The definition of the home app, beside its name */
const HOME_DEFINITION = { title: 'Your apps', data: { apps: { model: CARD_MODEL, scope: 'persona' }, shared: { model: CARD_MODEL, scope: 'persona' } }, home: HOME_SCREEN };

/** Changes when the definition does, so a workspace made with an older one gets the new one */
const HOME_STAMP = createHash('sha256').update(JSON.stringify({ CARD_FIELDS, HOME_DEFINITION })).digest('hex').slice(0, 16);

/**
 * Each person's "Your apps": a StateUI app in their own workspace, built with the same tools the agent uses. It is made
 * the first time it is needed, and made again when Magnetic ships a new definition (the stamp in
 * `users/<id>/magnetic/home.json` differs); each visit writes the lists of apps into its data, so it is never stale
 */
export class HomeApps {
    /** The id of each workspace's home app, once known */
    private readonly ids = new WeakMap<Services, Promise<string>>();

    constructor(
        private readonly toolsOf: (services: Services) => readonly UiToolDefinition[],
        /** The folder of each user's data, `users/` */
        private readonly usersDir: string
    ) {}

    /** The id of the home app of a person's workspace, making it first when it has none */
    id(services: Services, userId: string): Promise<string> {
        let found = this.ids.get(services);
        if (found === undefined) {
            found = this.ensure(services, userId);
            found.catch(() => this.ids.delete(services));
            this.ids.set(services, found);
        }
        return found;
    }

    private async ensure(services: Services, userId: string): Promise<string> {
        const stampFile = join(this.usersDir, userId, 'magnetic', 'home.json');
        const stamp = (await readJson<{ stamp?: string }>(stampFile))?.stamp;
        const existing = (await services.instanceViews.list()).find((app) => app.name === HOME_APP);
        if (existing !== undefined && stamp === HOME_STAMP) return existing.id;
        const tools = this.toolsOf(services);
        if (existing !== undefined) await run(tools, 'ui_delete', { kind: 'apps', name: HOME_APP, expectedRevision: existing.revision });
        const models = await run(tools, 'ui_list', { kind: 'models' }).catch(() => ({}));
        if (!JSON.stringify(models).includes(`"${CARD_MODEL}"`)) {
            await run(tools, 'ui_model_write', { model: CARD_MODEL, operations: CARD_FIELDS });
        }
        const created = await run(tools, 'ui_app_create', { name: HOME_APP, ...HOME_DEFINITION });
        if (typeof created['id'] !== 'string') throw new Error('ui_app_create gave no id');
        await writeJsonAtomic(stampFile, { stamp: HOME_STAMP });
        return created['id'];
    }

    /** The lists the home app holds now, in their order */
    async read(services: Services, userId: string): Promise<HomeData> {
        await this.id(services, userId);
        const tools = this.toolsOf(services);
        const list = async (path: string): Promise<HomeCard[]> => {
            const body = await run(tools, 'ui_state_get', { app: HOME_APP, path, full: true });
            const value = body['value'];
            return typeof value === 'object' && value !== null ? (Object.values(value) as HomeCard[]) : [];
        };
        return { apps: await list('$.data.apps'), shared: await list('$.data.shared') };
    }

    /** Writes the lists into the home app's data, which its open views follow at once, and empties the name field */
    async show(services: Services, userId: string, data: HomeData): Promise<void> {
        await this.id(services, userId);
        const tools = this.toolsOf(services);
        await run(tools, 'ui_state_set', { app: HOME_APP, path: '$.data.apps', value: byId(data.apps), logic: false });
        await run(tools, 'ui_state_set', { app: HOME_APP, path: '$.data.shared', value: byId(data.shared), logic: false });
        await run(tools, 'ui_state_set', { app: HOME_APP, path: '$.screens.home.children.make.value', value: '', logic: false });
    }
}
