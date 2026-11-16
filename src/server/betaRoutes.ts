import type { IncomingMessage, ServerResponse } from 'node:http';
import type { User } from '../accounts/Accounts.js';
import type { Budgets } from '../agent/Budgets.js';
import type { Beta } from '../beta/Beta.js';
import { betaPage } from '../http/betaPage.js';
import type { BetaView } from '../http/betaPage.js';
import type { PageLook } from '../http/pages.js';

export interface BetaRouteContext {
    readonly beta: Beta;
    readonly budgets: Budgets;
    readonly signedIn: (request: IncomingMessage) => Promise<{ readonly user: User } | undefined>;
    readonly lookOf: (request: IncomingMessage, userId: string) => Promise<PageLook>;
    readonly sendPage: (response: ServerResponse, html: string, status?: number) => void;
    readonly redirect: (response: ServerResponse, location: string) => void;
    readonly report: (message: string, fields?: Record<string, unknown>) => void;
}

/**
 * The beta link (docs/design/magnetic-beta.md), `/beta/<code>`: a signed-in person joins the beta org while a place is
 * left, and is told the beta is full after. A wrong code, or no beta org yet, is no page at all. Answers true when it
 * handled the request
 */
export function betaRoutes(context: BetaRouteContext) {
    const { beta, budgets } = context;

    /** What the page shows the person now */
    async function viewOf(userId: string, action: string): Promise<BetaView> {
        const role = await beta.roleOf(userId);
        if (role === 'owner' || role === 'admin') return { state: 'runs' };
        if (role !== undefined) {
            const amount = await budgets.allowanceOf(userId);
            return { state: 'in', ...(amount !== undefined && { amount }) };
        }
        const status = await beta.status();
        if (status.places !== undefined && status.taken >= status.places) return { state: 'full', places: status.places };
        const amount = budgets.limits.perUserTotal;
        return { state: 'open', action, ...(status.places !== undefined && { places: status.places, left: status.places - status.taken }), ...(amount !== undefined && { amount }) };
    }

    return async (request: IncomingMessage, response: ServerResponse, method: string, path: string): Promise<boolean> => {
        const match = /^\/beta\/([A-Za-z0-9_-]{1,64})$/.exec(path);
        if (match === null || !beta.isCode(match[1] as string)) return false;
        if ((await beta.status()).org === undefined) return false;
        const who = await context.signedIn(request);
        if (who === undefined) {
            if (method === 'GET') context.redirect(response, `/signin?next=${encodeURIComponent(path)}`);
            else context.redirect(response, '/signin');
            return true;
        }
        if (method === 'GET') {
            context.sendPage(response, betaPage(await context.lookOf(request, who.user.id), await viewOf(who.user.id, path)));
            return true;
        }
        if (method === 'POST') {
            const joined = await beta.join(who.user.id);
            if (joined === 'joined') context.report('Joined the beta', { userId: who.user.id });
            // Back to the link, which now says they are in, or that it filled up first
            context.redirect(response, path);
            return true;
        }
        return false;
    };
}
