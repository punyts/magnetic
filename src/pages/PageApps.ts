import { report } from '@punyts/core';
import type { Services, UiToolDefinition } from '@punyts/stateui-mcp';
import { msSince } from '../server/reporting.js';
import { LOGO_SVG } from '../http/logo.js';
import { textsOf } from '../http/text.js';
import { SYSTEM_USER_ID } from '../inspector/constants.js';
import { run } from '../stateui/run.js';
import type { Stamps } from '../storage/Stamps.js';
import { alone, SYSTEM_APPS_LOCK } from '../storage/exclusive.js';
import type { Exclusive } from '../storage/exclusive.js';
import { makePage, pageStamp } from './PageSpec.js';
import type { PageSpec } from './PageSpec.js';

/** A page app as a page mounts it: its assembled document and icons */
export interface PageAppDocument {
    readonly document: Record<string, unknown>;
    readonly icons: Record<string, string>;
}

/** Magnetic's logo, as a frame (which has no network) can show it */
const LOGO = `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString('base64')}`;

/** Magnetic's name with its logo, as the top of a page */
function brand(): Record<string, unknown> {
    return {
        component: 'panel',
        padding: 'none',
        layout: { type: 'row', gap: 'sm', align: 'center' },
        children: {
            logo: { component: 'image', src: LOGO, decorative: true, ratio: '1:1', fit: 'contain', placement: { height: '40px' } },
            name: { component: 'text', textRole: 'display', placement: { grow: 1 }, _text: 'Magnetic' }
        }
    };
}

const emit = (target: string, from?: string): Record<string, unknown> => ({ command: 'emit', target, ...(from !== undefined && { from }) });
const field = (name: string, type: string, value: unknown): Record<string, unknown> => ({ op: 'set', field: name, type, default: value });

/** A centred column of a page, as Your apps has it */
function centred(children: Record<string, unknown>): Record<string, unknown> {
    return {
        component: 'panel',
        padding: 'lg',
        layout: { type: 'grid', cols: 12, collapseBelow: 'md' },
        children: { page: { component: 'panel', padding: 'none', placement: { col: 4, span: 6 }, layout: { type: 'column', gap: 'lg' }, children } }
    };
}

/** A column of buttons, one per record of `items` (`{ id, label }`), each raising `target` with the record's id */
function buttons(items: string, target: string, variant: string, hidden: string): Record<string, unknown> {
    return {
        component: 'list',
        '<-items': items,
        '<-hidden': hidden,
        rowHeight: 'lg',
        row: { component: 'button', variant, '<-_title': '$row.label', on: { press: emit(target, '$row.id') } }
    };
}

const S = '$.data.signin';

/**
 * Sign in: Magnetic and what it does, why the last sign-in failed, the beta's notice, a button per provider
 * (`provider`, with its name), the work email of an org with its own sign-in (`sso`) and, on a development server, a
 * button per test user (`dev`, with the name). What the server signs in with is data (`providers`, `devUsers`, and
 * `no…` flags that hide what it lacks), so an edited page follows a change of the server's options
 */
export const SIGN_IN: PageSpec = {
    name: 'magnetic-signin',
    title: 'Sign in',
    themed: true,
    required: ['provider', 'dev', 'sso'],
    sample: {
        [S]: {
            error: 'Why the last sign-in failed shows here',
            noError: false,
            notice: 'The beta notice shows here while the beta is full.',
            noNotice: false,
            providers: { p0: { id: 'provider', label: 'Sign in with a provider' } },
            noProviders: false,
            devUsers: { u0: { id: 'test', label: 'Sign in as a test person' } },
            noDevUsers: false,
            noSso: false,
            workEmail: '',
            noNone: false
        }
    },
    models: {
        'magnetic-signin': [
            field('error', 'string', ''),
            field('noError', 'boolean', true),
            field('notice', 'string', ''),
            field('noNotice', 'boolean', true),
            field('providers', 'object', {}),
            field('noProviders', 'boolean', true),
            field('devUsers', 'object', {}),
            field('noDevUsers', 'boolean', true),
            field('noSso', 'boolean', true),
            field('workEmail', 'string', ''),
            field('noNone', 'boolean', true)
        ]
    },
    definition: () => {
        const t = textsOf('en');
        return {
            title: t['signin.title'],
            data: { signin: { model: 'magnetic-signin', scope: 'persona' } },
            home: centred({
                brand: brand(),
                tagline: { component: 'text', _text: t['signin.tagline'] },
                error: { component: 'alert', tone: 'danger', '<-_title': `${S}.error`, '<-hidden': `${S}.noError` },
                // Why someone who signs in now gets no free agent use: the beta is full
                notice: { component: 'alert', tone: 'info', _title: t['signin.betaFull'], '<-_text': `${S}.notice`, '<-hidden': `${S}.noNotice` },
                providers: buttons(`${S}.providers`, 'provider', 'solid', `${S}.noProviders`),
                work: {
                    component: 'panel',
                    padding: 'none',
                    '<-hidden': `${S}.noSso`,
                    layout: { type: 'row', gap: 'sm', align: 'end', wrap: true },
                    children: {
                        email: { component: 'textField', placement: { grow: 1 }, _label: t['signin.workTitle'], _placeholder: t['signin.workEmail'], '<-value': `${S}.workEmail` },
                        go: { component: 'button', variant: 'soft', _title: t['signin.workGo'], on: { press: emit('sso', `${S}.workEmail`) } }
                    }
                },
                dev: {
                    component: 'panel',
                    padding: 'none',
                    '<-hidden': `${S}.noDevUsers`,
                    layout: { type: 'column', gap: 'sm' },
                    children: {
                        title: { component: 'text', textRole: 'heading', _text: t['signin.devTitle'] },
                        note: { component: 'text', textRole: 'caption', _text: t['signin.devNote'] },
                        users: buttons(`${S}.devUsers`, 'dev', 'soft', `${S}.noDevUsers`)
                    }
                },
                none: { component: 'text', textRole: 'caption', '<-hidden': `${S}.noNone`, _text: t['signin.none'] }
            })
        };
    }
};

