import type { IncomingMessage } from 'node:http';

/** The cookie that holds the session token */
export const SESSION_COOKIE = 'magnetic_session';

/** The value of one cookie of a request, or `undefined` */
export function readCookie(request: IncomingMessage, name: string): string | undefined {
    const header = request.headers.cookie;
    if (header === undefined) return undefined;
    for (const part of header.split(';')) {
        const equals = part.indexOf('=');
        if (equals < 0) continue;
        if (part.slice(0, equals).trim() === name) return part.slice(equals + 1).trim();
    }
    return undefined;
}

export interface CookieOptions {
    /** Seconds until it expires; 0 removes the cookie */
    readonly maxAge: number;
    /** Only over HTTPS: on whenever the server is reached over HTTPS */
    readonly secure: boolean;
}

/**
 * A `Set-Cookie` value the page's scripts cannot read (`HttpOnly`), sent with top-level navigations from other sites
 * but not with their requests or frames (`SameSite=Lax`), for the whole site
 */
export function sessionCookie(value: string, options: CookieOptions): string {
    return [`${SESSION_COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${options.maxAge}`, ...(options.secure ? ['Secure'] : [])].join('; ');
}
