import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAggregate } from '@punyts/statenet';
import { pgWorkspaceStorage } from '@punyts/stateui-pg';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { Accounts } from '../accounts/Accounts.js';
import { Chats } from '../agent/Chats.js';
import { Grants } from '../sharing/Grants.js';
import { aggregateStorage, NamespaceWorkspaces, StateWriter } from '../statenet/StateNamespaces.js';
import { magneticTestDatabase } from '../testing/testDb.js';
import { AppAccess, moveAppToOrg } from './AppAccess.js';
import { OrgError, Orgs } from './Orgs.js';

let test: TestDatabase;
let orgs: Orgs;
let access: AppAccess;
let ana: string;
let ben: string;
let cai: string;

beforeEach(async () => {
    test = await magneticTestDatabase();
    orgs = new Orgs(test.db);
    access = new AppAccess(test.db);
    const accounts = new Accounts(test.db);
    ana = (await accounts.signIn({ provider: 'oidc', subject: 'ana' }, { name: 'Ana', email: 'ana@acme.test', emailVerified: true })).id;
    ben = (await accounts.signIn({ provider: 'oidc', subject: 'ben' }, { name: 'Ben', email: 'ben@acme.test', emailVerified: true })).id;
    cai = (await accounts.signIn({ provider: 'oidc', subject: 'cai' }, { name: 'Cai', email: 'cai@acme.test', emailVerified: false })).id;
});

afterEach(async () => {
    await test.drop();
});

async function appIn(workspaceId: string, name: string): Promise<string> {
    const storage = pgWorkspaceStorage(test.db, workspaceId);
    await storage.parts.create({ kind: 'themes', name: 'brand', body: { tokens: { color: { primary: 'red' } } } as never });
    const created = await storage.parts.create({ kind: 'apps', name, body: { home: 'home', themes: ['brand'], screens: { home: { root: { component: 'column' } } } } as never });
    if (created.kind !== 'created') throw new Error(created.kind);
    return created.part.id;
}

/** People's state changed as a server changes it: through an aggregate */
const stateOf = (): StateWriter => new StateWriter(test.db, new NamespaceWorkspaces(test.db), createAggregate(aggregateStorage(test.db, { embedRecords: false })));

const status = async (work: Promise<unknown>): Promise<number | undefined> => work.then(() => undefined).catch((error: unknown) => (error instanceof OrgError ? error.status : -1));