/**
 * A share link that does not open an app at once: its title and why, Your apps (`home`), and for a remix link the
 * offer to copy the app (`remix`)
 */
export const LINK: PageSpec = {
    name: 'magnetic-link',
    title: 'Share links',
    themed: true,
    required: ['home', 'remix'],
    sample: { '$.data.link': { title: 'Remix an app', message: 'Why the link does not open the app shows here.', noRemix: false } },
    models: {
        'magnetic-linkpage': [field('title', 'string', ''), field('message', 'string', ''), field('noRemix', 'boolean', true)]
    },
    definition: () => {
        const t = textsOf('en');
        return {
            title: 'Magnetic',
            data: { link: { model: 'magnetic-linkpage', scope: 'persona' } },
            home: centred({
                brand: brand(),
                top: {
                    component: 'panel',
                    padding: 'none',
                    layout: { type: 'row', gap: 'md', align: 'center' },
                    children: {
                        title: { component: 'text', textRole: 'title', placement: { grow: 1 }, '<-_text': '$.data.link.title' },
                        home: { component: 'button', variant: 'ghost', size: 'sm', _title: t['link.home'], on: { press: emit('home') } }
                    }
                },
                message: { component: 'text', '<-_text': '$.data.link.message' },
                remix: {
                    component: 'panel',
                    padding: 'none',
                    '<-hidden': '$.data.link.noRemix',
                    layout: { type: 'column', gap: 'sm' },
                    children: {
                        remix: { component: 'button', _title: t['link.remix'], on: { press: emit('remix') } },
                        note: { component: 'text', textRole: 'caption', _text: t['link.remixNote'] }
                    }
                }
            })
        };
    }
};

export const PAGE_APPS = { signIn: SIGN_IN, link: LINK } as const;

/**
 * Magnetic's own version of a page, as its code defines it: an app in the system workspace made with the tools the
 * agent uses, made again when Magnetic ships a new definition. It is served while no admin has published another
 * (`SitePages`), always at `?page=default`, and it is what a page falls back to when a published one does not load
 */
export class PageApps {
    private readonly built = new Map<string, Promise<PageAppDocument & { readonly id: string }>>();

    constructor(
        private readonly workspace: () => Promise<{ readonly services: Services; readonly release: () => void }>,
        private readonly toolsOf: (services: Services) => readonly UiToolDefinition[],
        /** Where the version of each page app made in the system workspace is kept */
        private readonly stamps: Stamps,
        /** Keeps two servers from making the same page app at once */
        private readonly exclusive: Exclusive = alone
    ) {}

    document(spec: PageSpec): Promise<PageAppDocument & { readonly id: string }> {
        let built = this.built.get(spec.name);
        if (built === undefined) {
            built = this.build(spec);
            built.catch(() => this.built.delete(spec.name));
            this.built.set(spec.name, built);
        }
        return built;
    }

    private async build(spec: PageSpec): Promise<PageAppDocument & { readonly id: string }> {
        const { services, release } = await this.workspace();
        try {
            const tools = this.toolsOf(services);
            const stamp = pageStamp(spec);
            const current = async () => ({
                kept: (await this.stamps.get<{ stamp?: string }>(SYSTEM_USER_ID, `page:${spec.name}`))?.stamp,
                listed: (await services.instanceViews.list()).find((app) => app.name === spec.name)
            });
            let { kept, listed } = await current();
            if (listed === undefined || kept !== stamp) {
                // Another server may be making it, or made it a moment ago: wait for it, and look again past this
                // server's index of the parts, which may not have heard of its change yet
                listed = await this.exclusive(SYSTEM_APPS_LOCK, async () => {
                    services.resyncParts();
                    ({ kept, listed } = await current());
                    if (listed !== undefined && kept === stamp) return listed;
                    const started = performance.now();
                    if (listed !== undefined) await run(tools, 'ui_delete', { kind: 'apps', name: spec.name, expectedRevision: listed.revision });
                    await makePage(tools, spec);
                    await this.stamps.set(SYSTEM_USER_ID, `page:${spec.name}`, { stamp });
                    report('magnetic.pages', 'Page version remade', { page: spec.name, replaced: listed !== undefined, ms: msSince(started) });
                    return (await services.instanceViews.list()).find((app) => app.name === spec.name);
                });
            }
            const app = listed === undefined ? undefined : await services.instanceViews.find(listed.id);
            if (app === undefined) throw new Error(`The page app ${spec.name} could not be made`);
            const message = await services.instanceViews.message(app, 'attach');
            return { id: app.id, document: message.document as Record<string, unknown>, icons: { ...message.icons } };
        } finally {
            release();
        }
    }
}
