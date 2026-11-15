import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PART_KINDS } from '@punyts/stateui-mcp';
import { PgUiInstanceRepository, txWorkspaceDb } from '@punyts/stateui-pg';
import type { Database, Queryable } from '@punyts/stateui-pg';

/** What an import wrote, for the command's report */
export interface ImportReport {
    users: number;
    identities: number;
    sessions: number;
    grants: number;
    spend: number;
    chats: number;
    /** Workspaces copied, and those skipped because the database already had them */
    workspaces: number;
    workspacesSkipped: number;
    parts: number;
    instances: number;
    files: number;
    /** Things the import left out, and why */
    skipped: string[];
}

interface FileUser {
    id: string;
    name: string;
    email?: string;
    picture?: string;
    createdAt: string;
}

interface FileGrant {
    id: string;
    token: string;
    ownerId: string;
    appId: string;
    appName: string;
    right: string;
    createdAt: string;
    revokedAt?: string;
    members: Record<string, string>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readJson<T>(path: string): Promise<T | undefined> {
    try {
        return JSON.parse(await readFile(path, 'utf8')) as T;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw new Error(`${path} is not JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
}

async function folders(path: string): Promise<string[]> {
    try {
        return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
    }
}

/**
 * Copies the people of a file data folder of an earlier Magnetic into the database: `accounts.json` (users and
 * identities), `sessions.json` (live sessions), `grants.json` (links and who opened them), `budgets.json` (spend, as
 * one ledger row per user and day, and per month for spend no day still holds), every chat
 * (`users/<id>/magnetic/chats/<appId>.json`), and each user's workspace (`users/<id>`: parts, instances, persona
 * records, files with their bytes and preview errors). Rows already in the database are left as they are, and a
 * workspace that already has parts is skipped, so running it twice writes nothing the second time. The folder is only
 * read
 */
export async function importPeople(db: Database, dataDir: string, now: Date = new Date()): Promise<ImportReport> {
    const report: ImportReport = { users: 0, identities: 0, sessions: 0, grants: 0, spend: 0, chats: 0, workspaces: 0, workspacesSkipped: 0, parts: 0, instances: 0, files: 0, skipped: [] };
    await db.transaction(async (tx) => {
        await importAccounts(tx, dataDir, report);
        await importSessions(tx, dataDir, now, report);
        await importGrants(tx, dataDir, report);
        await importBudgets(tx, dataDir, report);
        await importChats(tx, dataDir, report);
    });
    for (const userId of await folders(join(dataDir, 'users'))) {
        if (!UUID.test(userId)) continue;
        await db.transaction((tx) => importWorkspace(tx, join(dataDir, 'users', userId), userId.toLowerCase(), report), { workspaceIds: [userId.toLowerCase()] });
    }
    return report;
}

async function files(path: string): Promise<string[]> {
    try {
        return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
    }
}

/**
 * Copies one user's workspace folder (stateui-mcp's `PartFolders` layout) into the workspace tables: every part as it
 * is, each persona's instances and binding records, the apps' files with their bytes, and their preview errors. A
 * workspace that already has a part is skipped whole
 */
async function importWorkspace(tx: Queryable, dir: string, workspaceId: string, report: ImportReport): Promise<void> {
    const has = (await tx.query<{ found: boolean }>('SELECT EXISTS (SELECT 1 FROM part WHERE workspace_id = $1) AS found', [workspaceId])).rows[0]?.found === true;
    if (has) {
        report.workspacesSkipped++;
        return;
    }
    let copied = false;
    for (const kind of PART_KINDS) {
        for (const name of (await files(join(dir, kind))).filter((file) => file.endsWith('.json')).sort()) {
            const part = await readJson<{ id: string; name: string; revision: number; createdAt: string; updatedAt: string; body: object }>(join(dir, kind, name));
            if (part === undefined || !UUID.test(part.id)) continue;
            await tx.query('INSERT INTO part (workspace_id, kind, id, name, revision, body, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING', [
                workspaceId,
                kind,
                part.id.toLowerCase(),
                part.name,
                part.revision,
                JSON.stringify(part.body),
                part.createdAt,
                part.updatedAt
            ]);
            report.parts++;
            copied = true;
        }
    }
    for (const persona of await folders(join(dir, 'personas'))) {
        for (const owner of await folders(join(dir, 'personas', persona, 'apps'))) {
            for (const name of (await files(join(dir, 'personas', persona, 'apps', owner))).filter((file) => file.endsWith('.json'))) {
                const appId = name.slice(0, -'.json'.length);
                const diff = await readJson<object>(join(dir, 'personas', persona, 'apps', owner, name)).catch(() => undefined);
                if (!UUID.test(appId) || diff === undefined) continue;
                // Stored as it was: the diff over an empty definition is the diff itself
                await new PgUiInstanceRepository(txWorkspaceDb(tx, workspaceId), persona).write(appId.toLowerCase(), {}, diff as never);
                report.instances++;
            }
        }
        for (const appId of await folders(join(dir, 'personas', persona, 'data'))) {
            if (!UUID.test(appId)) continue;
            for (const name of (await files(join(dir, 'personas', persona, 'data', appId))).filter((file) => file.endsWith('.json'))) {
                // A capital is kept as ^ and its small letter, so two bindings never share a file on a case-blind disk
                const binding = name.slice(0, -'.json'.length).replace(/\^([a-z])/g, (_match, letter: string) => letter.toUpperCase());
                const dataset = await readJson<{ model: string; records: object }>(join(dir, 'personas', persona, 'data', appId, name)).catch(() => undefined);
                if (dataset === undefined || typeof dataset.model !== 'string') continue;
                await new PgUiInstanceRepository(txWorkspaceDb(tx, workspaceId), persona).writeData(appId.toLowerCase(), binding, { model: dataset.model, records: (dataset.records ?? {}) as never });
            }
        }
    }
    for (const appId of (await folders(dir)).filter((name) => UUID.test(name))) {
        const index = (await readJson<Array<{ id: string; name: string; size: number; type: string; sha256: string; createdAt: string }>>(join(dir, appId, 'files.json')).catch(() => undefined)) ?? [];
        for (const file of index) {
            const bytes = await readFile(join(dir, appId, 'files', file.id.toLowerCase())).catch(() => undefined);
            if (bytes === undefined) {
                report.skipped.push(`file ${file.id} of app ${appId}: its bytes are missing`);
                continue;
            }
            await tx.query('INSERT INTO app_file (workspace_id, app_id, id, name, size, type, sha256, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING', [
                workspaceId,
                appId.toLowerCase(),
                file.id.toLowerCase(),
                file.name,
                file.size,
                file.type,
                file.sha256,
                file.createdAt
            ]);
            await tx.query('INSERT INTO app_file_content (workspace_id, app_id, file_id, bytes) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [workspaceId, appId.toLowerCase(), file.id.toLowerCase(), bytes]);
            report.files++;
        }
        const errors = await readJson<unknown[]>(join(dir, appId, 'errors.json')).catch(() => undefined);
        if (Array.isArray(errors) && errors.length > 0) {
            await tx.query('INSERT INTO preview_error (workspace_id, app_id, entries) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [workspaceId, appId.toLowerCase(), JSON.stringify(errors)]);
        }
    }
    if (copied) report.workspaces++;
}

async function importAccounts(tx: Queryable, dataDir: string, report: ImportReport): Promise<void> {
    const file = await readJson<{ users: Record<string, FileUser>; identities: Record<string, string> }>(join(dataDir, 'accounts.json'));
    if (file === undefined) return;
    for (const user of Object.values(file.users)) {
        const inserted = await tx.query(
            'INSERT INTO app_user (id, name, email, picture, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING',
            [user.id, user.name, user.email ?? null, user.picture ?? null, user.createdAt]
        );
        report.users += inserted.rowCount ?? 0;
    }
    for (const [key, userId] of Object.entries(file.identities)) {
        const colon = key.indexOf(':');
        if (colon <= 0 || file.users[userId] === undefined) {
            report.skipped.push(`identity ${key}: no such user`);
            continue;
        }
        const inserted = await tx.query('INSERT INTO identity (provider, subject, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [key.slice(0, colon), key.slice(colon + 1), userId]);
        report.identities += inserted.rowCount ?? 0;
    }
}

async function importSessions(tx: Queryable, dataDir: string, now: Date, report: ImportReport): Promise<void> {
    const file = await readJson<Record<string, { userId: string; createdAt: string; expiresAt: string }>>(join(dataDir, 'sessions.json'));
    if (file === undefined) return;
    for (const [hash, session] of Object.entries(file)) {
        if (Date.parse(session.expiresAt) <= now.getTime()) continue;
        const inserted = await tx.query(
            'INSERT INTO session (token_hash, user_id, created_at, expires_at) SELECT $1, $2, $3, $4 WHERE EXISTS (SELECT 1 FROM app_user WHERE id = $2) ON CONFLICT DO NOTHING',
            [hash, session.userId, session.createdAt, session.expiresAt]
        );
        report.sessions += inserted.rowCount ?? 0;
    }
}

async function importGrants(tx: Queryable, dataDir: string, report: ImportReport): Promise<void> {
    const file = await readJson<Record<string, FileGrant>>(join(dataDir, 'grants.json'));
    if (file === undefined) return;
    for (const grant of Object.values(file)) {
        if (!UUID.test(grant.ownerId) || !UUID.test(grant.appId)) {
            report.skipped.push(`link ${grant.id}: its owner or app is not a UUID`);
            continue;
        }
        const inserted = await tx.query(
            `INSERT INTO link_grant (id, token, workspace_id, app_id, app_name, "right", created_by, created_at, revoked_at)
             VALUES ($1, $2, $3, $4, $5, $6, $3, $7, $8) ON CONFLICT DO NOTHING`,
            [grant.id, grant.token, grant.ownerId, grant.appId, grant.appName, grant.right, grant.createdAt, grant.revokedAt ?? null]
        );
        report.grants += inserted.rowCount ?? 0;
        for (const [userId, at] of Object.entries(grant.members)) {
            await tx.query('INSERT INTO link_grant_member (grant_id, user_id, first_opened_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [grant.id, userId, at]);
        }
    }
}

async function importBudgets(tx: Queryable, dataDir: string, report: ImportReport): Promise<void> {
    const file = await readJson<{ days: Record<string, Record<string, number>>; months: Record<string, number> }>(join(dataDir, 'budgets.json'));
    if (file === undefined) return;
    // The ledger already holds imported spend: a second import adds nothing
    const done = (await tx.query<{ found: boolean }>("SELECT EXISTS (SELECT 1 FROM agent_request WHERE model = 'imported') AS found")).rows[0]?.found === true;
    if (done) return;
    const dayTotals = new Map<string, number>();
    for (const [day, users] of Object.entries(file.days)) {
        for (const [userId, dollars] of Object.entries(users)) {
            if (!UUID.test(userId) || dollars <= 0) continue;
            await tx.query("INSERT INTO agent_request (user_id, model, dollars, at) VALUES ($1, 'imported', $2, $3)", [userId, dollars, `${day}T12:00:00Z`]);
            dayTotals.set(day.slice(0, 7), (dayTotals.get(day.slice(0, 7)) ?? 0) + dollars);
            report.spend++;
        }
    }
    // A month's spend that its days no longer hold (days are kept a week) is one row of no user
    for (const [month, dollars] of Object.entries(file.months)) {
        const rest = dollars - (dayTotals.get(month) ?? 0);
        if (rest <= 0.000001) continue;
        await tx.query("INSERT INTO agent_request (user_id, model, dollars, at) VALUES ('00000000-0000-0000-0000-000000000000', 'imported', $1, $2)", [rest, `${month}-01T00:00:00Z`]);
        report.spend++;
    }
}

async function importChats(tx: Queryable, dataDir: string, report: ImportReport): Promise<void> {
    const usersDir = join(dataDir, 'users');
    for (const userId of await folders(usersDir)) {
        if (!UUID.test(userId)) continue;
        const chatsDir = join(usersDir, userId, 'magnetic', 'chats');
        let files: string[];
        try {
            files = (await readdir(chatsDir)).filter((name) => name.endsWith('.json'));
        } catch {
            continue;
        }
        for (const name of files) {
            const appId = name.slice(0, -'.json'.length);
            if (!UUID.test(appId)) continue;
            const known = (await tx.query<{ found: boolean }>('SELECT EXISTS (SELECT 1 FROM chat_entry WHERE workspace_id = $1 AND app_id = $2 AND user_id = $1) AS found', [userId, appId])).rows[0]?.found === true;
            if (known) continue;
            const entries = (await readJson<Array<Record<string, unknown>>>(join(chatsDir, name))) ?? [];
            for (const entry of entries) {
                const agent = entry['role'] === 'agent';
                await tx.query('INSERT INTO chat_entry (workspace_id, app_id, user_id, role, text, tools, outcome, message, at) VALUES ($1, $2, $1, $3, $4, $5, $6, $7, $8)', [
                    userId,
                    appId,
                    agent ? 'agent' : 'person',
                    String(entry['text'] ?? ''),
                    agent ? JSON.stringify(entry['tools'] ?? []) : null,
                    agent ? String(entry['outcome'] ?? 'finished') : null,
                    agent && typeof entry['message'] === 'string' ? entry['message'] : null,
                    String(entry['at'] ?? new Date(0).toISOString())
                ]);
                report.chats++;
            }
        }
    }
}
