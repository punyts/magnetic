import { escapeHtml } from '@punyts/stateui-mcp';
import { FAVICON_LINK, LOGO_MARK } from './logo.js';

/** The policy of Magnetic's own pages: its stylesheet, forms that post to itself, profile pictures over HTTPS */
export const MAGNETIC_PAGE_CSP = ["default-src 'none'", "style-src 'self'", 'img-src https: data:', "form-action 'self'", "base-uri 'none'", "frame-ancestors 'none'"].join('; ');

/** The stylesheet of Magnetic's own pages, served as `/assets/magnetic.css`. A file, because the policy forbids inline styles */
export const MAGNETIC_CSS = `:root { color-scheme: light dark; --ink: #1b1d22; --muted: #5d6470; --line: #d9dce2; --paper: #ffffff; --accent: #3047d8; }
@media (prefers-color-scheme: dark) { :root { --ink: #e8eaee; --muted: #a2a8b3; --line: #343842; --paper: #15171c; --accent: #8c9cff; } }
html, body { margin: 0; background: var(--paper); color: var(--ink); font-family: system-ui, sans-serif; }
main { max-width: 44rem; margin: 0 auto; padding: 2.5rem 1rem; }
header { display: flex; align-items: center; gap: 0.75rem; justify-content: space-between; margin-bottom: 2rem; }
h1 { font-size: 1.5rem; margin: 0; letter-spacing: -0.01em; }
h1.brand { display: flex; align-items: center; gap: 0.6rem; font-size: 1.75rem; }
h1.brand .mark { width: 2.5rem; height: 2.5rem; }
p.muted, .muted { color: var(--muted); }
form.inline { display: inline; }
button, a.button { font: inherit; padding: 0.5rem 0.9rem; border-radius: 0.5rem; border: 1px solid var(--line); background: transparent; color: var(--ink); cursor: pointer; text-decoration: none; }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--paper); }
ul.list { list-style: none; padding: 0; margin: 0; border-top: 1px solid var(--line); }
ul.list li { border-bottom: 1px solid var(--line); padding: 0.75rem 0.25rem; display: flex; justify-content: space-between; gap: 1rem; }
ul.list a { color: var(--accent); }
.who { display: flex; align-items: center; gap: 0.5rem; }
.who img { width: 2rem; height: 2rem; border-radius: 50%; }
.error { color: #c0392b; }
@media (prefers-color-scheme: dark) { .error { color: #ff8a7a; } }
form.new { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 1.5rem; }
h2 { font-size: 1.1rem; margin: 2rem 0 0.75rem; }
form.new input { flex: 1; font: inherit; padding: 0.5rem; border-radius: 0.5rem; border: 1px solid var(--line); background: var(--paper); color: var(--ink); }
.stack { display: grid; gap: 0.75rem; max-width: 20rem; }
`;

function page(title: string, body: string): string {
    return [
        '<!doctype html>',
        '<html lang="en">',
        '<head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        `<title>${escapeHtml(title)}</title>`,
        FAVICON_LINK,
        '<link rel="stylesheet" href="/assets/magnetic.css">',
        '</head>',
        `<body><main>${body}</main></body>`,
        '</html>',
        ''
    ].join('\n');
}

export interface SignInPageOptions {
    /** The test users of a development server, each a button; empty on a public server */
    readonly devUsers: readonly string[];
    /** The providers people sign in with, each a button that starts its flow at `/auth/<name>` */
    readonly providers: readonly { readonly name: string; readonly label: string }[];
    /** Where to go after signing in, a path of this server already made safe; default `/` */
    readonly next?: string;
    /** Why the last sign-in did not finish */
    readonly error?: string;
}

/** `GET /signin` */
export function signInPage(options: SignInPageOptions): string {
    const next = options.next ?? '/';
    const query = next === '/' ? '' : `?next=${encodeURIComponent(next)}`;
    const nextField = next === '/' ? '' : `<input type="hidden" name="next" value="${escapeHtml(next)}">`;
    const providers = options.providers.map((provider) => `<a class="button primary" href="/auth/${escapeHtml(provider.name)}${escapeHtml(query)}">${escapeHtml(provider.label)}</a>`).join('\n');
    const dev = options.devUsers
        .map((name) => `<form class="inline" method="post" action="/signin/dev"><input type="hidden" name="user" value="${escapeHtml(name)}">${nextField}<button type="submit">Sign in as ${escapeHtml(name)}</button></form>`)
        .join('\n');
    return page(
        'Sign in to Magnetic',
        [
            `<header><h1 class="brand">${LOGO_MARK}Magnetic</h1></header>`,
            '<p>Describe an app, and watch it being built.</p>',
            options.error === undefined ? '' : `<p class="error" role="alert">${escapeHtml(options.error)}</p>`,
            `<div class="stack">${providers}</div>`,
            options.devUsers.length === 0 ? '' : `<h2>Development users</h2><p class="muted">Only a server on this machine offers these.</p><div class="stack">${dev}</div>`,
            options.providers.length === 0 && options.devUsers.length === 0 ? '<p class="muted">No way to sign in is set up on this server.</p>' : ''
        ].join('\n')
    );
}

/** An app another person shared with the user */
export interface SharedApp {
    readonly appId: string;
    readonly name: string;
    readonly right: 'view' | 'use';
    readonly ownerName: string;
}

export interface LinkPageOptions {
    readonly title: string;
    readonly message: string;
    /** A live remix link: the page offers to copy the app */
    readonly remix?: { readonly token: string };
}

/** `GET /s/<token>` when the link does not open an app at once: a remix offer, or why the link does not work */
export function linkPage(options: LinkPageOptions): string {
    return page(
        options.title,
        [
            `<header><h1>${escapeHtml(options.title)}</h1><a href="/">Your apps</a></header>`,
            `<p>${escapeHtml(options.message)}</p>`,
            options.remix === undefined
                ? ''
                : `<form method="post" action="/s/${escapeHtml(options.remix.token)}/remix"><button type="submit" class="primary">Remix</button></form><p class="muted">The copy is yours: you can change it and share it. It starts from the app as it is now, without anyone's data.</p>`
        ].join('\n')
    );
}
