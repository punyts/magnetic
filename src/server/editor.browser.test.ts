import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStateUiTools } from '@punyts/stateui-mcp';
import type { PreviewBrowser, UiToolDefinition } from '@punyts/stateui-mcp';
import { chromium } from 'playwright';
import type { Browser, FrameLocator, Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startMagnetic } from './startMagnetic.js';
import type { RunningMagnetic } from './startMagnetic.js';

const installed = existsSync(chromium.executablePath());
const silent = { info: () => undefined };
const HOME = '$.screens.home';

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

async function signIn(origin: string, user: string): Promise<string> {
    const response = await fetch(`${origin}/signin/dev`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ user }).toString(), redirect: 'manual' });
    return (response.headers.get('set-cookie') ?? '').split(';')[0] as string;
}

async function tool(tools: readonly UiToolDefinition[], name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const outcome = await tools.find((candidate) => candidate.name === name)?.run(args as never);
    if (outcome === undefined || outcome.isError) throw new Error(`${name}: ${JSON.stringify(outcome?.body)}`);
    return outcome.body as Record<string, unknown>;
}

/** Where a node of the app is on the page: a point inside its box, at fractions of its width and height */
async function pointOf(page: Page, path: string, across = 0.5, down = 0.5): Promise<{ x: number; y: number }> {
    // Runs in the page (this package has no DOM types): the node's box in the frame, through the canvas zoom
    const script = `(async () => {
        const answer = await window.stateuiHost.inspect({ paths: [${JSON.stringify(path)}] });
        const node = answer && answer.nodes.find((candidate) => candidate.path === ${JSON.stringify(path)});
        if (!node) return undefined;
        const artboard = document.getElementById('artboard');
        const box = artboard.getBoundingClientRect();
        const zoom = box.width / artboard.offsetWidth;
        return { x: box.left + (node.rect.x + node.rect.width * ${across}) * zoom, y: box.top + (node.rect.y + node.rect.height * ${down}) * zoom };
    })()`;
    const point = (await page.evaluate(script)) as { x: number; y: number } | undefined;
    if (point === undefined) throw new Error(`${path} is not on the page`);
    return point;
}

/** The label of the selection outline on the overlay */
async function selectedLabel(page: Page): Promise<string> {
    return (await page.locator('#overlay .box.selected .tag').textContent({ timeout: 5000 })) ?? '';
}

