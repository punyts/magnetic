import type { IncomingMessage, ServerResponse } from 'node:http';
import type { User } from '../accounts/Accounts.js';
import type { Admin, AdminList, FeedbackFilter } from '../admin/Admin.js';
import type { Beta } from '../beta/Beta.js';
import { FEEDBACK_KINDS } from '../feedback/Feedback.js';
import { adminFeedbackPage, adminOverviewPage, adminPeoplePage } from '../http/adminPage.js';
import type { AllowanceInfo, BetaInfo } from '../http/adminPage.js';
import { usd } from '../http/billingPage.js';
import type { PageLook } from '../http/pages.js';

/** The most an admin may give at once, in dollars: a typo of a few zeros stays small */
export const MAX_GIFT = 500;

export interface AdminRouteContext {
    readonly admin: Admin;
    readonly admins: AdminList;
    readonly allowance: AllowanceInfo;
    /** The beta, when the server runs one (`--beta-org`) */
    readonly beta?: Beta;
    /** The origin people reach the server at, for the beta link */
    readonly origin: () => string;
    readonly signedIn: (request: IncomingMessage) => Promise<{ readonly user: User } | undefined>;
    readonly readForm: (request: IncomingMessage) => Promise<URLSearchParams>;
    readonly lookOf: (request: IncomingMessage, userId: string) => Promise<PageLook>;
    readonly sendPage: (response: ServerResponse, html: string, status?: number) => void;
    readonly redirect: (response: ServerResponse, location: string) => void;
    readonly report: (message: string, fields?: Record<string, unknown>) => void;
}

const filterOf = (query: URLSearchParams): FeedbackFilter => {
    const status = query.get('status') ?? 'open';
    const kind = FEEDBACK_KINDS.find((item) => item === query.get('kind'));
    return { ...((status === 'open' || status === 'done') && { status }), ...(kind !== undefined && { kind }) };
};

/** Only a path on the admin Feedback page, so a form cannot send an admin elsewhere */
const backTo = (value: string | null): string => (value !== null && /^\/admin\/feedback(\?[\w=&%.-]*)?$/.test(value) ? value : '/admin/feedback');

/**
 * The operator's admin pages (docs/design/magnetic-admin.md): `/admin` (the numbers), `/admin/feedback` (what people
 * sent from the editor, with Done and Reopen) and `/admin/people` (everyone in sign-in order, with Give). Only people
 * whose verified email is in `MAGNETIC_ADMIN_EMAILS` reach them; to anyone else there are no such pages. Answers true
 * when it handled the request
 */
export function adminRoutes(context: AdminRouteContext) {
    const { admin, admins, beta } = context;

    async function betaInfo(): Promise<BetaInfo | undefined> {
        if (beta === undefined) return undefined;
        const status = await beta.status();
        return { slug: status.slug, started: status.org !== undefined, taken: status.taken, ...(status.places !== undefined && { places: status.places }), link: `${context.origin()}/beta/${beta.code}` };
    }

    return async (request: IncomingMessage, response: ServerResponse, method: string, path: string, query: URLSearchParams): Promise<boolean> => {
        if (path !== '/admin' && !path.startsWith('/admin/')) return false;
        const who = await context.signedIn(request);
        if (who === undefined) {
            context.redirect(response, `/signin?next=${encodeURIComponent(path)}`);
            return true;
        }
        // Not an admin: the pages are not there for them, as for anyone else
        if (!(await admins.is(who.user.id))) return false;
        const look = await context.lookOf(request, who.user.id);

        if (method === 'GET' && path === '/admin') {
            context.sendPage(response, adminOverviewPage(look, await admin.overview(), context.allowance, await betaInfo(), query.get('started') === null ? undefined : { notice: 'The beta has started. Hand out its link.' }));
            return true;
        }
        if (method === 'POST' && path === '/admin/beta' && beta !== undefined) {
            await beta.start(who.user.id);
            context.report('Beta started', { by: who.user.id, org: beta.slug });
            context.redirect(response, '/admin?started=1');
            return true;
        }
        if (method === 'GET' && path === '/admin/feedback') {
            const filter = filterOf(query);
            const done = query.get('done');
            context.sendPage(response, adminFeedbackPage(look, await admin.feedback(filter), filter, done === null ? undefined : { notice: done === 'open' ? 'Opened again.' : 'Marked done.' }));
            return true;
        }
        const feedback = /^\/admin\/feedback\/([0-9a-f-]{36})$/.exec(path);
        if (method === 'POST' && feedback !== null) {
            const form = await context.readForm(request);
            const status = form.get('status') === 'open' ? 'open' : 'done';
            const back = backTo(form.get('back'));
            if (!(await admin.setFeedbackStatus(feedback[1] as string, status, who.user.id))) return false;
            context.redirect(response, `${back}${back.includes('?') ? '&' : '?'}done=${status}`);
            return true;
        }
        if (method === 'GET' && path === '/admin/people') {
            const gave = query.get('gave');
            const name = gave === null ? undefined : await admin.personName(gave);
            const amount = Number(query.get('dollars'));
            context.sendPage(response, adminPeoplePage(look, await admin.people(beta?.slug), context.allowance, name === undefined || !(amount > 0) ? undefined : { notice: `Gave ${name} ${usd(amount)} of agent use.` }));
            return true;
        }
        const give = /^\/admin\/people\/([0-9a-f-]{36})\/give$/.exec(path);
        if (method === 'POST' && give !== null) {
            const userId = give[1] as string;
            const form = await context.readForm(request);
            const dollars = Number((form.get('dollars') ?? '').replace(/^\$/, '').trim());
            const note = (form.get('note') ?? '').trim().slice(0, 200);
            const name = await admin.personName(userId);
            if (name === undefined) return false;
            if (!Number.isFinite(dollars) || dollars <= 0 || dollars > MAX_GIFT || Math.round(dollars * 100) !== dollars * 100) {
                context.sendPage(response, adminPeoplePage(look, await admin.people(beta?.slug), context.allowance, { error: `Give between $0.01 and ${usd(MAX_GIFT)}, in cents at most.` }), 400);
                return true;
            }
            await admin.give({ userId, dollars, note, by: who.user.id });
            context.report('Agent use given', { user: userId, dollars, by: who.user.id });
            context.redirect(response, `/admin/people?gave=${userId}&dollars=${dollars}`);
            return true;
        }
        return false;
    };
}
