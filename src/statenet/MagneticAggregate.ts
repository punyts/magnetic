import { generateGrantKey } from '@punyts/state-sync/authority';
import { startAggregateNode } from '@punyts/statenet';
import type { AggregateNode, DirectoryView } from '@punyts/statenet';
import type { Database } from '@punyts/stateui-pg';
import type { SecretBox } from '../auth/secrets.js';
import { readDirectoryView } from './directoryView.js';
import { aggregateStorage } from './StateNamespaces.js';
import { StatenetAuthority } from './StatenetNode.js';

export interface MagneticAggregateOptions {
    readonly nodeId: string;
    /** The address the relays' links come in on; default loopback */
    readonly host?: string;
    /** The port of the relays' links; 0 for any free one */
    readonly port: number;
    readonly region?: string;
    /** Whether a save queues the embeddings of the records it changes (search is on) */
    readonly embedRecords: boolean;
    /** How often it reads the directory again; 2 seconds by default */
    readonly rereadMs?: number;
    readonly report: (message: string, fields?: Record<string, unknown>) => void;
}

export interface MagneticAggregate {
    readonly nodeId: string;
    readonly url: string;
    readonly node: AggregateNode;
    close(): Promise<void>;
}

/** Half a node certificate's life: the aggregate signs its own again by then */
const RENEW_MS = 3.5 * 24 * 3_600_000;

/**
 * The statenet's aggregate for Magnetic (docs/design/statenet-network.md, S11): the one process that writes people's
 * state. Relays link up to it; it saves, loads and removes the namespaces their servers send, each in the workspace
 * `statenet_namespace` names, as a role that may write only the state tables. It signs its own certificate with the
 * statenet's authority, renews the relays' over their links and gives them the directory. It is not listed in the
 * directory itself: the relays find it by the URL they are given, and its role writes nothing but state
 */
export async function startMagneticAggregate(db: Database, box: SecretBox, options: MagneticAggregateOptions): Promise<MagneticAggregate> {
    const authority = new StatenetAuthority(db, box);
    const keys = generateGrantKey();
    const region = options.region ?? '';
    let certificate = (await authority.issue(options.nodeId, 'aggregate', keys.publicKey, region)).certificate;
    let certifiedAt = Date.now();
    const authorityPublicKey = (await authority.keys()).publicKey;
    let view: DirectoryView = await readDirectoryView(db);
    const node = await startAggregateNode({
        nodeId: options.nodeId,
        keys,
        certificate: () => certificate,
        authorityPublicKey,
        storage: aggregateStorage(db, { embedRecords: options.embedRecords }),
        directory: () => view,
        // a relay's next certificate, signed here: only for a relay, whose first one Magnetic made
        certify: async (presented, claims) => (claims.role === 'relay' ? authority.renew(presented) : undefined),
        ...(options.host === undefined ? {} : { host: options.host }),
        port: options.port,
        report: (message) => options.report(message, { node: options.nodeId })
    });
    const rereadMs = options.rereadMs ?? 2_000;
    const beat = setInterval(() => {
        void (async () => {
            const before = JSON.stringify(view);
            view = await readDirectoryView(db);
            if (JSON.stringify(view) !== before) node.mesh.directoryChanged();
            if (Date.now() - certifiedAt > RENEW_MS) {
                certificate = (await authority.issue(options.nodeId, 'aggregate', keys.publicKey, region)).certificate;
                certifiedAt = Date.now();
            }
        })().catch((error: unknown) => options.report('The aggregate could not read the directory', { node: options.nodeId, error: error instanceof Error ? error.message : String(error) }));
    }, rereadMs);
    beat.unref();
    options.report('Statenet aggregate started', { node: options.nodeId, mesh: node.url });
    let closed = false;
    return {
        nodeId: options.nodeId,
        url: node.url,
        node,
        close: async () => {
            if (closed) return;
            closed = true;
            clearInterval(beat);
            await node.close();
        }
    };
}
