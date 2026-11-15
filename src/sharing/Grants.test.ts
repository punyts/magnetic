import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { magneticTestDatabase } from '../testing/testDb.js';
import { Grants } from './Grants.js';

const OWNER = '00000000-0000-4000-8000-0000000000b1';
const BOB = '00000000-0000-4000-8000-0000000000b2';
const CAROL = '00000000-0000-4000-8000-0000000000b3';
const MALLORY = '00000000-0000-4000-8000-0000000000b4';
const APP = { id: '00000000-0000-4000-8000-000000000001', name: 'notes' };

describe('Grants', () => {
    let test: TestDatabase;
    let clock: number;
    const grantsAt = (): Grants => new Grants(test.db, () => new Date(clock++ * 1000));

    beforeEach(async () => {
        test = await magneticTestDatabase();
        clock = 1;
    });

    afterEach(async () => {
        await test.drop();
    });

    it('should make a link with a random token and find it again after a restart', async () => {
        // Arrange
        const grants = grantsAt();

        // Act
        const grant = await grants.create(OWNER, APP, 'use');
        const found = await grantsAt().byToken(grant.token);

        // Assert
        expect(grant.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
        expect(found).toEqual(grant);
        expect(await grants.byToken('not a token')).toBeUndefined();
    });

    it('should never make the owner a member, nor join a revoked link', async () => {
        // Arrange
        const grants = grantsAt();
        const grant = await grants.create(OWNER, APP, 'use');
        const other = await grants.create(OWNER, APP, 'view');
        await grants.revoke(OWNER, other.id);

        // Act
        await grants.join(grant.id, OWNER);
        await grants.join(other.id, BOB);

        // Assert
        expect((await grants.byToken(grant.token))?.members).toEqual({});
        expect((await grants.byToken(other.token))?.members).toEqual({});
    });

    it('should prefer a live use link to a view link, and fall back to a revoked one', async () => {
        // Arrange
        const grants = grantsAt();
        const view = await grants.create(OWNER, APP, 'view');
        const use = await grants.create(OWNER, APP, 'use');
        await grants.join(view.id, BOB);
        await grants.join(use.id, BOB);

        // Act
        const both = await grants.access(APP.id, BOB);
        await grants.revoke(OWNER, use.id);
        const viewOnly = await grants.access(APP.id, BOB);
        await grants.revoke(OWNER, view.id);
        const none = await grants.access(APP.id, BOB);

        // Assert
        expect(both).toEqual({ live: expect.objectContaining({ id: use.id }) });
        expect(viewOnly).toEqual({ live: expect.objectContaining({ id: view.id }) });
        expect(none).toEqual({ revoked: expect.objectContaining({ id: view.id }) });
        expect(await grants.access(APP.id, CAROL)).toBeUndefined();
    });

    it('should give no access to the app through a remix link, and list only live shared apps', async () => {
        // Arrange
        const grants = grantsAt();
        const remix = await grants.create(OWNER, APP, 'remix');
        await grants.join(remix.id, BOB);
        const use = await grants.create(OWNER, { id: '00000000-0000-4000-8000-000000000002', name: 'diary' }, 'use');
        await grants.join(use.id, BOB);

        // Act
        const access = await grants.access(APP.id, BOB);
        const shared = await grants.sharedWith(BOB);

        // Assert
        expect(access).toBeUndefined();
        expect(shared.map((grant) => grant.appName)).toEqual(['diary']);
    });

    it("should refuse to revoke another owner's link", async () => {
        // Arrange
        const grants = grantsAt();
        const grant = await grants.create(OWNER, APP, 'use');

        // Act
        const revoked = await grants.revoke(MALLORY, grant.id);

        // Assert
        expect(revoked).toBeUndefined();
        expect((await grants.byToken(grant.token))?.revokedAt).toBeUndefined();
    });
});