describe('Orgs', () => {
    it('should make an org with its workspace and its maker as owner, and refuse a slug that is taken', async () => {
        // Act
        const org = await orgs.create(ana, { name: 'Acme', slug: 'acme' });
        const taken = await status(orgs.create(ben, { name: 'Other', slug: 'acme' }));

        // Assert
        expect(org).toMatchObject({ name: 'Acme', slug: 'acme' });
        expect(await orgs.of(ana)).toEqual([expect.objectContaining({ id: org.id, role: 'owner', workspaceId: org.workspaceId })]);
        expect(taken).toBe(409);
        expect((await orgs.auditLog(ana, org.id)).map((event) => event['action'])).toEqual(['org.created']);
    });

    it("should keep an invite waiting for the person it names, to join or decline from their own page", async () => {
        // Arrange
        const org = await orgs.create(ana, { name: 'Acme', slug: 'acme' });
        const other = await orgs.create(ana, { name: 'Other', slug: 'other' });
        await orgs.invite(ana, org.id, { email: 'Ben@Acme.test', role: 'builder' });
        await orgs.invite(ana, other.id, { email: 'ben@acme.test', role: 'member' });
        await orgs.invite(ana, org.id, { email: 'cai@acme.test', role: 'member' });

        // Act
        const waiting = await orgs.pendingFor(ben);
        const unverified = await orgs.pendingFor(cai);
        const byOthers = await status(orgs.acceptInvite(waiting[0]!.id, cai));
        const declineByOthers = await status(orgs.decline(waiting[1]!.id, ana));
        const joined = await orgs.acceptInvite(waiting.find((invite) => invite.org.id === org.id)!.id, ben);
        await orgs.decline(waiting.find((invite) => invite.org.id === other.id)!.id, ben);
        const after = await orgs.pendingFor(ben);
        const again = await status(orgs.acceptInvite(waiting.find((invite) => invite.org.id === other.id)!.id, ben));

        // Assert
        expect(waiting.map((invite) => [invite.org.name, invite.role, invite.invitedBy])).toEqual([
            ['Other', 'member', 'Ana'],
            ['Acme', 'builder', 'Ana']
        ]);
        expect(unverified).toEqual([]);
        expect(byOthers).toBe(403);
        expect(declineByOthers).toBe(404);
        expect(joined.id).toBe(org.id);
        expect(await orgs.role(org.id, ben)).toBe('builder');
        expect(after).toEqual([]);
        expect(again).toBe(404);
        expect(await orgs.role(other.id, ben)).toBeUndefined();
    });

    it('should not show an invite to an org the person is in already, and stop the link of a declined invite', async () => {
        // Arrange
        const org = await orgs.create(ana, { name: 'Acme', slug: 'acme' });
        const declined = await orgs.invite(ana, org.id, { email: 'ben@acme.test', role: 'member' });
        const waiting = await orgs.pendingFor(ben);
        await orgs.decline(waiting[0]!.id, ben);
        const self = await orgs.invite(ana, org.id, { email: 'ana@acme.test', role: 'member' });

        // Act / Assert
        expect(await status(orgs.accept(declined.token, ben))).toBe(404);
        expect(await orgs.invitation(declined.token)).toBeUndefined();
        expect(await orgs.pendingFor(ana)).toEqual([]);
        expect(await orgs.invitation(self.token)).toBeDefined();
    });

    it('should let an invite be accepted once, only by its verified email, before it expires', async () => {
        // Arrange
        const org = await orgs.create(ana, { name: 'Acme', slug: 'acme' });
        const team = await orgs.createGroup(ana, org.id, 'Field Ops');
        const forBen = await orgs.invite(ana, org.id, { email: 'BEN@acme.test', role: 'builder', groups: [team.id] });
        const forCai = await orgs.invite(ana, org.id, { email: 'cai@acme.test', role: 'member' });

        // Act
        const wrongPerson = await status(orgs.accept(forBen.token, cai));
        await orgs.accept(forBen.token, ben);
        const again = await status(orgs.accept(forBen.token, ben));
        const unverified = await status(orgs.accept(forCai.token, cai));

        // Assert
        expect(wrongPerson).toBe(403);
        expect(again).toBe(404);
        expect(unverified).toBe(403);
        expect(await orgs.role(org.id, ben)).toBe('builder');
        expect(await orgs.groupIdsOf(org.id, ben)).toEqual([team.id]);
        expect(await orgs.role(org.id, cai)).toBeUndefined();
    });

    it('should keep roles to the people allowed to change them, and always keep an owner', async () => {
        // Arrange
        const org = await orgs.create(ana, { name: 'Acme', slug: 'acme' });
        await orgs.accept((await orgs.invite(ana, org.id, { email: 'ben@acme.test', role: 'admin' })).token, ben);

        // Act
        const adminMakesOwner = await status(orgs.setRole(ben, org.id, ben, 'owner'));
        const lastOwnerLeaves = await status(orgs.remove(ana, org.id, ana));
        const lastOwnerSteps = await status(orgs.setRole(ana, org.id, ana, 'member'));
        await orgs.setRole(ana, org.id, ben, 'owner');
        await orgs.remove(ana, org.id, ana);

        // Assert
        expect(adminMakesOwner).toBe(403);
        expect(lastOwnerLeaves).toBe(409);
        expect(lastOwnerSteps).toBe(409);
        expect((await orgs.members(ben, org.id)).map((member) => [member.name, member.role])).toEqual([['Ben', 'owner']]);
        expect((await orgs.auditLog(ben, org.id)).map((event) => event['action'])).toContain('member.left');
    });
});

describe('AppAccess', () => {
    it("should give owners and makers manage, and others the highest of their own and their groups' entries", async () => {
        // Arrange
        const org = await orgs.create(ana, { name: 'Acme', slug: 'acme' });
        await orgs.accept((await orgs.invite(ana, org.id, { email: 'ben@acme.test', role: 'member' })).token, ben);
        const app = await appIn(org.workspaceId, 'inventory');
        const team = await orgs.createGroup(ana, org.id, 'Ops');

        // Act
        const before = await access.permission(ben, org.workspaceId, app);
        await access.setOpenToOrg(ana, org.workspaceId, app, true);
        const open = await access.permission(ben, org.workspaceId, app);
        await access.set(ana, org.workspaceId, app, { kind: 'group', id: team.id }, 'edit');
        await orgs.setGroupMember(ana, org.id, team.id, ben, true);
        const viaGroup = await access.permission(ben, org.workspaceId, app);
        const benChanges = await status(access.set(ben, org.workspaceId, app, { kind: 'user', id: ben }, 'manage'));
        await orgs.setGroupMember(ana, org.id, team.id, ben, false);
        const afterGroup = await access.permission(ben, org.workspaceId, app);

        // Assert
        expect(await access.permission(ana, org.workspaceId, app)).toBe('manage');
        expect(before).toBeUndefined();
        expect(open).toBe('use');
        expect(viaGroup).toBe('edit');
        expect(benChanges).toBe(403);
        expect(afterGroup).toBe('use');
        expect(await access.permission(cai, org.workspaceId, app)).toBeUndefined();
        expect(await access.locate(ben, app)).toEqual({ workspaceId: org.workspaceId, orgId: org.id, permission: 'use' });
        expect(await access.locate(cai, app)).toBeUndefined();
    });
});

