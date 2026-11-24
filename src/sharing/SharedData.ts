import type { Services, SharedData as SharedDataPort, SharedDataListener } from '@punyts/stateui-mcp';
import type { StateGrants } from '../grants/StateGrants.js';
import { datasetAddress } from '../grants/StateGrants.js';

/** The workspaces whose datasets are read: opened on first use, and kept open while a read follows one */
export interface DataOwners {
    get(workspaceId: string): Promise<Services>;
    retain(workspaceId: string): () => void;
}

interface Read {
    closed: boolean;
    grantId?: string;
    readonly stops: Array<() => void>;
    readonly listener: SharedDataListener;
}

/**
 * Datasets owners shared with other workspaces, read by those workspaces' apps (docs/design/magnetic-shared-data.md).
 * A read finds the share the reading workspace holds, signs a token for it and checks it as a relay would, then
 * follows the dataset's namespace as the owner, wherever it is held (`Services.datasetSessions.follow`), keeping the
 * owner's workspace open while it reads. Every delivery checks the share again, and revoking a share ends every read
 * through it at once
 */
export class SharedData {
    private readonly byGrant = new Map<string, Set<Read>>();

    constructor(
        private readonly grants: StateGrants,
        private readonly owners: DataOwners,
        private readonly report: (message: string, fields: Record<string, unknown>) => void = () => undefined
    ) {}

    /** The port the reading workspace's services take */
    forReader(readerId: string): SharedDataPort {
        return { open: (owner, dataset, listener) => this.open(readerId, owner, dataset, listener) };
    }

    /** Shares were revoked: the reads through them end now */
    revoked(grants: ReadonlyArray<{ readonly id: string }>): void {
        for (const { id } of grants) {
            for (const read of [...(this.byGrant.get(id) ?? [])]) this.end(read, 'The share was revoked.');
        }
    }

    /** How many reads follow a dataset now, for tests */
    get openReads(): number {
        return [...this.byGrant.values()].reduce((sum, reads) => sum + reads.size, 0);
    }

    private open(readerId: string, owner: string, dataset: string, listener: SharedDataListener): { close(): void } {
        const read: Read = { closed: false, stops: [], listener };
        void this.start(read, readerId, owner, dataset).catch((error: unknown) => this.end(read, error instanceof Error ? error.message : String(error)));
        return { close: () => this.close(read) };
    }

    private async start(read: Read, readerId: string, owner: string, dataset: string): Promise<void> {
        const share = await this.grants.datasetShare(readerId, owner, dataset);
        if (read.closed) return;
        if (share === undefined) {
            this.end(read, `No dataset ${dataset} is shared with this workspace by that owner.`);
            return;
        }
        // The token a relay would be shown: signed with the owner's key, checked against the keys and the revocations
        const checked = await this.grants.check({ subject: readerId, grant: await this.grants.tokenFor(share.id) }, { address: datasetAddress(owner, dataset), path: '$', right: 'read' });
        if (read.closed) return;
        if (!checked.ok) {
            this.end(read, checked.reason);
            return;
        }
        read.grantId = share.id;
        const reads = this.byGrant.get(share.id) ?? new Set<Read>();
        reads.add(read);
        this.byGrant.set(share.id, reads);
        const services = await this.owners.get(owner);
        if (read.closed) return;
        read.stops.push(this.owners.retain(owner));
        let queue = Promise.resolve();
        const send = (records: Record<string, unknown>): void => {
            queue = queue
                .then(async () => {
                    if (read.closed) return;
                    const still = await this.grants.datasetShare(readerId, owner, dataset);
                    if (still?.id !== share.id) {
                        this.end(read, 'The share ended.');
                        return;
                    }
                    if (!read.closed) read.listener.records(records);
                })
                .catch((error: unknown) => this.report('A shared dataset could not be read', { owner, dataset, error: error instanceof Error ? error.message : String(error) }));
        };
        const followed = await services.datasetSessions.follow(dataset, () => this.grants.boundAccess(owner, owner, dataset), send);
        if (followed === undefined) {
            this.end(read, `No dataset ${dataset} is shared with this workspace by that owner.`);
            return;
        }
        if (read.closed) {
            followed.close();
            return;
        }
        read.stops.push(() => followed.close());
    }

    private end(read: Read, reason: string): void {
        if (read.closed) return;
        this.close(read);
        read.listener.ended(reason);
    }

    private close(read: Read): void {
        if (read.closed) return;
        read.closed = true;
        if (read.grantId !== undefined) {
            const reads = this.byGrant.get(read.grantId);
            reads?.delete(read);
            if (reads?.size === 0) this.byGrant.delete(read.grantId);
        }
        for (const stop of read.stops.splice(0)) stop();
    }
}