describe.skipIf(!installed)("The editor's inspector in a browser (Chromium through Playwright)", () => {
    let dataDir: string;
    let magnetic: RunningMagnetic;
    let browser: Browser;
    let page: Page;
    let inspector: FrameLocator;
    let alice: string;
    let aliceId: string;
    let appId: string;
    let tools: readonly UiToolDefinition[];

    const app = async (): Promise<{ revision: number; root: Record<string, unknown> }> => {
        const view = await (await magnetic.workspaces.get(aliceId)).instanceViews.find(appId);
        const document = view?.body as unknown as { screens: { home: { root: Record<string, unknown> } } };
        return { revision: view?.revision as number, root: document.screens.home.root };
    };
    const childrenOf = (node: Record<string, unknown>, ...keys: string[]): string[] => {
        let at = node;
        for (const key of keys) at = (at['children'] as Record<string, Record<string, unknown>>)[key] as Record<string, unknown>;
        return Object.keys((at['children'] as Record<string, unknown>) ?? {});
    };
    /** Waits for the next revision and for the page to show it */
    const nextRevision = async (from: number): Promise<void> => {
        await expect.poll(async () => (await app()).revision, { timeout: 10_000 }).toBe(from + 1);
    };
    const pick = async (component: string): Promise<void> => {
        await inspector.getByRole('tab', { name: 'Add' }).click();
        await inspector.getByText(component, { exact: true }).first().click();
        await expect.poll(() => page.evaluate('window.magneticShell.tool()')).toBe('place');
    };

    beforeAll(async () => {
        dataDir = await mkdtemp(join(tmpdir(), 'magnetic-editor-'));
        magnetic = await startMagnetic({ dataDir, host: '127.0.0.1', port: 0, report: silent, devUsers: ['alice'], starter: 'none', browser: noBrowser });
        alice = await signIn(magnetic.origin, 'alice');
        aliceId = (await magnetic.sessions.find(alice.split('=')[1] as string))?.userId as string;
        tools = createStateUiTools(await magnetic.workspaces.get(aliceId));
        browser = await chromium.launch();
    }, 60_000);

    afterAll(async () => {
        await browser?.close();
        await magnetic.stop();
        await rm(dataDir, { recursive: true, force: true });
    });

    beforeEach(async () => {
        const created = await tool(tools, 'ui_app_create', {
            name: `board-${Date.now()}`,
            home: {
                component: 'panel',
                children: {
                    list: { component: 'panel', children: { a: { component: 'text', _text: 'Alpha' }, b: { component: 'text', _text: 'Beta' } } },
                    grid: { component: 'panel', bordered: true, layout: { type: 'grid', cols: 2 }, children: { c: { component: 'text', _text: 'Gamma' }, d: { component: 'text', _text: 'Delta' } } },
                    board: { component: 'panel', bordered: true, layout: { type: 'adhoc' }, children: { n: { component: 'text', _text: 'Note', placement: { x: '8px', y: '4px' } } } }
                }
            }
        });
        appId = created['id'] as string;
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const [name, value] = alice.split('=') as [string, string];
        await context.addCookies([{ name, value, url: magnetic.origin }]);
        page = await context.newPage();
        await page.goto(`${magnetic.origin}/edit/${appId}`);
        inspector = page.frameLocator('#inspector-frame iframe');
        await inspector.getByRole('tab', { name: 'Add' }).waitFor({ timeout: 20_000 });
        await expect.poll(async () => (await pointOf(page, `${HOME}.children.list.children.b`).catch(() => undefined)) !== undefined, { timeout: 20_000 }).toBe(true);
        await page.mouse.click(5, 450);
        await page.keyboard.press('s');
    }, 60_000);

    it('should select a node by clicking it, and its parent from the breadcrumb, without writing anything', async () => {
        // Arrange
        const before = (await app()).revision;
        const beta = await pointOf(page, `${HOME}.children.list.children.b`, 0.1);

        // Act
        await page.mouse.click(beta.x, beta.y);
        const clicked = await selectedLabel(page);
        await inspector.getByText('list', { exact: true }).click();
        await expect.poll(() => selectedLabel(page)).toBe('panel · list');

        // Assert
        expect(clicked).toBe('text · b');
        await inspector.getByText('Text', { exact: true }).waitFor({ state: 'detached', timeout: 5000 });
        expect((await app()).revision).toBe(before);
    }, 60_000);

    it('should place a component between the children of a column, as one write', async () => {
        // Arrange
        const before = (await app()).revision;
        await pick('badge');
        const gap = await pointOf(page, `${HOME}.children.list.children.b`, 0.2, 0.2);

        // Act
        await page.mouse.move(gap.x, gap.y);
        await page.mouse.click(gap.x, gap.y);
        await nextRevision(before);

        // Assert
        expect(childrenOf((await app()).root, 'list')).toEqual(['a', 'badge', 'b']);
        await expect.poll(() => selectedLabel(page)).toBe('badge · badge');
    }, 60_000);

    it('should place a component beside the nearest cell of a grid, as one write', async () => {
        // Arrange
        const before = (await app()).revision;
        await pick('badge');
        const right = await pointOf(page, `${HOME}.children.grid.children.c`, 0.9);

        // Act
        await page.mouse.move(right.x, right.y);
        await page.mouse.click(right.x, right.y);
        await nextRevision(before);

        // Assert
        expect(childrenOf((await app()).root, 'grid')).toEqual(['c', 'badge', 'd']);
    }, 60_000);

    it('should place a component at the point in an adhoc layout, in pixels, as one write', async () => {
        // Arrange
        const before = (await app()).revision;
        await pick('badge');
        const spot = await pointOf(page, `${HOME}.children.board`, 0.5, 0.5);

        // Act
        await page.mouse.move(spot.x, spot.y);
        await page.mouse.click(spot.x, spot.y);
        await nextRevision(before);

        // Assert
        const board = (await app()).root['children'] as Record<string, { children: Record<string, { placement?: { x: string; y: string } }> }>;
        const placed = board['board']?.children['badge'];
        expect(childrenOf((await app()).root, 'board')).toEqual(['n', 'badge']);
        expect(placed?.placement?.x).toMatch(/^\d+px$/);
        expect(placed?.placement?.y).toMatch(/^\d+px$/);
    }, 60_000);

    it('should move the selection after its sibling with Alt+Arrow, as one write, and Escape lets it go', async () => {
        // Arrange
        const alpha = await pointOf(page, `${HOME}.children.list.children.a`, 0.1);
        await page.mouse.click(alpha.x, alpha.y);
        await expect.poll(() => selectedLabel(page)).toBe('text · a');
        const before = (await app()).revision;

        // Act
        await page.keyboard.press('Alt+ArrowDown');
        await nextRevision(before);
        await page.keyboard.press('Escape');

        // Assert
        expect(childrenOf((await app()).root, 'list')).toEqual(['b', 'a']);
        await page.locator('#overlay .box.selected').waitFor({ state: 'detached', timeout: 5000 });
    }, 60_000);
});
