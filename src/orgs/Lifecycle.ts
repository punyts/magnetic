import { PgStateStore } from '@punyts/stateui-pg';
import type { Database } from '@punyts/stateui-pg';
import { audit, OrgError } from './Orgs.js';
import type { Orgs } from './Orgs.js';

const STATE = new PgStateStore();

/** The tables that hold a workspace's rows, each by `workspace_id`, deleted with an org */
const WORKSPACE_TABLES = ['embedding_job', 'embedding', 'preview_error', 'app_file_content', 'app_file', 'state_change', 'state_node', 'namespace_head', 'part', 'chat_entry', 'app_access', 'app_setting', 'workspace_stamp', 'link_grant'] as const;

/**
 * Everything an org holds, for its owners to keep or move elsewhere: the org, its members and groups, its policies and
 * domains (without their tokens), its apps and every other part (screens, logic, models, datasets), each app's access
 * list, each person's state of each app (by statenet address, records included), and the audit log. File bytes are left out; their names and sizes are
 * in. Written to the audit log
 */
export async function exportOrg(db: Database, orgs: Orgs, actorId: string, orgId: string): Promise<Record<string, unknown>> {
    await orgs.require(orgId, actorId, 'owner');
    const org = await orgs.get(orgId);
    if (org === undefined) throw new OrgError(404, 'No such org.');
    const workspaceId = org.workspaceId;
    const data = await db.transaction(
        async (tx) => {
            const rows = async (sql: string, params: unknown[] = [workspaceId]): Promise<unknown[]> => (await tx.query(sql, params)).rows;
            return {
                parts: await rows('SELECT kind, id, name, revision, body, created_at, updated_at FROM part WHERE workspace_id = $1 ORDER BY kind, name'),
                // Each person's state of each app, by statenet address, read back in key order
                states: await Promise.all(
                    (await tx.query<{ address: string; revision: string | number; updated_at: Date }>('SELECT address, revision, updated_at FROM namespace_head WHERE workspace_id = $1 ORDER BY address', [workspaceId])).rows.map(async (head) => {
                        const read = await STATE.read(tx, head.address);
                        return { address: head.address, revision: Number(head.revision), updatedAt: head.updated_at, state: read.value ?? {}, meta: Object.fromEntries(read.meta) };
                    })
                ),
                files: await rows('SELECT app_id, id, name, size, type, created_at FROM app_file WHERE workspace_id = $1 ORDER BY app_id, created_at')
            };
        },
        { workspaceIds: [workspaceId] }
    );
    const rows = async (sql: string, params: unknown[]): Promise<unknown[]> => (await db.query(sql, params)).rows;
    const exported = {
        format: 'magnetic-org-export/2',
        exportedAt: new Date().toISOString(),
        org: { id: org.id, slug: org.slug, name: org.name, createdAt: org.createdAt },
        members: await orgs.members(actorId, orgId),
        groups: await orgs.groups(actorId, orgId),
        policy: (await rows('SELECT policy FROM org_policy WHERE org_id = $1', [orgId]))[0] ?? { policy: {} },
        domains: await rows('SELECT domain, verified_at FROM org_domain WHERE org_id = $1 ORDER BY domain', [orgId]),
        access: await rows('SELECT app_id, principal_kind, principal_id, permission, granted_at FROM app_access WHERE workspace_id = $1 ORDER BY app_id', [workspaceId]),
        appSettings: await rows('SELECT app_id, created_by, open_to_org FROM app_setting WHERE workspace_id = $1 ORDER BY app_id', [workspaceId]),
        ...data,
        audit: await rows('SELECT id, actor_id, action, target_kind, target_id, detail, ip, at FROM audit_event WHERE org_id = $1 ORDER BY id', [orgId])
    };
    await audit(db, { orgId, workspaceId, actorId, action: 'org.exported', targetKind: 'org', targetId: orgId });
    return exported;
}

/**
 * Deletes an org and every row of its workspace, in one transaction: its apps and parts, state, files, chats, links,
 * access, members, groups, invites, domains, provider and policies. The person must be an owner and type the org's
 * short name to confirm. The audit log keeps its events, and the deletion is its last one. Answers the org's workspace,
 * whose open views the caller closes
 */
export async function deleteOrg(db: Database, orgs: Orgs, actorId: string, orgId: string, confirm: string): Promise<{ readonly workspaceId: string; readonly members: readonly string[] }> {
    await orgs.require(orgId, actorId, 'owner');
    const org = await orgs.get(orgId);
    if (org === undefined) throw new OrgError(404, 'No such org.');
    if (confirm.trim().toLowerCase() !== org.slug) throw new OrgError(400, `Type the org's short name (${org.slug}) to delete it.`);
    const workspaceId = org.workspaceId;
    return db.transaction(
        async (tx) => {
            const members = (await tx.query<{ user_id: string }>('SELECT user_id FROM org_member WHERE org_id = $1', [orgId])).rows.map((row) => row.user_id);
            for (const table of WORKSPACE_TABLES) await tx.query(`DELETE FROM ${table} WHERE workspace_id = $1`, [workspaceId]);
            // The workspace, members, groups, invites, domains, provider, policies and the org's identities go with the org
            await tx.query('DELETE FROM org WHERE id = $1', [orgId]);
            await audit(tx, { orgId, workspaceId, actorId, action: 'org.deleted', targetKind: 'org', targetId: orgId, detail: { name: org.name, slug: org.slug, members: members.length } });
            return { workspaceId, members };
        },
        { workspaceIds: [workspaceId] }
    );
}
