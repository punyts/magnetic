import type { GrantKey } from '@punyts/state-sync/authority';
import type { DirectoryView } from '@punyts/statenet';
import { PgDirectory } from '@punyts/stateui-pg';
import type { Database } from '@punyts/stateui-pg';

/** The owner of the owner_key row that signs node certificates */
export const STATENET_AUTHORITY = 'statenet';

/**
 * The statenet as the database lists it (docs/design/statenet-relays.md, "The directory"): every node with its role,
 * region, endpoint, key, group and parent, and every owner's grant-signing key. A server reads it for its peers; the
 * aggregate gives it to the relays linked to it, which have no database
 */
export async function readDirectoryView(db: Database): Promise<DirectoryView> {
    const nodes = await new PgDirectory(db).nodes();
    const keyRows = (await db.query<{ kid: string; owner_id: string; public_key: string; retired_at: Date | null }>('SELECT kid, owner_id, public_key, retired_at FROM owner_key WHERE owner_id <> $1', [STATENET_AUTHORITY])).rows;
    const keys: Record<string, GrantKey> = {};
    for (const row of keyRows) keys[row.kid] = { ownerId: row.owner_id, publicKey: row.public_key, ...(row.retired_at !== null && { retiredAt: row.retired_at.getTime() }) };
    return {
        nodes: nodes.map((node) => ({
            id: node.id,
            role: node.role,
            region: node.region ?? '',
            endpoint: node.endpoint ?? '',
            ...(node.publicKey === undefined || node.publicKey === '' ? {} : { publicKey: node.publicKey }),
            ...(node.group === undefined ? {} : { group: node.group }),
            ...(node.parent === undefined ? {} : { parent: node.parent })
        })),
        owners: {},
        keys
    };
}
