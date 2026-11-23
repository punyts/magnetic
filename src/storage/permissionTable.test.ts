import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { Accounts } from '../accounts/Accounts.js';
import { magneticTestDatabase } from '../testing/testDb.js';
import { MAGNETIC_MIGRATIONS } from './db.js';

let test: TestDatabase;

beforeEach(async () => {
    test = await magneticTestDatabase();
});

afterEach(async () => {
    await test.drop();
});

/** The five tables as they were before 0024 */
const BEFORE = `
DROP TABLE permission;
CREATE TABLE link_grant (id uuid PRIMARY KEY, token text NOT NULL UNIQUE, workspace_id uuid NOT NULL, app_id uuid NOT NULL, app_name text NOT NULL, "right" text NOT NULL, created_by uuid, created_at timestamptz NOT NULL, revoked_at timestamptz);
CREATE TABLE link_grant_member (grant_id uuid NOT NULL REFERENCES link_grant (id) ON DELETE CASCADE, user_id uuid NOT NULL, first_opened_at timestamptz NOT NULL, PRIMARY KEY (grant_id, user_id));
CREATE TABLE app_access (workspace_id uuid NOT NULL, app_id uuid NOT NULL, principal_kind text NOT NULL, principal_id uuid NOT NULL, permission text NOT NULL, granted_by uuid, granted_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (workspace_id, app_id, principal_kind, principal_id));
CREATE TABLE app_setting (workspace_id uuid NOT NULL, app_id uuid NOT NULL, created_by uuid, open_to_org boolean NOT NULL DEFAULT false, PRIMARY KEY (workspace_id, app_id));
CREATE TABLE state_grant (id uuid PRIMARY KEY, kind text NOT NULL, issuer text NOT NULL, subject text NOT NULL, address text NOT NULL, prefix text NOT NULL, rights text[] NOT NULL, parent_grant uuid REFERENCES state_grant (id) ON DELETE CASCADE, org_id uuid, issued_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz, revoked_at timestamptz, last_used_at timestamptz);
`;

describe('migration 0024 (the permission table)', () => {
    it('should move app access, open and made apps, links and who opened them, and state grants into entries, give each org its admins, and drop the old tables', async () => {
        // Arrange: Ana's org Acme with Ben in it and a group; Ana's link to her own app, opened by Ben; Ana's grants
        await test.db.query(BEFORE);
        const accounts = new Accounts(test.db);
        const [ana, ben] = [(await accounts.signIn({ provider: 'dev', subject: 'ana' }, { name: 'Ana' })).id, (await accounts.signIn({ provider: 'dev', subject: 'ben' }, { name: 'Ben' })).id];
        const [org, orgSpace, orgApp, ownApp, group, link, share, passed, orgRead] = Array.from({ length: 9 }, () => randomUUID() as string) as [string, string, string, string, string, string, string, string, string];
        await test.db.query('INSERT INTO org (id, slug, name, created_by) VALUES ($1, $2, $3, $4)', [org, 'acme', 'Acme', ana]);
        await test.db.query("INSERT INTO workspace (id, kind, org_id) VALUES ($1, 'org', $2)", [orgSpace, org]);
        const n = async (sql: string, id: string): Promise<string> => (await test.db.query<{ n: string }>(sql, [id])).rows[0]?.n as string;
        const [acme, a, b] = [await n('SELECT owner_number::text AS n FROM org WHERE id = $1', org), await n('SELECT owner_number::text AS n FROM app_user WHERE id = $1', ana), await n('SELECT owner_number::text AS n FROM app_user WHERE id = $1', ben)];
        await test.db.query('INSERT INTO app_setting (workspace_id, app_id, created_by, open_to_org) VALUES ($1, $2, $3, true)', [orgSpace, orgApp, ana]);
        await test.db.query("INSERT INTO app_access (workspace_id, app_id, principal_kind, principal_id, permission, granted_by) VALUES ($1, $2, 'user', $3, 'edit', $4), ($1, $2, 'group', $5, 'view', $4)", [orgSpace, orgApp, ben, ana, group]);
        await test.db.query(`INSERT INTO link_grant (id, token, workspace_id, app_id, app_name, "right", created_by, created_at) VALUES ($1, 'tok', $2, $3, 'Notes', 'use', $2, now())`, [link, ana, ownApp]);
        await test.db.query('INSERT INTO link_grant_member (grant_id, user_id, first_opened_at) VALUES ($1, $2, now())', [link, ben]);
        await test.db.query("INSERT INTO state_grant (id, kind, issuer, subject, address, prefix, rights) VALUES ($1, 'share', $2, $3, $4, '$.data', '{read,write}')", [share, a, b, `${a}/apps/${ownApp}`]);
        await test.db.query("INSERT INTO state_grant (id, kind, issuer, subject, address, prefix, rights, parent_grant) VALUES ($1, 'passed', $2, 'someone', $3, '$.data.notes', '{read}', $4)", [passed, b, `${a}/apps/${ownApp}`, share]);
        await test.db.query("INSERT INTO state_grant (id, kind, issuer, subject, address, prefix, rights, org_id) VALUES ($1, 'org-read', $2, $3, $4, '$', '{read}', $5)", [orgRead, b, `org:${acme}`, `${b}/apps/*`, org]);
        const sql = await readFile(join(MAGNETIC_MIGRATIONS.dir, '0024_permission.sql'), 'utf8');

        // Act
        await test.db.query(sql);

        // Assert
        const entries = (
            await test.db.query<{ v: string }>("SELECT kind || ' ' || owner || ' ' || pattern || ' ' || subject || ' ' || array_to_string(rights, ',') || ' ' || coalesce(parent::text, '-') AS v FROM permission")
        ).rows.map((row) => row.v);
        expect(entries.sort()).toEqual(
            [
                `admins ${acme} $ members:${acme}.admin read,write,share -`,
                `creator ${acme} $.apps.${orgApp} owner:${a} read,write,share -`,
                `open ${acme} $.apps.${orgApp} members:${acme} read -`,
                `access.edit ${acme} $.apps.${orgApp} owner:${b} read,write -`,
                `access.view ${acme} $.apps.${orgApp} group:${acme}.${group} read -`,
                `link.use ${a} $.apps.${ownApp} link:${link} read -`,
                `opened ${a} $.apps.${ownApp} owner:${b} read ${link}`,
                `share ${a} $.apps.${ownApp}.data owner:${b} read,write -`,
                `passed ${a} $.apps.${ownApp}.data.notes owner:someone read ${share}`,
                `org-read ${b} $.apps.* members:${acme}.admin read -`
            ].sort()
        );
        const left = (await test.db.query<{ name: string }>("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('link_grant', 'link_grant_member', 'app_access', 'app_setting', 'state_grant')")).rows;
        expect(left).toEqual([]);
    });
});
