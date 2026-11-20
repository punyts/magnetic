import { expect, test as base } from '@playwright/test';
import type { BrowserContext, FrameLocator, Locator, Page, TestInfo } from '@playwright/test';

/**
 * Page objects for the suite. Magnetic's pages are StateUI apps in frames from the runtime origin:
 * - the sign-in page: `#page-app iframe`; Your apps: the frame in `body.home`, with its notices in `#notice`;
 * - the editor: `#editor iframe` (Magnetic's editor, an app of its own) beside the screens board, `#screens`, where the
 *   person's app runs in the page: the live screen is `ui-embedded-app[live]`, the others previews of it.
 * The org settings, shared links and privacy pages are plain HTML.
 */

const CONTROL = `http://127.0.0.1:${Number(process.env['MAGNETIC_E2E_PORT'] ?? 4390) + 2}`;

/** A name no other test, or the other project's run of this one, uses */
export function uniqueName(info: TestInfo, stem: string): string {
    return `${stem}-${info.project.name}-${Date.now().toString(36)}`;
}

/** Signs a dev user in on the context: the cookie is shared with its pages */
export async function signIn(context: BrowserContext, user: string): Promise<void> {
    const response = await context.request.post('/signin/dev', { form: { user, next: '/' }, maxRedirects: 0 });
    expect(response.status(), `dev sign-in of ${user}`).toBeLessThan(400);
}

/** Who the mock provider signs in next */
export async function mockPerson(person: { sub: string; name: string; email: string; email_verified?: boolean }): Promise<void> {
    const response = await fetch(`${CONTROL}/person`, { method: 'POST', body: JSON.stringify({ email_verified: true, ...person }) });
    expect(response.status).toBe(204);
}

/** Gives a dev user who signed in a verified email and a dataset of their own, as the agent would make it */
export async function seedDataset(seed: { user: string; email: string; dataset: string; records: Record<string, Record<string, string>> }): Promise<void> {
    const response = await fetch(`${CONTROL}/dataset`, { method: 'POST', body: JSON.stringify(seed) });
    expect(response.status, await response.text()).toBe(204);
}

/** Gives a dev user's app a logic module working on one of their datasets (seedDataset), as the agent would make it */
export async function seedModule(seed: { user: string; app: string; module: string; dataset: string }): Promise<void> {
    const response = await fetch(`${CONTROL}/module`, { method: 'POST', body: JSON.stringify(seed) });
    expect(response.status, await response.text()).toBe(204);
}

/** The stand-in Stripe refunds a checkout session's payment, so far `cents` in all */
export async function refundCheckout(session: string, cents: number): Promise<void> {
    const answer = await fetch(`${CONTROL}/refund`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session, cents }) });
    expect(answer.status, await answer.text()).toBe(204);
}

/** The invites the test server has "emailed", oldest first */
export async function mailSent(): Promise<Array<{ to: string; orgName: string; inviterName: string; role: string; link: string }>> {
    return (await (await fetch(`${CONTROL}/mail`)).json()) as Array<{ to: string; orgName: string; inviterName: string; role: string; link: string }>;
}

/** Gives a dev user who signed in a verified email (dev users have none) */
export async function verifyEmail(user: string, email: string): Promise<void> {
    const response = await fetch(`${CONTROL}/verify`, { method: 'POST', body: JSON.stringify({ user, email }) });
    if (!response.ok) throw new Error(await response.text());
}

/** A dev user who signed in spends agent use, as the agent's turns would */
export async function spend(user: string, dollars: number): Promise<void> {
    const response = await fetch(`${CONTROL}/spend`, { method: 'POST', body: JSON.stringify({ user, dollars }) });
    if (!response.ok) throw new Error(await response.text());
}

/** The feedback the test server has emailed to its operator, oldest first */
export async function feedbackSent(): Promise<Array<{ to: string; kind: string; text: string; fromName: string; appName?: string; context: Record<string, string> }>> {
    return (await (await fetch(`${CONTROL}/feedback-mail`)).json()) as Array<{ to: string; kind: string; text: string; fromName: string; appName?: string; context: Record<string, string> }>;
}

/** The sign-in page */
export class SignInPage {
    readonly app: FrameLocator;
    constructor(readonly page: Page) {
        this.app = page.frameLocator('#page-app iframe');
    }
    async goto(): Promise<void> {
        await this.page.goto('/signin');
    }
    button(name: string): Locator {
        return this.app.getByRole('button', { name });
    }
}

