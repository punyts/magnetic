import type { IncomingMessage } from 'node:http';

/** The cookie that holds the session token */
export const SESSION_COOKIE = 'magnetic_session';
/** The cookie that ties a provider sign-in in flight to the browser that started it */
export const SIGN_IN_COOKIE = 'magnetic_signin';

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
    /** Default `/` */
    readonly path?: string;
}

/**
 * A `Set-Cookie` value the page's scripts cannot read (`HttpOnly`), sent with top-level navigations from other sites
 * but not with their requests or frames (`SameSite=Lax`)
 */
export function httpOnlyCookie(name: string, value: string, options: CookieOptions): string {
    return [`${name}=${value}`, `Path=${options.path ?? '/'}`, 'HttpOnly', 'SameSite=Lax', `Max-Age=${options.maxAge}`, ...(options.secure ? ['Secure'] : [])].join('; ');
}

/** The session cookie, for the whole site */
export function sessionCookie(value: string, options: CookieOptions): string {
    return httpOnlyCookie(SESSION_COOKIE, value, options);
}
