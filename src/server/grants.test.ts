import { checkAccess, readGrant } from '@punyts/state-sync/authority';
import type { PreviewBrowser } from '@punyts/stateui-mcp';
import { txInstances } from '@punyts/stateui-pg';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { orgSubject } from '../grants/StateGrants.js';
import type { StateGrants } from '../grants/StateGrants.js';
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

const APP = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('Grants of state', () => {
    let database: TestDatabase;
    let magnetic: RunningMagnetic;
    let grants: StateGrants;
    let alice: string;
    let bob: string;
    let carol: string;
    let aliceId: string;
    let bobId: string;
    let carolId: string;

    const json = (path: string, cookie: string, method: string, body?: unknown): Promise<Response> =>
        fetch(`${magnetic.origin}${path}`, { method, redirect: 'manual', headers: { Cookie: cookie, Origin: magnetic.origin, 'Content-Type': 'application/json' }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    const signIn = async (user: string): Promise<string> => {
        const response = await fetch(`${magnetic.origin}/signin/dev`, { method: 'POST', redirect: 'manual', headers: { Origin: magnetic.origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ user }).toString() });
        return (response.headers.get('set-cookie') ?? '').split(';')[0] as string;
    };
    const idOf = async (cookie: string): Promise<string> => (await magnetic.sessions.find(cookie.split('=')[1]))?.userId as string;
    const reads = (subject: string, token: string, address: string, path = '$.data.notes') => grants.check({ subject, grant: token }, { address, path, right: 'read' });

    beforeAll(async () => {
        database = await magneticTestDatabase();
        magnetic = await startMagnetic({ database: database.db, host: '127.0.0.1', port: 0, report: { info: () => undefined }, devUsers: ['alice', 'bob', 'carol'], starter: 'none', browser: noBrowser, secretKey: 'a test secret key of some length' });
        grants = magnetic.stateGrants as StateGrants;
        [alice, bob, carol] = [await signIn('alice'), await signIn('bob'), await signIn('carol')];
        [aliceId, bobId, carolId] = [await idOf(alice), await idOf(bob), await idOf(carol)];
    }, 60_000);

    afterAll(async () => {
        await magnetic.stop();
        await database.drop();
    });

    it('should share part of your state, let it be passed on only narrower, and revoke everything passed on with it', async () => {
        // Arrange
        const address = `${aliceId}/apps/${APP}`;

        // Act
        const shared = (await (await json('/grants', alice, 'POST', { subject: bobId, address, prefix: '$.data', rights: ['read', 'write'] })).json()) as { id: string; token: string };
        const passed = await json('/grants', bob, 'POST', { subject: carolId, address, prefix: '$.data.notes', rights: ['read'], parentId: shared.id });
        const wider = await json('/grants', bob, 'POST', { subject: carolId, address, prefix: '$', rights: ['read'], parentId: shared.id });
        const notMine = await json('/grants', bob, 'POST', { subject: carolId, address, prefix: '$.data', rights: ['read'] });
        const carolGrant = (await passed.json()) as { id: string; token: string };
        const before = [await reads(bobId, shared.token, address), await reads(carolId, carolGrant.token, address)];
        const revoked = (await (await json(`/grants/${shared.id}/revoke`, alice, 'POST')).json()) as { revoked: string[] };
        const after = [await reads(bobId, shared.token, address), await reads(carolId, carolGrant.token, address)];

        // Assert
        expect(passed.status).toBe(201);
        expect(wider.status).toBe(403);
        expect(notMine.status).toBe(403);
        expect(before).toEqual([{ ok: true }, { ok: true }]);
        expect(revoked.revoked.sort()).toEqual([shared.id, carolGrant.id].sort());
        expect(after).toEqual([{ ok: false, reason: 'revoked' }, { ok: false, reason: 'revoked' }]);
    });

    it('should show Shared by me, with the grants on your state and Revoke', async () => {
        // Arrange
        await json('/grants', alice, 'POST', { subject: carolId, address: `${aliceId}/apps/${APP}`, prefix: '$.data.notes', rights: ['read'] });

        // Act
        const page = await (await fetch(`${magnetic.origin}/settings/shared`, { headers: { Cookie: alice } })).text();
        const listed = (await (await json('/grants', alice, 'GET')).json()) as { available: boolean; grants: Array<{ subject: string; revokedAt?: string }> };

        // Assert
        expect(page).toContain('Shared by me');
        expect(page).toContain('carol');
        expect(page).toContain('Revoke');
        expect(listed.available).toBe(true);
        expect(listed.grants.filter((grant) => grant.subject === `owner:${magnetic.owners.of(carolId)}` && grant.revokedAt === undefined)).toHaveLength(1);
    });

    it('should keep verifying grants of a rotated key until they expire, and sign new ones with the new key', async () => {
        // Arrange
        const address = `${aliceId}/apps/${APP}`;
        const issued = (await (await json('/grants', alice, 'POST', { subject: bobId, address, prefix: '$.data', rights: ['read'] })).json()) as { id: string; token: string };

        // Act
        const rotated = (await (await json('/keys/rotate', alice, 'POST')).json()) as { kid: string };
        const fresh = (await (await json(`/grants/${issued.id}/token`, bob, 'POST')).json()) as { token: string };

        // Assert
        expect(await reads(bobId, issued.token, address)).toEqual({ ok: true });
        expect(readGrant(fresh.token)?.kid).toBe(rotated.kid);
        expect(readGrant(issued.token)?.kid).not.toBe(rotated.kid);
        expect(await reads(bobId, fresh.token, address)).toEqual({ ok: true });
    });

    it("should read a member's state for the org through its standing grant, audited, and revoke it when they leave", async () => {
        // Arrange
        const org = await magnetic.orgs.create(aliceId, { name: 'Acme', slug: 'acme-grants' });
        await magnetic.database.query("INSERT INTO org_member (org_id, user_id, role) VALUES ($1, $2, 'member')", [org.id, bobId]);
        const made = await json(`/orgs/${org.id}/apps`, alice, 'POST', { name: 'Tickets' });
        const appId = ((await made.json()) as { id: string }).id;
        await magnetic.database.transaction((tx) => txInstances(tx, org.workspaceId, bobId, magnetic.owners).write(appId, {}, { route: { screen: 'list' } } as never), { workspaceIds: [org.workspaceId] });

        // Act
        const viewed = await json(`/orgs/${org.id}/apps/${appId}/instances/${bobId}`, alice, 'GET');
        const grant = (await magnetic.database.query<{ id: string }>("SELECT id::text FROM permission WHERE kind = 'org-read' AND owner::text = $1", [magnetic.owners.of(bobId)])).rows[0]?.id as string;
        const event = (await magnetic.database.query<{ detail: { grantId?: string } }>("SELECT detail FROM audit_event WHERE org_id = $1 AND action = 'instance.support_view'", [org.id])).rows[0];
        const token = await grants.tokenFor(grant);
        await json(`/orgs/${org.id}/members/${bobId}`, bob, 'DELETE');
        const afterLeaving = await grants.check({ subject: orgSubject(org.id), grant: token }, { address: `${bobId}/apps/${appId}`, path: '$', right: 'read' });

        // Assert
        expect(viewed.status).toBe(200);
        expect(event?.detail.grantId).toBe(grant);
        expect(afterLeaving).toEqual({ ok: false, reason: 'revoked' });
    });

    it("should keep grants of members' state in the org's apps inside the org when its policy says so", async () => {
        // Arrange
        const org = await magnetic.orgs.create(aliceId, { name: 'Closed', slug: 'closed-grants' });
        await magnetic.database.query("INSERT INTO org_member (org_id, user_id, role) VALUES ($1, $2, 'builder')", [org.id, bobId]);
        const appId = ((await (await json(`/orgs/${org.id}/apps`, alice, 'POST', { name: 'Desk' })).json()) as { id: string }).id;
        await json(`/orgs/${org.id}/policy`, alice, 'POST', { grantsInOrg: true });

        // Act
        const outside = await json('/grants', bob, 'POST', { subject: carolId, address: `${bobId}/apps/${appId}`, prefix: '$', rights: ['read'] });
        const inside = await json('/grants', bob, 'POST', { subject: aliceId, address: `${bobId}/apps/${appId}`, prefix: '$', rights: ['read'] });

        // Assert
        expect(outside.status).toBe(403);
        expect(((await outside.json()) as { message: string }).message).toBe("The org's policy keeps grants of its apps' state in the org.");
        expect(inside.status).toBe(201);
    });

    describe("a binding's access to a dataset (docs/design/statenet-requests.md, R3b)", () => {
        it('should give a person one standing bound entry on the dataset, read and write, and the workspace itself access without a grant', async () => {
            // Act
            const first = await grants.boundAccess(bobId, aliceId, 'prices');
            const again = await grants.boundAccess(bobId, aliceId, 'prices');
            const owner = await grants.boundAccess('default', aliceId, 'prices');

            // Assert
            const claims = readGrant(first.grant as string);
            expect(claims).toMatchObject({ subject: magnetic.owners.of(bobId), owner: magnetic.owners.of(aliceId), pattern: '$.data.prices', rights: ['read', 'write'] });
            expect(readGrant(again.grant as string)?.entry).toBe(claims?.entry);
            expect(owner).toEqual({ subject: magnetic.owners.of(aliceId) });
            const address = `${owner.subject}/data/prices`;
            expect(checkAccess(first, { address, path: '$.data.records.tea', right: 'write' }, grants.accessContext())).toMatchObject({ ok: true });
            expect(checkAccess(first, { address: `${owner.subject}/data/other`, path: '$.data.records.tea', right: 'write' }, grants.accessContext())).toMatchObject({ ok: false });
            const listed = await grants.sharedBy(aliceId);
            expect(listed.some((entry) => entry.kind === 'bound')).toBe(false);
        });

        it('should refuse a bound grant once its entry is revoked, here at once and on another server once it reads the revocations', async () => {
            // Arrange
            const access = await grants.boundAccess(carolId, aliceId, 'stock');
            const entry = readGrant(access.grant as string)?.entry as string;
            const address = `${magnetic.owners.of(aliceId)}/data/stock`;

            // Act
            await grants.revoke(aliceId, entry);
            const here = checkAccess(access, { address, path: '$.data.records.tea', right: 'write' }, grants.accessContext());
            await grants.refreshRevoked();
            const reread = checkAccess(access, { address, path: '$.data.records.tea', right: 'write' }, grants.accessContext());

            // Assert
            expect(here).toEqual({ ok: false, reason: 'revoked' });
            expect(reread).toEqual({ ok: false, reason: 'revoked' });
        });
    });
});
