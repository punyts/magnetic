import { createStateUiTools } from '@punyts/stateui-mcp';
import type { PreviewBrowser } from '@punyts/stateui-mcp';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APPS } from '../apps/AppsPage.js';
import { EDITOR } from '../editor/EditorApp.js';
import { HOME } from '../home/HomeApp.js';
import { LOGIC } from '../logic/LogicPage.js';
import { SCREENS } from '../screens/ScreensPage.js';
import { startMagnetic } from '../server/startMagnetic.js';
import type { RunningMagnetic } from '../server/startMagnetic.js';
import { SIDE } from '../side/SidePage.js';
import { STATENET } from '../statenet/StatenetPage.js';
import { magneticTestDatabase } from '../testing/testDb.js';
import { THEME } from '../theme/ThemePage.js';
import { LINK, SIGN_IN } from './PageApps.js';
import { makePage } from './PageSpec.js';

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never;
const noBrowser = { open: async () => ({ rendered: false }), rendered: async () => [], screenshot: async () => ({}), interact: async () => ({}), closePage: async () => undefined, close: async () => undefined } as unknown as PreviewBrowser;
const WORKSPACE = '7c1f3a52-9b0d-4e7a-8c11-2f9e6d4b5a01';

describe("Magnetic's pages as StateUI apps", () => {
    let magnetic: RunningMagnetic;
    let test: TestDatabase;

    beforeAll(async () => {
        test = await magneticTestDatabase();
        magnetic = await startMagnetic({ database: test.db, host: '127.0.0.1', port: 0, report: silent, devUsers: ['alice'], starter: 'none', browser: noBrowser });
    }, 60_000);

    afterAll(async () => {
        await magnetic.stop();
        await test.drop();
    });

    it.each([SIGN_IN, LINK, APPS, EDITOR, HOME, LOGIC, SCREENS, SIDE, STATENET, THEME].map((spec) => [spec.name, spec] as const))(
        'should make %s with no error, every own state on its node and no data that is only a node’s state',
        async (_name, spec) => {
            // Arrange
            const tools = createStateUiTools(await magnetic.workspaces.get(WORKSPACE));

            // Act
            await makePage(tools, spec);
            const validated = (await tools.find((tool) => tool.name === 'ui_validate')!.run({ app: spec.name } as never)) as unknown as { body: { errors: unknown[]; warnings: { code: string; message: string }[] } };

            // Assert
            expect(validated.body.errors).toEqual([]);
            expect(validated.body.warnings.filter((warning) => warning.code === 'SUI-LINK-OWN').map((warning) => warning.message)).toEqual([]);
            expect(JSON.stringify(spec.definition())).not.toContain('"own:');
            const fields = new Set(Object.values(spec.models).flatMap((operations) => operations.map((operation) => String(operation['field']))));
            expect(Object.keys(spec.own).filter((path) => fields.has(path.split('.')[3] ?? '') && path.split('.').length === 4)).toEqual([]);
        },
        120_000
    );
});