describe('moveAppToOrg', () => {
    it('should move an app with its id, instances, data, files, chat and links, and copy the parts it reaches', async () => {
        // Arrange
        const org = await orgs.create(ben, { name: 'Acme', slug: 'acme' });
        await orgs.accept((await orgs.invite(ben, org.id, { email: 'ana@acme.test', role: 'builder' })).token, ana);
        await appIn(org.workspaceId, 'tracker');
        const app = await appIn(ana, 'tracker');
        const mine = pgWorkspaceStorage(test.db, ana);
        await mine.instances(ana).write(app, {}, { route: { screen: 'edit' } });
        await mine.instances(ben).writeData(app, 'notes', { model: 'note', records: { a: { text: 'one' } } });
        await mine.fileStore.save(
            app,
            'f0000000-0000-4000-8000-000000000001',
            (async function* () {
                yield new TextEncoder().encode('hi');
            })(),
            100
        );
        await mine.files.add({ id: 'f0000000-0000-4000-8000-000000000001', appId: app, name: 'hi.txt', size: 2, type: 'text/plain', sha256: 'x' });
        await new Chats(test.db).append(ana, app, { role: 'person', text: 'Make it blue', at: new Date().toISOString() });
        const link = await new Grants(test.db).create(ana, { id: app, name: 'tracker' }, 'use', ana);

        // Act
        const moved = await moveAppToOrg(test.db, stateOf(), { userId: ana, appId: app, orgId: org.id, functions: [] });

        // Assert
        const theirs = pgWorkspaceStorage(test.db, org.workspaceId);
        expect(moved).toMatchObject({ appId: app, name: 'tracker-2', missingFunctions: [] });
        expect(await mine.parts.findById('apps', app)).toBeUndefined();
        expect(await mine.parts.findByName('themes', 'brand')).toBeDefined();
        expect((await theirs.parts.findById('apps', app))?.name).toBe('tracker-2');
        expect((await theirs.instances(ana).get(app)).value).toEqual({ route: { screen: 'edit' } });
        expect((await theirs.instances(ben).getData(app, 'notes')).value?.records).toEqual({ a: { text: 'one' } });
        expect(new TextDecoder().decode(await theirs.fileStore.read(app, 'f0000000-0000-4000-8000-000000000001'))).toBe('hi');
        expect((await new Chats(test.db).read(ana, app, org.workspaceId)).map((entry) => entry.text)).toEqual(['Make it blue']);
        expect((await new Grants(test.db).byToken(link.token))?.ownerId).toBe(org.workspaceId);
        expect(await access.locate(ana, app)).toEqual({ workspaceId: org.workspaceId, orgId: org.id, permission: 'manage' });
        expect((await orgs.auditLog(ben, org.id)).map((event) => event['action'])).toContain('app.moved_in');
    });

    it('should list the functions the moved app names that the server does not run, and record them', async () => {
        // Arrange
        const org = await orgs.create(ben, { name: 'Acme', slug: 'acme' });
        await orgs.accept((await orgs.invite(ben, org.id, { email: 'ana@acme.test', role: 'builder' })).token, ana);
        const logic = { computes: { tax: { inputs: {}, run: '$.functions.host.tax', outputs: {} } }, effects: { fetch: { request: '$.runtime.request', run: '$.functions.host.http', status: '$.runtime.status' } } };
        const created = await pgWorkspaceStorage(test.db, ana).parts.create({ kind: 'apps', name: 'shop', body: { home: 'home', screens: { home: { root: { component: 'column' } } }, logic } as never });
        if (created.kind !== 'created') throw new Error(created.kind);
        const http = { id: '00000000-0000-4000-8000-000000000001', path: '$.functions.host.http', kind: 'effect', runs: ['server'], summary: 'HTTP', inputs: {}, outputs: {} } as const;

        // Act
        const moved = await moveAppToOrg(test.db, stateOf(), { userId: ana, appId: created.part.id, orgId: org.id, functions: [http] });

        // Assert
        expect(moved.missingFunctions).toEqual(['$.functions.host.tax']);
        const event = (await orgs.auditLog(ben, org.id)).find((entry) => entry['action'] === 'app.moved_in');
        expect(event?.['detail']).toMatchObject({ missingFunctions: ['$.functions.host.tax'] });
    });

    it('should refuse a member who is not a builder, and leave the app where it was', async () => {
        // Arrange
        const org = await orgs.create(ben, { name: 'Acme', slug: 'acme' });
        await orgs.accept((await orgs.invite(ben, org.id, { email: 'ana@acme.test', role: 'member' })).token, ana);
        const app = await appIn(ana, 'diary');

        // Act
        const refused = await status(moveAppToOrg(test.db, stateOf(), { userId: ana, appId: app, orgId: org.id, functions: [] }));

        // Assert
        expect(refused).toBe(403);
        expect(await pgWorkspaceStorage(test.db, ana).parts.findById('apps', app)).toBeDefined();
    });
});
