import { randomBytes } from 'node:crypto';
import type { PreviewBrowser } from '@punyts/stateui-mcp';
import { createDatabase, grantAppRole } from '@punyts/stateui-pg';
import type { Database } from '@punyts/stateui-pg';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { magneticTestDatabase } from '../testing/testDb.js';
import { startMagnetic } from './startMagnetic.js';
import type { RunningMagnetic } from './startMagnetic.js';

const noBrowser: PreviewBrowser = {
    open: async () => ({ rendered: false }),
    screenshot: async () => {
        throw new Error('no browser in this test');
    },
    interact: async () => {
        throw new Error('no browser in this test');
    },
    rendered: async () => {
        throw new Error('no browser in this test');
    },
    closePage: async () => undefined,
    close: async () => undefined
};

describe('A server connected as the application role', () => {
    const role = `app_${randomBytes(4).toString('hex')}`;
    const bypassing = `${role}_rls`;
    let test: TestDatabase;
    let asRole: Database;
    let magnetic: RunningMagnetic;
    let canMakeRoles = true;

    const signIn = async (user: string): Promise<string> => {
        const response = await fetch(`${magnetic.origin}/signin/dev`, { method: 'POST', redirect: 'manual', headers: { Origin: magnetic.origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ user }).toString() });
        return (response.headers.get('set-cookie') ?? '').split(';')[0] as string;
    };

    beforeAll(async () => {
        test = await magneticTestDatabase();
        try {
            await test.db.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
            await test.db.query(`CREATE ROLE ${bypassing} NOLOGIN NOSUPERUSER BYPASSRLS`);
        } catch {
            // The test database's user may not make roles (a non-superuser run of the suite)
            canMakeRoles = false;
            return;
        }
        await grantAppRole(test.db, role);
        // The superuser of the test database takes the role for every connection, as a login of it would be
        asRole = createDatabase({ url: test.url, config: { options: `${test.config.options} -c role=${role}`, max: 5 } });
        magnetic = await startMagnetic({ database: asRole, host: '127.0.0.1', port: 0, report: { info: () => undefined }, devUsers: ['alice', 'bob'], starter: 'showcase', browser: noBrowser });
    });

    afterAll(async () => {
        await magnetic?.stop();
        await asRole?.close();
        if (canMakeRoles) {
            // Its grants go first, or the role cannot be dropped
            await test.db.query(`DROP OWNED BY ${role}, ${bypassing}`);
            await test.db.query(`DROP ROLE ${role}, ${bypassing}`);
        }
        await test.drop();
    });

    it('should sign people in and make their workspaces', async (context) => {
        if (!canMakeRoles) context.skip();

        // Act
        const alice = await signIn('alice');
        const bob = await signIn('bob');
        const home = await fetch(`${magnetic.origin}/`, { headers: { Cookie: alice } });
        const bobsHome = await fetch(`${magnetic.origin}/`, { headers: { Cookie: bob } });

        // Assert
        expect(alice).toMatch(/^magnetic_session=/);
        expect(home.status).toBe(200);
        expect(bobsHome.status).toBe(200);
        const all = await test.db.query<{ count: string }>('SELECT count(*) FROM part');
        expect(Number(all.rows[0]?.count)).toBeGreaterThan(0);
    });

    it('should see no workspace rows outside a transaction that names its workspaces', async (context) => {
        if (!canMakeRoles) context.skip();

        // Act
        const seen = await asRole.query<{ count: string }>('SELECT count(*) FROM part');

        // Assert
        expect(Number(seen.rows[0]?.count)).toBe(0);
    });

    it('should not change the schema', async (context) => {
        if (!canMakeRoles) context.skip();

        // Act and assert
        await expect(asRole.query('CREATE TABLE intruder (id int)')).rejects.toThrow(/permission denied/);
        await expect(asRole.query('DROP TABLE part')).rejects.toThrow(/must be owner/);
    });

    it('should refuse a role that row-level security would not hold', async (context) => {
        if (!canMakeRoles) context.skip();

        // Act and assert
        await expect(grantAppRole(test.db, bypassing)).rejects.toThrow('BYPASSRLS');
        await expect(grantAppRole(test.db, 'no_such_role_here')).rejects.toThrow('No role');
    });
});
