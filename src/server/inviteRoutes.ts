import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Accounts, User } from '../accounts/Accounts.js';
import { invitePage } from '../http/orgSettings.js';
import type { PageLook } from '../http/pages.js';
import { OrgError } from '../orgs/Orgs.js';
import type { Orgs } from '../orgs/Orgs.js';

export interface InviteRouteContext {
    readonly orgs: Orgs;
    readonly accounts: Accounts;
    readonly signedIn: (request: IncomingMessage) => Promise<{ readonly user: User } | undefined>;
    /** The page's look: the person's choices, or the browser's language when nobody is signed in */
    readonly lookOf: (request: IncomingMessage, userId: string | undefined) => Promise<PageLook>;
    readonly readForm: (request: IncomingMessage) => Promise<URLSearchParams>;
    readonly sendPage: (response: ServerResponse, html: string, status?: number) => void;
    readonly redirect: (response: ServerResponse, location: string, cookie?: string) => void;
    /** Starts a session for the person and answers its cookie, replacing whoever was signed in in this browser */
    readonly startSession: (request: IncomingMessage, userId: string) => Promise<string>;
    /** Never given the address or the token */
    readonly report: (message: string, fields: Record<string, unknown>) => void;
}

export const INVITE_PATH = /^\/invites\/([A-Za-z0-9_-]{43})$/;

/**
 * An invite's link, `/invites/<token>` (docs/design/magnetic-orgs-and-invites.md), signed in or not. The link came to
 * the invited address, so Join signs in as that address's account (made now when there is none), accepts the invite
 * and opens the org. Answers true when it handled the request
 */
export function inviteRoutes(context: InviteRouteContext) {
    const { orgs, accounts } = context;
    return async (request: IncomingMessage, response: ServerResponse, method: string, path: string): Promise<boolean> => {
        const match = INVITE_PATH.exec(path);
        if (match === null || (method !== 'GET' && method !== 'POST')) return false;
        const token = match[1] as string;
        const who = await context.signedIn(request);
        const look = await context.lookOf(request, who?.user.id);
        const invite = await orgs.invitation(token);
        const signedInAs = invite !== undefined && who?.user.email?.toLowerCase() === invite.email;
        const show = async (status: number, error?: string): Promise<void> => {
            const name = signedInAs || invite === undefined ? undefined : (await accounts.byVerifiedEmail(invite.email))?.name;
            context.sendPage(response, invitePage({ look, token, ...(invite !== undefined && { invite }), ...(signedInAs && { signedInAs }), ...(name !== undefined && { name }), ...(error !== undefined && { error }) }), status);
        };
        if (method === 'GET' || invite === undefined) {
            await show(invite === undefined ? 404 : 200);
            return true;
        }
        const form = await context.readForm(request);
        try {
            const user = signedInAs && who !== undefined ? who.user : await accounts.signInByEmail(invite.email, form.get('name') ?? undefined);
            const org = await orgs.accept(token, user.id);
            context.report('Joined an org by invite', { org: org.id, userId: user.id, newSession: user.id !== who?.user.id });
            context.redirect(response, `/settings/orgs/${org.id}`, user.id === who?.user.id ? undefined : await context.startSession(request, user.id));
        } catch (error) {
            if (!(error instanceof OrgError)) throw error;
            await show(error.status, error.message);
        }
        return true;
    };
}
