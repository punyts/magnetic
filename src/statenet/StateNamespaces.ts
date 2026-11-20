import { createAggregateStorage } from '@punyts/statenet';
import type { AggregateLink } from '@punyts/statenet';
import type { InstanceNamespaceStore } from '@punyts/stateui-mcp';
import { pgInstanceNamespaces } from '@punyts/stateui-pg';
import type { Database, Queryable } from '@punyts/stateui-pg';

/** The workspace an address is in, as recorded in `statenet_namespace`; read fresh, for the aggregate */
async function recordedWorkspace(db: Queryable, address: string): Promise<string | undefined> {
    return (await db.query<{ workspace_id: string }>('SELECT workspace_id::text AS workspace_id FROM statenet_namespace WHERE address = $1', [address])).rows[0]?.workspace_id;
}

/**
 * Which workspace each statenet address is in (docs/design/statenet-network.md, S11): the workspace whose row-level
 * security holds a person's state of an app. A server records it before it sends anything for an address, and the
 * aggregate reads it at each load, save and removal
 */
export class NamespaceWorkspaces {
    /** What this server recorded or read, so it writes each once */
    private readonly known = new Map<string, string>();

    constructor(private readonly db: Database) {}

    /**
     * Records the workspace of an address that has none, when this server has not already. An address already
     * recorded keeps its workspace: only `place` changes it, so the last save of an instance still open where its
     * app was cannot take it back
     */
    async record(address: string, workspaceId: string): Promise<void> {
        if (this.known.get(address) === workspaceId) return;
        await this.db.query('INSERT INTO statenet_namespace (address, workspace_id) VALUES ($1, $2) ON CONFLICT (address) DO NOTHING', [address, workspaceId]);
        this.known.set(address, workspaceId);
    }

    /** Puts an address in a workspace, whichever it was in: a move */
    async place(address: string, workspaceId: string): Promise<void> {
        await this.db.query(
            'INSERT INTO statenet_namespace (address, workspace_id) VALUES ($1, $2) ON CONFLICT (address) DO UPDATE SET workspace_id = EXCLUDED.workspace_id, updated_at = now() WHERE statenet_namespace.workspace_id <> EXCLUDED.workspace_id',
            [address, workspaceId]
        );
        this.known.set(address, workspaceId);
    }

    /** The workspace of an address: what this server knows, else what is recorded */
    async of(address: string): Promise<string | undefined> {
        const known = this.known.get(address);
        if (known !== undefined) return known;
        const found = await recordedWorkspace(this.db, address);
        if (found !== undefined) this.known.set(address, found);
        return found;
    }
}

/**
 * The aggregate's storage (docs/design/statenet-network.md, S11a and S11): stateui-pg's stored namespaces, each in the
 * workspace `statenet_namespace` names at the time of the call, with the embeddings of changed records queued in the
 * save's transaction when search is on
 */
export function aggregateStorage(db: Database, options: { readonly embedRecords: boolean }): InstanceNamespaceStore {
    return pgInstanceNamespaces(
        db,
        async (address) => {
            const workspaceId = await recordedWorkspace(db, address);
            if (workspaceId === undefined) throw new Error(`No workspace is recorded for ${address}`);
            return workspaceId;
        },
        { embedRecords: options.embedRecords }
    );
}

/**
 * How a server changes people's state (docs/design/statenet-network.md, S11): only through the aggregate, over its
 * link (in its process, or up through a relay), with each address's workspace recorded first. An instance's own loads
 * and saves come through `forWorkspace`; removing state (retention, a deleted org) and moving it to another workspace
 * (an app brought into an org) come through `remove` and `move`
 */
export class StateWriter {
    private readonly through: InstanceNamespaceStore;

    constructor(
        private readonly db: Database,
        private readonly workspaces: NamespaceWorkspaces,
        link: AggregateLink,
        /** This server's node id, which the aggregate may check orders the address */
        node?: string
    ) {
        this.through = createAggregateStorage(link, node);
    }

    /** The stored namespaces of one workspace's instances */
    forWorkspace(workspaceId: string): InstanceNamespaceStore {
        return {
            load: async (address) => {
                await this.workspaces.record(address, workspaceId);
                return this.through.load(address);
            },
            save: async (address, stored, epoch) => {
                await this.workspaces.record(address, workspaceId);
                return this.through.save(address, stored, epoch);
            },
            remove: async (address, epoch) => {
                await this.workspaces.record(address, workspaceId);
                return this.through.remove(address, epoch);
            }
        };
    }

    /** The epoch an address's head holds now, read in its workspace; 0 for none */
    private async epochOf(address: string, workspaceId: string): Promise<number> {
        return this.db.transaction(async (tx) => Number((await tx.query<{ epoch: string | number }>('SELECT epoch FROM namespace_head WHERE address = $1', [address])).rows[0]?.epoch ?? 0), { workspaceIds: [workspaceId] });
    }

    /** Removes these namespaces of a workspace whole, each at the epoch its head holds */
    async remove(workspaceId: string, addresses: readonly string[]): Promise<void> {
        for (const address of addresses) {
            await this.workspaces.record(address, workspaceId);
            await this.through.remove(address, await this.epochOf(address, workspaceId));
        }
    }

    /**
     * Moves a namespace from one workspace to another: loads it, removes it where it is, records the new workspace and
     * saves it there under the epoch it had. Nothing to do for an address with no state
     */
    async move(address: string, from: string, to: string): Promise<void> {
        if (from === to) return;
        await this.workspaces.place(address, from);
        const epoch = await this.epochOf(address, from);
        const stored = await this.through.load(address);
        if (stored !== undefined) await this.through.remove(address, epoch);
        await this.workspaces.place(address, to);
        if (stored !== undefined) await this.through.save(address, stored, epoch);
    }
}

/** What org changes need of people's state: removing namespaces and moving them, through the aggregate */
export type StateChanges = Pick<StateWriter, 'remove' | 'move'>;
