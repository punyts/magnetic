import type { Services, UiToolDefinition } from '@punyts/stateui-mcp';
import { run } from '../stateui/run.js';
import type { Stamps } from '../storage/Stamps.js';
import { alone, userAppsLock } from '../storage/exclusive.js';
import type { Exclusive } from '../storage/exclusive.js';
import { makePage, pageStamp } from './PageSpec.js';
import type { PageSpec } from './PageSpec.js';

/**
 * Where a person's copy of a page comes from: Magnetic's version of it now. That is what an admin published
 * (`SitePages`), or else the code's definition
 */
export interface PageSource {
    /** Changes whenever Magnetic's version of the page does */
    stamp(spec: PageSpec): Promise<string>;
    /** Makes the page in a workspace from Magnetic's version, under its name; answers its id and revision */
    make(spec: PageSpec, tools: readonly UiToolDefinition[], services: Services): Promise<{ id: string; revision: number }>;
}

/** Magnetic's version as its code defines it */
export const CODE_SOURCE: PageSource = {
    stamp: async (spec) => pageStamp(spec),
    make: (spec, tools) => makePage(tools, spec)
};

/** What is kept of a person's copy: the version of Magnetic's it was made from, and the revision it was left at */
interface Kept {
    readonly stamp?: string;
    readonly revision?: number;
}

/**
 * A person's own copy of one of Magnetic's pages (Your apps, the editor): an app in their workspace, made from
 * Magnetic's version the first time it is needed, and made again when Magnetic's changes, unless the person changed
 * theirs (its revision is no longer the one Magnetic left). They open it in the editor like any app, and reset it to
 * Magnetic's. A copy kept before copies could be changed (no revision kept) counts as unchanged
 */
export class PersonPages {
    constructor(
        readonly spec: PageSpec,
        /** The name its stamp is kept under in the person's workspace */
        private readonly stampName: string,
        protected readonly toolsOf: (services: Services) => readonly UiToolDefinition[],
        private readonly stamps: Stamps,
        private readonly source: () => PageSource = () => CODE_SOURCE,
        /** Keeps two servers from making the same person's copy at once */
        private readonly exclusive: Exclusive = alone
    ) {}

    /** The id of the person's copy, making it when they have none, or when Magnetic's changed and theirs did not */
    async id(services: Services, userId: string): Promise<string> {
        const stamp = await this.source().stamp(this.spec);
        const kept = await this.kept(services, userId, stamp);
        if (kept !== undefined) return kept;
        return this.exclusive(userAppsLock(userId), async () => {
            // Another server may have made it meanwhile, past what this server's index of the parts has heard
            services.resyncParts();
            const madeMeanwhile = await this.kept(services, userId, stamp);
            if (madeMeanwhile !== undefined) return madeMeanwhile;
            return this.make(services, userId, stamp);
        });
    }

    /** Whether the person changed their copy since it was made */
    async changed(services: Services, userId: string): Promise<boolean> {
        const kept = await this.stamps.get<Kept>(userId, this.stampName);
        const existing = await this.existing(services);
        return existing !== undefined && kept?.revision !== undefined && kept.revision !== existing.revision;
    }

    /** Puts the person's copy back to Magnetic's version */
    reset(services: Services, userId: string): Promise<string> {
        return this.exclusive(userAppsLock(userId), async () => {
            services.resyncParts();
            return this.make(services, userId, await this.source().stamp(this.spec));
        });
    }

    private async existing(services: Services): Promise<{ readonly id: string; readonly revision: number } | undefined> {
        return (await services.instanceViews.list()).find((app) => app.name === this.spec.name);
    }

    /** The id of the person's copy when it may stay as it is: made from Magnetic's version now, or changed by them */
    private async kept(services: Services, userId: string, stamp: string): Promise<string | undefined> {
        const kept = await this.stamps.get<Kept>(userId, this.stampName);
        const existing = await this.existing(services);
        if (existing === undefined) return undefined;
        const untouched = kept?.revision === undefined || kept.revision === existing.revision;
        return kept?.stamp === stamp || !untouched ? existing.id : undefined;
    }

    private async make(services: Services, userId: string, stamp: string): Promise<string> {
        const tools = this.toolsOf(services);
        const existing = await this.existing(services);
        if (existing !== undefined) await run(tools, 'ui_delete', { kind: 'apps', name: this.spec.name, expectedRevision: existing.revision });
        const made = await this.source().make(this.spec, tools, services);
        await this.stamps.set(userId, this.stampName, { stamp, revision: made.revision });
        return made.id;
    }
}
