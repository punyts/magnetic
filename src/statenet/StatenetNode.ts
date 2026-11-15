import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { ClaimPolicy, generateGrantKey } from '@punyts/state-sync/authority';
import type { Authority, GrantKey, NamespaceHost } from '@punyts/state-sync/authority';
import { issueNodeCertificate, startOwnerMesh } from '@punyts/statenet';
import type { DirectoryView, KeyPair, NodeRole, OwnerMesh } from '@punyts/statenet';
import type { InstancePlacement, PartKind, Services } from '@punyts/stateui-mcp';
import { listenToPartChanges, PgDirectory, PgOwnershipStore } from '@punyts/stateui-pg';
import type { Database, PartChanges } from '@punyts/stateui-pg';
import type { SecretBox } from '../auth/secrets.js';

/** The owner of the owner_key row that signs node certificates */
export const STATENET_AUTHORITY = 'statenet';
/** How long a node certificate lasts; a server issues its own at every start */
const CERTIFICATE_MS = 30 * 24 * 3_600_000;

/** How a Magnetic server takes part in the statenet with the others on its database */
export interface StatenetOptions {
    /** This server's node id; default its host name and a random suffix */
    readonly nodeId?: string;
    /** The address the mesh listens on; default the server's own host */
    readonly meshHost?: string;
    /** The port of the mesh; 0 for any free one */
    readonly meshPort: number;
    /** The URL the other servers and relays link to, as they reach this one (`ws://magnetic-2:4310`); default the one it listens on */
    readonly meshUrl?: string;
    readonly region?: string;
    /** How long a server's ownership of a namespace lasts without renewal; 10 seconds by default */
    readonly leaseMs?: number;
    /** How often the server heartbeats and reads the directory again; 2 seconds by default */
    readonly heartbeatMs?: number;
}

/**
 * The certificate authority of Magnetic's statenet (docs/design/statenet-relays.md, "The mesh protocol"): an Ed25519
 * key pair kept as an owner_key row of `statenet`, sealed with the server's key. Every server on the database signs its
 * own certificate with it at start, and `magnetic relay-certificate` signs the relays'
 */
export class StatenetAuthority {
    constructor(
        private readonly db: Database,
        private readonly box: SecretBox
    ) {}

    /** The authority's key pair, made by the first server that needs it; servers that start at once agree on one */
    async keys(): Promise<KeyPair> {
        const newest = async (): Promise<KeyPair | undefined> => {
            const row = (await this.db.query<{ public_key: string; private_key: string }>('SELECT public_key, private_key FROM owner_key WHERE owner_id = $1 AND retired_at IS NULL ORDER BY created_at, kid LIMIT 1', [STATENET_AUTHORITY])).rows[0];
            return row === undefined ? undefined : { publicKey: row.public_key, privateKey: this.box.open(row.private_key) };
        };
        const found = await newest();
        if (found !== undefined) return found;
        const pair = generateGrantKey();
        await this.db.query('INSERT INTO owner_key (kid, owner_id, public_key, private_key) VALUES ($1, $2, $3, $4)', [randomUUID(), STATENET_AUTHORITY, pair.publicKey, this.box.seal(pair.privateKey)]);
        // two servers that made one at once both read back the oldest, so they sign with the same authority
        return (await newest()) as KeyPair;
    }

    /** A node certificate signed by the authority, and the authority's public key that checks it */
    async issue(nodeId: string, role: NodeRole, publicKey: string, region = ''): Promise<{ certificate: string; authorityPublicKey: string }> {
        const authority = await this.keys();
        return { certificate: issueNodeCertificate({ nodeId, role, region, publicKey, expires: Date.now() + CERTIFICATE_MS }, authority.privateKey), authorityPublicKey: authority.publicKey };
    }
}

/** What the node needs of the server: its workspaces, opened on first use */
export interface StatenetWorkspaces {
    get(workspaceId: string): Promise<Services>;
    /** The workspace's services if it is open now; undefined otherwise */
    peek(workspaceId: string): Promise<Services> | undefined;
    /** Every workspace open now */
    open(): Array<Promise<Services>>;
}

