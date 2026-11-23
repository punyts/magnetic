import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { Accounts } from '../accounts/Accounts.js';
import { Orgs } from '../orgs/Orgs.js';
import { magneticTestDatabase } from '../testing/testDb.js';
import { groupSubject, membersSubject, ownerSubject, PermissionError, Permissions } from './Permissions.js';

let test: TestDatabase;
let clock: number;
let permissions: Permissions;
let ana: string;
let ben: string;
let cai: string;
const number = async (userId: string): Promise<string> => (await test.db.query<{ n: string }>('SELECT owner_number::text AS n FROM app_user WHERE id = $1', [userId])).rows[0]?.n as string;

beforeEach(async () => {
    test = await magneticTestDatabase();
    clock = Date.parse('2026-11-22T10:00:00Z');
    permissions = new Permissions(test.db, () => new Date(clock));
    const accounts = new Accounts(test.db);
    ana = (await accounts.signIn({ provider: 'dev', subject: 'ana' }, { name: 'Ana' })).id;
    ben = (await accounts.signIn({ provider: 'dev', subject: 'ben' }, { name: 'Ben' })).id;
    cai = (await accounts.signIn({ provider: 'dev', subject: 'cai' }, { name: 'Cai' })).id;
});

afterEach(async () => {
    await test.drop();
});