/** Your apps */
export class HomePage {
    readonly app: FrameLocator;
    constructor(readonly page: Page) {
        this.app = page.frameLocator('body.home iframe');
    }
    get notice(): Locator {
        return this.page.locator('#notice');
    }
    /** Opens Your apps on its Apps tab: the page keeps the tab last shown */
    async goto(): Promise<void> {
        await this.page.goto('/');
        await this.openTab('Apps');
        await expect(this.makeButton).toBeVisible();
    }
    /** One of the tabs: Apps, Orgs, Usage or Profile */
    tab(name: string): Locator {
        return this.app.getByRole('tab', { name, exact: true });
    }
    async openTab(name: string): Promise<void> {
        await this.tab(name).click();
        await expect(this.tab(name)).toHaveAttribute('aria-selected', 'true');
    }
    get nameField(): Locator {
        return this.app.getByPlaceholder('Such as Reading list');
    }
    get makeButton(): Locator {
        return this.app.getByRole('button', { name: 'Make', exact: true });
    }
    /** An app's card, by the start of its name: a card that opens its app */
    card(name: string): Locator {
        return this.app.getByRole('button', { name: new RegExp(`^${name}`) });
    }
    /** The tile of an app, whether or not it opens: a share waiting for an answer does not */
    tile(name: string): Locator {
        return this.app.locator('ui-card', { hasText: name });
    }
    /** Makes an app and waits for its editor */
    async makeApp(name: string): Promise<EditorPage> {
        await this.nameField.fill(name);
        await this.makeButton.click();
        await this.page.waitForURL(/\/edit\/[0-9a-f-]+$/);
        const editor = new EditorPage(this.page);
        await editor.ready();
        return editor;
    }
}

/** The editor at /edit/<id>, and the app at /apps/<id> under it */
export class EditorPage {
    /** Magnetic's editor: the panels, the rail, the chat bar */
    readonly editor: FrameLocator;
    /** The person's app on the board: the live screen's card, the app mounted in the page */
    readonly app: Locator;
    constructor(readonly page: Page) {
        this.editor = page.frameLocator('#editor iframe');
        this.app = page.locator('ui-embedded-app[live]');
    }
    get appId(): string {
        return new URL(this.page.url()).pathname.split('/').pop() as string;
    }
    async goto(appId: string): Promise<void> {
        await this.page.goto(`/edit/${appId}`);
        await this.ready();
    }
    async ready(): Promise<void> {
        await expect(this.request).toBeVisible();
        await expect(this.page.locator('body')).not.toHaveAttribute('data-status', 'loading');
    }
    button(name: string | RegExp): Locator {
        return this.editor.getByRole('button', { name, exact: typeof name === 'string' });
    }
    get request(): Locator {
        return this.editor.getByPlaceholder('What shall we build?');
    }
    /**
     * Sends a request to the agent and waits for the turn to end. The scripted agent of this suite adds the request as
     * a text on the first screen, so the turn has ended once the text shows and Stop has gone
     */
    async ask(text: string): Promise<void> {
        await this.request.fill(text);
        await this.button('Send').click();
        await expect(this.app.getByText(text, { exact: true })).toBeVisible({ timeout: 30_000 });
        await expect(this.button('Stop')).toBeHidden({ timeout: 30_000 });
    }
    /** The frame size: Desktop, Tablet or Phone */
    get sizeSelect(): Locator {
        return this.editor.getByRole('combobox').filter({ hasText: 'Desktop' });
    }
    /** The live screen's size, "W × H", in its card's head */
    get artboardSize(): Locator {
        return this.page.locator('#screens').getByText(/^\s*\d+\s*×\s*\d+\s*$/);
    }
    get zoomButton(): Locator {
        return this.button(/^\d+%$/);
    }
    /** The component library beside the rail */
    get librarySearch(): Locator {
        return this.editor.getByPlaceholder('Find a component');
    }
    /** A component's card in the library, by its name */
    card(name: string): Locator {
        return this.editor.getByText(name, { exact: true }).first();
    }
    /** Shows the library if it is not showing (it starts hidden on a phone) */
    async openLibrary(): Promise<void> {
        if (!(await this.librarySearch.isVisible())) await this.button('Components (A)').click();
        await expect(this.librarySearch).toBeVisible();
    }
    /** The tool the page is on: use, move, select or place */
    tool(): Promise<unknown> {
        return this.page.evaluate('window.magneticShell.tool()');
    }
}

/**
 * An app open on its own at /apps/<id>, as a person given it sees it: with no editor, its frame is the page's only
 * runtime frame
 */
export class AppPage {
    readonly app: FrameLocator;
    constructor(readonly page: Page) {
        this.app = page.frameLocator('iframe').last();
    }
}

export const test = base.extend<{ home: HomePage; signInPage: SignInPage }>({
    home: async ({ page }, use) => use(new HomePage(page)),
    signInPage: async ({ page }, use) => use(new SignInPage(page))
});
export { expect };
