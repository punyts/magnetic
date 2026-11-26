import type { PreviewBrowser } from '@punyts/stateui-mcp';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contractGaps } from '../pages/PageSpec.js';
import { startMagnetic } from '../server/startMagnetic.js';
import type { RunningMagnetic } from '../server/startMagnetic.js';
import { magneticTestDatabase } from '../testing/testDb.js';
import { FIELD_TYPES, SIDE, SIDE_BLANK, SIDE_FIELDS, SIDE_HEARING, SIDE_RECORDS } from './SidePage.js';

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never;
const noBrowser = { open: async () => ({ rendered: false }), rendered: async () => [], screenshot: async () => ({}), interact: async () => ({}), closePage: async () => undefined, close: async () => undefined } as unknown as PreviewBrowser;

interface Node {
    component: string;
    children?: Record<string, Node>;
    columns?: Record<string, { cell?: Node }>;
    row?: Node;
    options?: Record<string, unknown>;
    on?: Record<string, unknown>;
    [link: `<-${string}`]: unknown;
}

describe("The side panel's data", () => {
    it('should keep each field in one namespace with a model and a binding of its own, and hear the fields at their paths', () => {
        // Arrange
        const definition = SIDE.definition() as { data: Record<string, { model: string }> };
        const namespaces = Object.keys(definition.data);

        // Act
        const linked = [...new Set(JSON.stringify(definition).match(/\$\.data\.[A-Za-z]+/g) ?? [])].map((path) => path.slice('$.data.'.length));
        const heard = Object.values(SIDE_HEARING).flatMap((entry) => [entry.keep, entry.from]).filter((path): path is string => path !== undefined && path.startsWith('$.'));

        // Assert
        expect(namespaces).toEqual(['part', 'links', 'form', 'code', 'dataset', 'model', 'connection']);
        expect(namespaces).toEqual(Object.keys(SIDE_RECORDS));
        expect(linked.filter((name) => definition.data[name] === undefined)).toEqual([]);
        expect(JSON.stringify(definition)).not.toContain('$.data.side');
        expect(SIDE_FIELDS['title']).toBe('$.data.part.title');
        expect(SIDE_FIELDS['records']).toBe('$.data.dataset.records');
        expect(SIDE_FIELDS['baseUrl']).toBe('$.data.connection.baseUrl');
        expect(Object.keys(SIDE_FIELDS).sort()).toEqual(Object.keys(SIDE_BLANK).sort());
        for (const [field, path] of Object.entries(SIDE_FIELDS)) {
            const [, , namespace, name] = path.split('.');
            expect(name, path).toBe(field);
            expect(SIDE_BLANK[field], path).toEqual(SIDE_RECORDS[namespace as string]?.[field]);
            // A field is in its namespace's model, or it is a node's own state and left the model
            const inModel = SIDE.models[definition.data[namespace as string]?.model ?? '']?.some((operation) => operation['field'] === field) === true;
            expect(inModel || SIDE.own[path] !== undefined, path).toBe(true);
        }
        for (const namespace of namespaces) expect(SIDE.models[definition.data[namespace]?.model ?? '']?.length, namespace).toBeGreaterThan(0);
        expect(heard.sort()).toEqual([
            '$.data.code.code',
            '$.data.code.code',
            '$.data.connection.baseUrl',
            '$.data.connection.baseUrl',
            '$.data.connection.secret',
            '$.data.connection.secret',
            '$.data.form.form',
            '$.data.form.form.choice',
            '$.data.form.form.choice',
            '$.data.form.form.name',
            '$.data.form.form.second'
        ]);
        expect(Object.keys(SIDE.sample ?? {}).filter((path) => path.startsWith('$.data.')).sort()).toEqual(['$.data.dataset', '$.data.form', '$.data.part']);
    });
});

describe("The side panel's page", () => {
    let magnetic: RunningMagnetic;
    let test: TestDatabase;
    let alice: string;

    beforeAll(async () => {
        test = await magneticTestDatabase();
        magnetic = await startMagnetic({ database: test.db, host: '127.0.0.1', port: 0, report: silent, devUsers: ['alice'], starter: 'none', browser: noBrowser });
        const response = await fetch(`${magnetic.origin}/signin/dev`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ user: 'alice' }).toString(), redirect: 'manual' });
        alice = (response.headers.get('set-cookie') ?? '').split(';')[0] as string;
    }, 60_000);

    afterAll(async () => {
        await magnetic.stop();
        await test.drop();
    });

    it('should serve a signed-in person the panel of every kind of part, in every language, with every node id of its contract', async () => {
        // Act
        const anonymous = await fetch(`${magnetic.origin}/assets/side.json`);
        const served = await fetch(`${magnetic.origin}/assets/side.json`, { headers: { Cookie: alice } });
        const body = (await served.json()) as { document: { screens: { home: { root: Node; locales?: Record<string, unknown> } } } };

        // Assert
        expect(anonymous.status).toBe(401);
        expect(served.status).toBe(200);
        const home = body.document.screens.home;
        expect(Object.keys(home.locales ?? {}).sort()).toEqual(['de', 'es', 'fr']);
        expect(contractGaps(SIDE, body.document)).toEqual([]);
        const root = home.root.children ?? {};
        expect(root['head']?.children?.['close']).toMatchObject({ '@id': 'close' });
        expect(root['records']?.columns?.['value']?.cell).toMatchObject({ component: 'input', '<-value': '$row.value', '@id': 'cell' });
        expect(SIDE_HEARING['cell.change']).toEqual({ name: 'cell', from: 'row', merge: 'value' });
        expect(Object.keys(root['fields']?.row?.children?.['type']?.options ?? {})).toEqual([...FIELD_TYPES]);
        expect(root['form']?.children?.['submit']).toMatchObject({ '@id': 'submit' });
        expect(SIDE_HEARING['submit.press']).toEqual({ name: 'submit', from: '$.data.form.form' });
        // Every section starts hidden: the blank hides them all
        expect(Object.entries(SIDE_BLANK).filter(([name, value]) => /^no[A-Z]/.test(name) && value !== true)).toEqual([]);
    }, 60_000);
});