describe('Permissions', () => {
    it('should allow the owner everything, and anyone else only what an entry that holds covers, with its right', async () => {
        // Arrange: Ana gives Ben the notes of her app a1, for an hour
        const owner = await number(ana);
        const entry = await permissions.make({ owner, pattern: '$.apps.a1.data.notes', subject: ownerSubject(await number(ben)), rights: ['read'], kind: 'share', until: new Date(clock + 3_600_000) });

        // Act
        const below = await permissions.allows(ben, owner, '$.apps.a1.data.notes.n1', 'read');
        const above = await permissions.allows(ben, owner, '$.apps.a1.data', 'read');
        const beside = await permissions.allows(ben, owner, '$.apps.a1.files', 'read');
        const write = await permissions.allows(ben, owner, '$.apps.a1.data.notes', 'write');
        const stranger = await permissions.allows(cai, owner, '$.apps.a1.data.notes', 'read');
        const own = await permissions.allows(ana, owner, '$.apps.a9', 'share');
        clock += 2 * 3_600_000;
        const expired = await permissions.allows(ben, owner, '$.apps.a1.data.notes', 'read');

        // Assert
        expect(entry).toMatchObject({ owner, pattern: '$.apps.a1.data.notes', rights: ['read'], kind: 'share' });
        expect([below, above, beside, write, stranger, own, expired]).toEqual([true, false, false, false, false, true, false]);
    });

    it("should reach a person through their org's members, roles and groups, and as the org only outside the org's own tree", async () => {
        // Arrange: Ana's org Acme, with Ben a member in the group Sales and Cai an admin; Ben shares a dataset with Acme
        const org = await new Orgs(test.db).create(ana, { name: 'Acme', slug: 'acme' });
        await test.db.query("INSERT INTO org_member (org_id, user_id, role) VALUES ($1, $2, 'member'), ($1, $3, 'admin')", [org.id, ben, cai]);
        const sales = await new Orgs(test.db).createGroup(ana, org.id, 'Sales');
        await new Orgs(test.db).setGroupMember(ana, org.id, sales.id, ben, true);
        const acme = (await permissions.numberOf(org.id)) as string;
        await permissions.make({ owner: acme, pattern: '$.apps.open', subject: membersSubject(acme), rights: ['read'], kind: 'open' });
        await permissions.make({ owner: acme, pattern: '$.apps.sales', subject: groupSubject(acme, sales.id), rights: ['read', 'write'], kind: 'access.edit' });
        await permissions.make({ owner: acme, pattern: '$.apps.mine', subject: ownerSubject(acme), rights: ['read'], kind: 'share' });
        const benNumber = await number(ben);
        await permissions.make({ owner: benNumber, pattern: '$.data.prices', subject: ownerSubject(acme), rights: ['read'], kind: 'share' });

        // Act
        const opened = await Promise.all([ben, cai].map((who) => permissions.allows(who, acme, '$.apps.open', 'read')));
        const grouped = [await permissions.allows(ben, acme, '$.apps.sales', 'write'), await permissions.allows(ben, acme, '$.apps.open', 'write')];
        const admins = await Promise.all([ben, cai, ana].map((who) => permissions.allows(who, acme, '$.apps.sales.files', 'share')));
        const inOwnTree = await permissions.allows(ben, acme, '$.apps.mine', 'read');
        const forTheOrg = await permissions.allows(cai, benNumber, '$.data.prices', 'read');

        // Assert
        expect(opened).toEqual([true, true]);
        expect(grouped).toEqual([true, false]);
        expect(admins).toEqual([false, true, true]);
        expect(inOwnTree).toBe(false);
        expect(forTheOrg).toBe(true);
    });

    it('should pass an entry on only narrower, and revoke everything passed on from it', async () => {
        // Arrange: Ana shares her app a1 with Ben, who passes its notes on to Cai
        const owner = await number(ana);
        const root = await permissions.make({ owner, pattern: '$.apps.a1', subject: ownerSubject(await number(ben)), rights: ['read', 'write'], kind: 'share', until: new Date(clock + 3_600_000) });
        const caiSubject = ownerSubject(await number(cai));
        const passed = await permissions.make({ owner, pattern: '$.apps.a1.data.notes', subject: caiSubject, rights: ['read'], kind: 'passed', parent: root.id, until: new Date(clock + 7_200_000) });
        const wider = [
            { pattern: '$.apps.*', rights: ['read'] as const },
            { pattern: '$.apps.a1', rights: ['read', 'share'] as const }
        ];

        // Act
        const refused = await Promise.all(
            wider.map((each) =>
                permissions
                    .make({ owner, pattern: each.pattern, subject: caiSubject, rights: [...each.rights], kind: 'passed', parent: root.id })
                    .then(() => 'made')
                    .catch((error: unknown) => (error instanceof PermissionError ? error.status : 'other'))
            )
        );
        const before = await permissions.allows(cai, owner, '$.apps.a1.data.notes.n1', 'read');
        const revoked = await permissions.revoke(root.id, ana);
        const after = await permissions.allows(cai, owner, '$.apps.a1.data.notes.n1', 'read');

        // Assert
        expect(passed.until).toBe(root.until);
        expect(refused).toEqual([403, 403]);
        expect(before).toBe(true);
        expect(revoked.sort()).toEqual([root.id, passed.id].sort());
        expect(after).toBe(false);
        expect((await permissions.get(passed.id))?.revokedBy).toBe(ana);
    });

    it("should end a person's bound entries under an owner when the last link they opened there is revoked", async () => {
        // Arrange: Ben opened two of Ana's links and writes her menu through a bound entry; Cai has one of his own
        const owner = await number(ana);
        const benSubject = ownerSubject(await number(ben));
        const links = await Promise.all(['$.apps.a1', '$.apps.a2'].map((pattern) => permissions.make({ owner, pattern, subject: 'everyone', rights: ['read'], kind: 'link.use' })));
        for (const link of links) await permissions.make({ owner, pattern: link.pattern, subject: benSubject, rights: ['read'], kind: 'opened', parent: link.id });
        const caiLink = await permissions.make({ owner, pattern: '$.apps.a3', subject: 'everyone', rights: ['read'], kind: 'link.use' });
        await permissions.make({ owner, pattern: '$.apps.a3', subject: ownerSubject(await number(cai)), rights: ['read'], kind: 'opened', parent: caiLink.id });
        const bound = await permissions.make({ owner, pattern: '$.data.menu', subject: benSubject, rights: ['read', 'write'], kind: 'bound' });
        const caiBound = await permissions.make({ owner, pattern: '$.data.menu', subject: ownerSubject(await number(cai)), rights: ['read', 'write'], kind: 'bound' });

        // Act
        const first = await permissions.revoke(links[0]?.id ?? '', ana);
        const second = await permissions.revoke(links[1]?.id ?? '', ana);

        // Assert
        expect(first).not.toContain(bound.id);
        expect(second).toContain(bound.id);
        expect((await permissions.get(bound.id))?.revokedBy).toBe(ana);
        expect((await permissions.get(caiBound.id))?.revokedAt).toBeUndefined();
    });

    it("should end a member's bound entries on the org's datasets when they leave it", async () => {
        // Arrange: Ben, a member of Ana's org Acme, writes its catalog through a bound entry
        const org = await new Orgs(test.db).create(ana, { name: 'Acme', slug: 'acme' });
        await test.db.query("INSERT INTO org_member (org_id, user_id, role) VALUES ($1, $2, 'member')", [org.id, ben]);
        const acme = (await permissions.numberOf(org.id)) as string;
        const bound = await permissions.make({ owner: acme, pattern: '$.data.catalog', subject: ownerSubject(await number(ben)), rights: ['read', 'write'], kind: 'bound' });

        // Act
        await new Orgs(test.db).remove(ana, org.id, ben);

        // Assert
        expect((await permissions.get(bound.id))?.revokedAt).toBeDefined();
    });
});