export interface StatenetNode {
    readonly nodeId: string;
    readonly mesh: OwnerMesh;
    /** What each workspace's services place their instances with */
    readonly placement: InstancePlacement;
    /** The name the server's part changes are announced under (`announceAs`) */
    readonly announceAs: string;
    /** Reads the directory again now */
    refresh(): Promise<void>;
    stop(): Promise<void>;
}

/**
 * Starts a Magnetic server's node of the statenet (docs/design/statenet-relays.md, "Topology, in steps", 2 and 3): it
 * registers in the directory and heartbeats, signs its own node certificate, runs an owner node of its instances with
 * the mesh the other servers and relays link to, and hears the part changes the other servers make. The instance of a
 * namespace this server takes over is started in the workspace `statenet_namespace` names
 */
export async function startStatenetNode(db: Database, box: SecretBox, workspaces: StatenetWorkspaces, options: StatenetOptions, report: (message: string, fields?: Record<string, unknown>) => void): Promise<StatenetNode> {
    const nodeId = options.nodeId ?? `${hostname().toLowerCase().replace(/[^a-z0-9-]+/g, '-')}-${randomUUID().slice(0, 8)}`;
    const region = options.region ?? '';
    const heartbeatMs = options.heartbeatMs ?? 2_000;
    const keys: KeyPair = generateGrantKey();
    const { certificate, authorityPublicKey } = await new StatenetAuthority(db, box).issue(nodeId, 'owner', keys.publicKey, region);
    const directory = new PgDirectory(db);
    let view: DirectoryView = { nodes: [], owners: {}, keys: {} };
    /** The workspaces of namespaces this server placed, so it records each once */
    const recorded = new Map<string, string>();

    const record = async (address: string, workspaceId: string): Promise<void> => {
        if (recorded.get(address) === workspaceId) return;
        await db.query('INSERT INTO statenet_namespace (address, workspace_id) VALUES ($1, $2) ON CONFLICT (address) DO UPDATE SET workspace_id = EXCLUDED.workspace_id, updated_at = now() WHERE statenet_namespace.workspace_id <> EXCLUDED.workspace_id', [address, workspaceId]);
        recorded.set(address, workspaceId);
    };
    const workspaceOf = async (address: string): Promise<string | undefined> => {
        const known = recorded.get(address);
        if (known !== undefined) return known;
        const row = (await db.query<{ workspace_id: string }>('SELECT workspace_id FROM statenet_namespace WHERE address = $1', [address])).rows[0];
        return row?.workspace_id;
    };

    const host: NamespaceHost = {
        authority: async (address): Promise<Authority> => {
            const workspaceId = await workspaceOf(address);
            if (workspaceId === undefined) throw new Error(`No workspace is known for ${address}`);
            const authority = await (await workspaces.get(workspaceId)).hostInstance(address);
            if (authority === undefined) throw new Error(`No app at ${address}`);
            return authority;
        },
        release: async (address) => {
            const workspaceId = await workspaceOf(address);
            const services = workspaceId === undefined ? undefined : await workspaces.peek(workspaceId)?.catch(() => undefined);
            await services?.releaseInstance(address);
        }
    };

    const readDirectory = async (): Promise<void> => {
        const nodes = await directory.nodes();
        const keyRows = (await db.query<{ kid: string; owner_id: string; public_key: string; retired_at: Date | null }>('SELECT kid, owner_id, public_key, retired_at FROM owner_key WHERE owner_id <> $1', [STATENET_AUTHORITY])).rows;
        const grantKeys: Record<string, GrantKey> = {};
        for (const row of keyRows) grantKeys[row.kid] = { ownerId: row.owner_id, publicKey: row.public_key, ...(row.retired_at !== null && { retiredAt: row.retired_at.getTime() }) };
        const before = JSON.stringify(view.nodes);
        view = { nodes: nodes.map((node) => ({ id: node.id, role: node.role, region: node.region ?? '', endpoint: node.endpoint ?? '' })), owners: {}, keys: grantKeys };
        if (JSON.stringify(view.nodes) !== before) mesh?.directoryChanged();
    };

    let mesh: OwnerMesh | undefined;
    mesh = await startOwnerMesh({
        nodeId,
        region,
        keys,
        certificate,
        authorityPublicKey,
        ownership: new PgOwnershipStore(db),
        host,
        directory: () => view,
        policy: new ClaimPolicy(),
        ...(options.leaseMs === undefined ? {} : { leaseMs: options.leaseMs }),
        ...(options.meshHost === undefined ? {} : { listenHost: options.meshHost }),
        port: options.meshPort,
        report: (message) => report(message, { node: nodeId })
    });
    const running = mesh;
    await directory.register({ id: nodeId, role: 'owner', region, endpoint: options.meshUrl ?? running.url, publicKey: keys.publicKey, protocol: 1 });
    await readDirectory();

    const beat = setInterval(() => {
        void (async () => {
            if (!(await directory.heartbeat(nodeId))) await directory.register({ id: nodeId, role: 'owner', region, endpoint: options.meshUrl ?? running.url, publicKey: keys.publicKey, protocol: 1 });
            await directory.sweep(heartbeatMs * 5);
            await readDirectory();
            // a workspace whose instances this server owns stays open while they are owned, though their views are at other servers
            for (const address of running.node.owned()) {
                const workspaceId = recorded.get(address);
                if (workspaceId !== undefined && workspaces.peek(workspaceId) !== undefined) void workspaces.get(workspaceId).catch(() => undefined);
            }
        })().catch((error: unknown) => report('The statenet heartbeat failed', { node: nodeId, error: error instanceof Error ? error.message : String(error) }));
    }, heartbeatMs);
    beat.unref();

    /** Where a namespace is: placed again after the directory is read once more, when its owner was not known yet */
    const placed = async <T>(work: () => Promise<T>): Promise<T> => {
        try {
            return await work();
        } catch (error) {
            await readDirectory();
            return work().catch(() => {
                throw error;
            });
        }
    };

    const placement: InstancePlacement = {
        claim: async (address, workspaceId) => {
            await record(address, workspaceId);
            return placed(() => running.node.claim(address));
        },
        epochOf: (address) => running.node.epochOf(address),
        connect: async (address, workspaceId, connection, access, here) => {
            await record(address, workspaceId);
            return placed(() => running.connect(address, connection, access, here));
        },
        upstream: running.relay
    };

    const changes: PartChanges = await listenToPartChanges(
        db,
        nodeId,
        (notice) => {
            void workspaces
                .peek(notice.workspaceId)
                ?.then((services) => services.partChangedElsewhere(notice.kind as PartKind, notice.name))
                .catch((error: unknown) => report('A part change from another server was not taken', { node: nodeId, error: error instanceof Error ? error.message : String(error) }));
        },
        {
            onResync: () => {
                for (const open of workspaces.open()) void open.then((services) => services.resyncParts()).catch(() => undefined);
            },
            report: (message) => report(message, { node: nodeId })
        }
    );

    report('Statenet node started', { node: nodeId, mesh: options.meshUrl ?? running.url });
    let stopped = false;
    return {
        nodeId,
        mesh: running,
        placement,
        announceAs: nodeId,
        refresh: readDirectory,
        stop: async () => {
            if (stopped) return;
            stopped = true;
            clearInterval(beat);
            await changes.close();
            await running.close();
            // what this server owned is free at once for the others, rather than when its leases run out
            await db.query('UPDATE namespace_owner SET lease_until = now() WHERE node = $1', [nodeId]).catch(() => undefined);
            await db.query('DELETE FROM statenet_node WHERE id = $1', [nodeId]).catch(() => undefined);
        }
    };
}
