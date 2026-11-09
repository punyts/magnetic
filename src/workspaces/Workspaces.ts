import type { Services } from '@punyts/stateui-mcp';

/** How a user's services are made, and closed when they are no longer used */
export interface WorkspaceFactory {
    open(userId: string): Promise<Services>;
    close(services: Services): Promise<void>;
}

interface Entry {
    readonly services: Promise<Services>;
    /** Open view sockets */
    sockets: number;
    lastUsed: number;
}

export interface WorkspacesOptions {
    /** A workspace with no open socket that no request touched for this long is closed; default 10 minutes */
    readonly idleMs?: number;
    /** At most this many workspaces stay open: past it, the least recently used one without sockets is closed; default 200 */
    readonly max?: number;
    readonly now?: () => number;
}

/**
 * One set of stateui-mcp services per user, each over the user's own data folder and owner id, so one user's parts,
 * instances, files and authorities never meet another's. A workspace opens on the user's first request and closes
 * when it has been idle with no open view, or when too many are open
 */
export class Workspaces {
    private readonly entries = new Map<string, Entry>();
    private readonly idleMs: number;
    private readonly max: number;
    private readonly now: () => number;

    constructor(
        private readonly factory: WorkspaceFactory,
        options: WorkspacesOptions = {}
    ) {
        this.idleMs = options.idleMs ?? 10 * 60 * 1000;
        this.max = options.max ?? 200;
        this.now = options.now ?? Date.now;
    }

    /** The user's services, opened on first use */
    get(userId: string): Promise<Services> {
        let entry = this.entries.get(userId);
        if (entry === undefined) {
            const services = this.factory.open(userId);
            entry = { services, sockets: 0, lastUsed: this.now() };
            this.entries.set(userId, entry);
            // A workspace that failed to open is tried again on the next request
            services.catch(() => {
                if (this.entries.get(userId)?.services === services) this.entries.delete(userId);
            });
            void this.trim();
        }
        entry.lastUsed = this.now();
        return entry.services;
    }

    /** Counts an open view socket of the user's workspace; the function it returns counts it closed */
    retain(userId: string): () => void {
        const entry = this.entries.get(userId);
        if (entry === undefined) return () => undefined;
        entry.sockets += 1;
        let released = false;
        return () => {
            if (released) return;
            released = true;
            entry.sockets -= 1;
            entry.lastUsed = this.now();
        };
    }

    /** How many workspaces are open */
    get size(): number {
        return this.entries.size;
    }

    /** Closes the workspaces that have been idle with no open view for `idleMs` */
    async sweep(): Promise<void> {
        const cutoff = this.now() - this.idleMs;
        const idle = [...this.entries].filter(([, entry]) => entry.sockets === 0 && entry.lastUsed <= cutoff).map(([userId]) => userId);
        await Promise.all(idle.map((userId) => this.closeOne(userId)));
    }

    /** Closes every workspace */
    async close(): Promise<void> {
        await Promise.all([...this.entries.keys()].map((userId) => this.closeOne(userId)));
    }

    /** Past `max`, closes the least recently used workspaces that have no open view */
    private async trim(): Promise<void> {
        if (this.entries.size <= this.max) return;
        const candidates = [...this.entries].filter(([, entry]) => entry.sockets === 0).sort(([, a], [, b]) => a.lastUsed - b.lastUsed);
        const extra = this.entries.size - this.max;
        await Promise.all(candidates.slice(0, extra).map(([userId]) => this.closeOne(userId)));
    }

    private async closeOne(userId: string): Promise<void> {
        const entry = this.entries.get(userId);
        if (entry === undefined) return;
        this.entries.delete(userId);
        const services = await entry.services.catch(() => undefined);
        if (services !== undefined) await this.factory.close(services);
    }
}
