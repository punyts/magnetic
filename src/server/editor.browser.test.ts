import { existsSync } from 'node:fs';
import { createStateUiTools } from '@punyts/stateui-mcp';
import type { PreviewBrowser, UiToolDefinition } from '@punyts/stateui-mcp';
import { chromium } from 'playwright';
import type { Browser, FrameLocator, Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EDITOR_ICONS } from '../editor/EditorApp.js';
import { startMagnetic } from './startMagnetic.js';
import type { RunningMagnetic } from './startMagnetic.js';
import type { Database } from '@punyts/stateui-pg';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { magneticTestDatabase } from '../testing/testDb.js';
const databases: TestDatabase[] = [];
/** A database of its own for each server a test starts, dropped after the file */
async function freshDb(): Promise<Database> {
    const test = await magneticTestDatabase();
    databases.push(test);
    return test.db;
}
afterAll(async () => {
    await Promise.all(databases.splice(0).map((test) => test.drop()));
});


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
    let magnetic: RunningMagnetic;
    let browser: Browser;
    let page: Page;
    /** The editor: a StateUI app in a frame over the canvas, the inspector one of its panels */
    let editor: FrameLocator;
    /** Whether the inspector showed, and which tool was on, once the page had loaded and before the select tool */
    let onLoad: { open: boolean; tool: unknown };
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
    /** The inspector shows: its Properties tab is on screen */
    const inspectorOpen = (): Promise<boolean> => editor.getByRole('tab', { name: 'Properties' }).isVisible();
    const toolButton = (name: string) => editor.getByRole('button', { name });
    /** Presses a component in the library, which shows beside the rail when the editor opens */
    const pick = async (component: string): Promise<void> => {
        await editor.getByText(component, { exact: true }).first().click();
        await expect.poll(() => page.evaluate('window.magneticShell.tool()')).toBe('place');
    };

    beforeAll(async () => {
        magnetic = await startMagnetic({ database: await freshDb(), host: '127.0.0.1', port: 0, report: silent, devUsers: ['alice'], starter: 'none', browser: noBrowser });
        alice = await signIn(magnetic.origin, 'alice');
        aliceId = (await magnetic.sessions.find(alice.split('=')[1] as string))?.userId as string;
        tools = createStateUiTools(await magnetic.workspaces.get(aliceId));
        browser = await chromium.launch();
    }, 60_000);

    afterAll(async () => {
        await browser?.close();
        await magnetic.stop();
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
        editor = page.frameLocator('#editor iframe');
        await editor.getByRole('button', { name: 'Use the app (V)' }).waitFor({ timeout: 20_000 });
        // The editor says where its panels are, and the canvas fits the app between them
        await expect.poll(() => page.evaluate("document.getElementById('editor').style.clipPath.startsWith('path')"), { timeout: 20_000 }).toBe(true);
        await expect.poll(async () => (await pointOf(page, `${HOME}.children.list.children.b`).catch(() => undefined)) !== undefined, { timeout: 20_000 }).toBe(true);
        onLoad = { open: await inspectorOpen(), tool: await page.evaluate('window.magneticShell.tool()') };
        await page.mouse.click(5, 450);
        await page.keyboard.press('s');
        await editor.getByRole('tab', { name: 'Properties' }).waitFor({ timeout: 5000 });
    }, 60_000);

    it('should select a node by clicking it, and its parent from the breadcrumb, without writing anything', async () => {
        // Arrange
        const before = (await app()).revision;
        const beta = await pointOf(page, `${HOME}.children.list.children.b`, 0.1);

        // Act
        await page.mouse.click(beta.x, beta.y);
        const clicked = await selectedLabel(page);
        await editor.getByText('list', { exact: true }).click();
        await expect.poll(() => selectedLabel(page)).toBe('panel · list');

        // Assert
        expect(clicked).toBe('text · b');
        await editor.getByText('Text', { exact: true }).waitFor({ state: 'detached', timeout: 5000 });
        expect((await app()).revision).toBe(before);
    }, 60_000);

    it('should add the selected node to the chat, named on the chat bar and sent with the next request, without writing anything', async () => {
        // Arrange
        const before = (await app()).revision;
        const beta = await pointOf(page, `${HOME}.children.list.children.b`, 0.1);
        await page.mouse.click(beta.x, beta.y);
        await expect.poll(() => selectedLabel(page)).toBe('text · b');

        // Act
        await editor.getByRole('button', { name: 'Add to chat' }).click();

        // Assert
        await editor.getByRole('button', { name: 'Remove text · b' }).waitFor({ timeout: 5000 });
        expect(await page.evaluate('window.magneticShell.focus.slice()')).toEqual([`${HOME}.children.list.children.b`]);
        expect((await app()).revision).toBe(before);
    }, 60_000);

    it('should take one thing out of the chat with its chip, and keep the others', async () => {
        // Arrange: two nodes added to the chat, each a chip on the chat bar
        for (const [key, label] of [['a', 'text · a'], ['b', 'text · b']] as const) {
            const point = await pointOf(page, `${HOME}.children.list.children.${key}`, 0.1);
            await page.mouse.click(point.x, point.y);
            await expect.poll(() => selectedLabel(page)).toBe(label);
            await editor.getByRole('button', { name: 'Add to chat' }).click();
        }
        await editor.getByRole('button', { name: 'Remove text · b' }).waitFor({ timeout: 5000 });

        // Act
        await editor.getByRole('button', { name: 'Remove text · a' }).click();

        // Assert
        await editor.getByRole('button', { name: 'Remove text · a' }).waitFor({ state: 'detached', timeout: 5000 });
        expect(await page.evaluate('window.magneticShell.focus.slice()')).toEqual([`${HOME}.children.list.children.b`]);
        await editor.getByRole('button', { name: 'Remove text · b' }).waitFor({ timeout: 5000 });
    }, 60_000);

    it('should show a layout, its cells and its gaps while the pointer is over the layout, not over a child', async () => {
        // Arrange: the middle of the grid is the gap between its two columns
        const gap = await pointOf(page, `${HOME}.children.grid`, 0.5, 0.5);
        const gamma = await pointOf(page, `${HOME}.children.grid.children.c`, 0.3);

        // Act
        await page.mouse.move(gap.x, gap.y);
        const tag = await page.locator('#overlay .box.layout .tag').textContent({ timeout: 5000 });
        const cells = await page.locator('#overlay .cell').count();
        const gutters = await page.locator('#overlay .gutter').count();
        const items = await page.locator('#overlay .item').count();
        await page.mouse.move(gamma.x, gamma.y);
        await expect.poll(() => page.locator('#overlay .box.hover .tag').textContent()).toBe('text · c');

        // Assert
        expect(tag).toBe('panel · grid · grid cols 2');
        expect(cells).toBe(2);
        expect(gutters).toBe(1);
        expect(items).toBe(2);
        expect(await page.locator('#overlay .box.layout').count()).toBe(0);
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

    it('should open the editor with the inspector closed and the use tool on, and open the inspector with the select tool', async () => {
        // Assert
        expect(onLoad).toEqual({ open: false, tool: 'use' });
        expect(await inspectorOpen()).toBe(true);
    });

    it('should let the selection go and close the inspector when the inspector closes or the select tool is left', async () => {
        const outline = page.locator('#overlay .box.selected');
        const selectTool = toolButton('Select a part of the app (S)');
        /** Turns the select tool on, picks the list's first text and waits for its outline and the inspector */
        const pick = async (): Promise<void> => {
            if ((await page.evaluate('window.magneticShell.tool()')) !== 'select') await selectTool.click();
            const alpha = await pointOf(page, `${HOME}.children.list.children.a`, 0.1);
            await page.mouse.click(alpha.x, alpha.y);
            await expect.poll(() => selectedLabel(page)).toBe('text · a');
            await expect.poll(inspectorOpen).toBe(true);
        };
        const letGo = async (): Promise<void> => {
            await outline.waitFor({ state: 'detached', timeout: 5000 });
            await expect.poll(inspectorOpen).toBe(false);
        };

        // The inspector's close button
        await pick();
        await editor.getByRole('button', { name: 'Close the inspector' }).click();
        await letGo();
        await expect.poll(() => page.evaluate('window.magneticShell.tool()')).toBe('use');

        // Back to using the app with the Use tool
        await pick();
        await toolButton('Use the app (V)').click();
        await letGo();

        // Back to using the app with V
        await pick();
        await page.mouse.move(5, 450);
        await page.mouse.click(5, 450);
        await page.keyboard.press('v');
        await letGo();

        // Panning with the hand keeps the selection and the inspector
        await pick();
        await toolButton('Move the canvas (H, or hold Space)').click();
        await page.waitForTimeout(300);
        expect([await outline.count(), await inspectorOpen()]).toEqual([1, true]);
    }, 60_000);

    it('should keep the sizes of the old editor (41fa580): compact corners, a narrow rail, a 640px pill chat bar', async () => {
        // Arrange: what the old editor measured at a wide window, before it was a StateUI app. A change that makes the
        // editor drift from that design fails here (the panels' own looks are in stateui-components' screenshot tests)
        // The rail is the old one with two more buttons under the tools, the library's (M8 N2) and the screens' (N4): 60px taller
        const OLD = { nameCorner: { height: 46 }, shareCorner: { height: 46 }, rail: { width: 74, height: 327 + 60 }, zoom: { width: 178, height: 45 }, chatBar: { width: 640, height: 50 } };
        const stage = await page.evaluate("window.magneticShell.editor.pathOf('stage')");
        const answer = (await page.evaluate(`window.magneticShell.editor.inspect({ paths: ${JSON.stringify(Object.keys(OLD).map((key) => `${stage}.children.${key}`))} })`)) as { nodes: { path: string; rect: { width: number; height: number } }[] };
        const size = (key: string) => answer.nodes.find((node) => node.path.endsWith(`.${key}`))?.rect;

        // Act
        const measured = Object.fromEntries(Object.keys(OLD).map((key) => [key, size(key)]));

        // Assert: within a few pixels of the old sizes, and the corners as wide as they hold, never stretched
        for (const [key, old] of Object.entries(OLD)) {
            const now = measured[key];
            expect(now, key).toBeDefined();
            if ('width' in old) expect(Math.abs((now?.width ?? 0) - old.width), `${key} width ${now?.width}`).toBeLessThanOrEqual(old.width * 0.15);
            expect(Math.abs((now?.height ?? 0) - old.height), `${key} height ${now?.height}`).toBeLessThanOrEqual(Math.max(8, old.height * 0.04));
        }
        expect(measured['nameCorner']?.width).toBeLessThan(400);
        expect(measured['shareCorner']?.width).toBeLessThan(140);
        expect(measured['chatBar']?.width).toBe(640);
    }, 60_000);

    it('should space the top corners and the chat bar evenly: one gap between their parts, the same padding at both ends, one height', async () => {
        // Arrange: each floating bar with its parts, left to right
        const CORNERS: [string, string[]][] = [
            ['nameCorner', ['home', 'name', 'size', 'open']],
            ['shareCorner', ['prefs', 'share']],
            ['chatBar', ['chat', 'input', 'model', 'send']]
        ];
        const stage = await page.evaluate("window.magneticShell.editor.pathOf('stage')");
        type Rect = { x: number; y: number; width: number; height: number };
        const measure = async (corner: string, parts: string[]): Promise<{ corner: Rect; parts: Rect[] }> => {
            const base = `${stage}.children.${corner}`;
            const paths = [base, ...parts.map((part) => `${base}.children.bar.children.${part}`)];
            const answer = (await page.evaluate(`window.magneticShell.editor.inspect({ paths: ${JSON.stringify(paths)} })`)) as { nodes: { path: string; rect: Rect }[] };
            const rectOf = (path: string): Rect => answer.nodes.find((node) => node.path === path)?.rect as Rect;
            return { corner: rectOf(base), parts: paths.slice(1).map(rectOf) };
        };

        // Act
        const measured = await Promise.all(CORNERS.map(([corner, parts]) => measure(corner, parts)));

        // Assert
        const [name, share, chat] = measured as [{ corner: Rect; parts: Rect[] }, { corner: Rect; parts: Rect[] }, { corner: Rect; parts: Rect[] }];
        for (const { corner, parts } of measured) {
            const gaps = parts.slice(1).map((part, index) => part.x - ((parts[index] as Rect).x + (parts[index] as Rect).width));
            for (const gap of gaps) expect(Math.abs(gap - (gaps[0] as number)), `gaps ${gaps.join(', ')}`).toBeLessThan(0.5);
            const start = (parts[0] as Rect).x - corner.x;
            const last = parts[parts.length - 1] as Rect;
            const end = corner.x + corner.width - (last.x + last.width);
            expect(Math.abs(start - end), `padding ${start} and ${end}`).toBeLessThan(0.5);
        }
        // The frame size menu is as tall as Open beside it, and both corners are one height
        expect((name.parts[2] as Rect).height).toBeCloseTo((name.parts[3] as Rect).height, 1);
        expect(name.corner.height).toBeCloseTo(share.corner.height, 1);
        // Every part of the chat bar is as tall as the request at one line
        for (const part of chat.parts) expect(part.height).toBeCloseTo((chat.parts[1] as Rect).height, 1);
    }, 60_000);

    it("should draw the old editor's icons (41fa580) from the editor's own icon set, not the nearest icons of the set", async () => {
        // Arrange: each button by its accessible name, with the icon of the old editor it shows
        const BUTTONS: [string, keyof typeof EDITOR_ICONS][] = [
            ['Show the chat', 'chat'],
            ['Send', 'send'],
            ['Use the app (V)', 'pointer'],
            ['Move the canvas (H, or hold Space)', 'hand'],
            ['Select a part of the app (S)', 'select'],
            ['Zoom out (-)', 'minus'],
            ['Zoom in (+)', 'plus'],
            ['Fit the app (1)', 'fit'],
            ['Appearance and language', 'prefs']
        ];
        const dataOf = (name: keyof typeof EDITOR_ICONS): string[] => EDITOR_ICONS[name].outline.map((path) => (typeof path === 'string' ? path : path.d));

        // Act
        const drawn = await Promise.all(BUTTONS.map(([button]) => toolButton(button).first().locator('svg path').evaluateAll((paths) => paths.map((path) => path.getAttribute('d')))));

        // Assert
        BUTTONS.forEach(([button, name], index) => expect(drawn[index], button).toEqual(dataOf(name)));
    }, 60_000);

    it('should open the chat with its button and close it with its close button', async () => {
        // Arrange
        const chat = editor.getByText('Describe the app you want, or a change to this one.', { exact: false });

        // Act and Assert
        await editor.getByRole('button', { name: 'Show the chat' }).click();
        await chat.waitFor({ state: 'visible', timeout: 5000 });
        await editor.getByRole('button', { name: 'Close the chat' }).click();
        await chat.waitFor({ state: 'hidden', timeout: 5000 });
    }, 60_000);

    it("should take the tool keys from the editor's frame, but not while the person types there", async () => {
        // Arrange: the focus in the editor's frame, on a button of its rail
        await editor.getByRole('button', { name: 'Theme' }).focus();

        // Act and Assert: H and V switch the tool from inside the frame
        await page.keyboard.press('h');
        await expect.poll(() => page.evaluate('window.magneticShell.tool()')).toBe('move');
        await page.keyboard.press('v');
        await expect.poll(() => page.evaluate('window.magneticShell.tool()')).toBe('use');

        // Typed in the chat box, the same letters are text
        const box = editor.getByRole('textbox', { name: 'Your request' });
        await box.click();
        await page.keyboard.type('hs');
        await page.waitForTimeout(200);
        expect(await page.evaluate('window.magneticShell.tool()')).toBe('use');
        expect(await box.inputValue()).toBe('hs');
    }, 60_000);

    it("should cast the panels' shadows from the page and show the app only once it is fitted", async () => {
        // Act
        const casts = await page.locator('#shadows div').count();
        const waiting = await page.evaluate("document.body.classList.contains('unfitted')");

        // Assert
        expect(casts).toBeGreaterThanOrEqual(5);
        expect(waiting).toBe(false);
    }, 60_000);

    it('should let clicks beside the panels through to the canvas, and clip the editor to its panels', async () => {
        // Act
        const clip = await page.evaluate("getComputedStyle(document.getElementById('editor')).clipPath");
        const below = await page.evaluate('document.elementFromPoint(700, 450) && document.elementFromPoint(700, 450).closest("#board") !== null');

        // Assert
        expect(String(clip)).toMatch(/^path\(/);
        expect(below).toBe(true);
    }, 60_000);
});
