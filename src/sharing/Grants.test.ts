import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Grants } from './Grants.js';

const APP = { id: '00000000-0000-4000-8000-000000000001', name: 'notes' };

describe('Grants', () => {
    let dir: string;
    let clock: number;
    const grantsAt = (): Grants => new Grants(join(dir, 'grants.json'), () => new Date(clock++ * 1000));

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'grants-'));
        clock = 1;
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it('should make a link with a random token and find it again after a restart', async () => {
        // Arrange
        const grants = grantsAt();

        // Act
        const grant = await grants.create('owner', APP, 'use');
        const found = await grantsAt().byToken(grant.token);

        // Assert
        expect(grant.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
        expect(found).toEqual(grant);
        expect(await grants.byToken('not a token')).toBeUndefined();
    });

    it('should never make the owner a member, nor join a revoked link', async () => {
        // Arrange
        const grants = grantsAt();
        const grant = await grants.create('owner', APP, 'use');
        const other = await grants.create('owner', APP, 'view');
        await grants.revoke('owner', other.id);

        // Act
        await grants.join(grant.id, 'owner');
        await grants.join(other.id, 'bob');

        // Assert
        expect((await grants.byToken(grant.token))?.members).toEqual({});
        expect((await grants.byToken(other.token))?.members).toEqual({});
    });

    it('should prefer a live use link to a view link, and fall back to a revoked one', async () => {
        // Arrange
        const grants = grantsAt();
        const view = await grants.create('owner', APP, 'view');
        const use = await grants.create('owner', APP, 'use');
        await grants.join(view.id, 'bob');
        await grants.join(use.id, 'bob');

        // Act
        const both = await grants.access(APP.id, 'bob');
        await grants.revoke('owner', use.id);
        const viewOnly = await grants.access(APP.id, 'bob');
        await grants.revoke('owner', view.id);
        const none = await grants.access(APP.id, 'bob');

        // Assert
        expect(both).toEqual({ live: expect.objectContaining({ id: use.id }) });
        expect(viewOnly).toEqual({ live: expect.objectContaining({ id: view.id }) });
        expect(none).toEqual({ revoked: expect.objectContaining({ id: view.id }) });
        expect(await grants.access(APP.id, 'carol')).toBeUndefined();
    });

    it('should give no access to the app through a remix link, and list only live shared apps', async () => {
        // Arrange
        const grants = grantsAt();
        const remix = await grants.create('owner', APP, 'remix');
        await grants.join(remix.id, 'bob');
        const use = await grants.create('owner', { id: '00000000-0000-4000-8000-000000000002', name: 'diary' }, 'use');
        await grants.join(use.id, 'bob');

        // Act
        const access = await grants.access(APP.id, 'bob');
        const shared = await grants.sharedWith('bob');

        // Assert
        expect(access).toBeUndefined();
        expect(shared.map((grant) => grant.appName)).toEqual(['diary']);
    });

    it("should refuse to revoke another owner's link", async () => {
        // Arrange
        const grants = grantsAt();
        const grant = await grants.create('owner', APP, 'use');

        // Act
        const revoked = await grants.revoke('mallory', grant.id);

        // Assert
        expect(revoked).toBeUndefined();
        expect((await grants.byToken(grant.token))?.revokedAt).toBeUndefined();
    });
});
