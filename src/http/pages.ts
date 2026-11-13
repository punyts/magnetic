import { escapeHtml } from '@punyts/stateui-mcp';
import type { Language, Mode } from '../prefs/Preferences.js';
import { FAVICON_LINK, LOGO_MARK } from './logo.js';
import { fill, textsOf } from './text.js';

/** How a page of Magnetic looks and speaks: the person's choice, or the browser's language and the system's mode */
export interface PageLook {
    readonly language: Language;
    readonly mode: Mode;
}

/** The colours of Magnetic's pages: light, then dark from the system unless the person chose light, or dark by choice */
export function schemeCss(light: string, dark: string): string {
    return `:root { color-scheme: light dark; ${light} }
:root[data-mode="light"] { color-scheme: light; }
:root[data-mode="dark"] { color-scheme: dark; ${dark} }
@media (prefers-color-scheme: dark) { :root:not([data-mode="light"]) { ${dark} } }`;
}

/** The opening `<html>` of a page in a language and mode */
export function htmlOpen(look: PageLook): string {
    return `<html lang="${look.language}" data-mode="${look.mode}">`;
}

/** The policy of Magnetic's own pages: its stylesheet, forms that post to itself, profile pictures over HTTPS */
export const MAGNETIC_PAGE_CSP = ["default-src 'none'", "style-src 'self'", 'img-src https: data:', "form-action 'self'", "base-uri 'none'", "frame-ancestors 'none'"].join('; ');

/** The stylesheet of Magnetic's own pages, served as `/assets/magnetic.css`. A file, because the policy forbids inline styles */
export const MAGNETIC_CSS = `${schemeCss('--ink: #1b1d22; --muted: #5d6470; --line: #d9dce2; --paper: #ffffff; --accent: #3047d8; --bad: #c0392b;', '--ink: #e8eaee; --muted: #a2a8b3; --line: #343842; --paper: #15171c; --accent: #8c9cff; --bad: #ff8a7a;')}
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
.error { color: var(--bad); }
form.new { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 1.5rem; }
h2 { font-size: 1.1rem; margin: 2rem 0 0.75rem; }
form.new input { flex: 1; font: inherit; padding: 0.5rem; border-radius: 0.5rem; border: 1px solid var(--line); background: var(--paper); color: var(--ink); }
.stack { display: grid; gap: 0.75rem; max-width: 20rem; }
`;

function page(look: PageLook, title: string, body: string): string {
    return [
        '<!doctype html>',
        htmlOpen(look),
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
    readonly look: PageLook;
}

/** `GET /signin` */
export function signInPage(options: SignInPageOptions): string {
    const t = textsOf(options.look.language);
    const next = options.next ?? '/';
    const query = next === '/' ? '' : `?next=${encodeURIComponent(next)}`;
    const nextField = next === '/' ? '' : `<input type="hidden" name="next" value="${escapeHtml(next)}">`;
    const providers = options.providers.map((provider) => `<a class="button primary" href="/auth/${escapeHtml(provider.name)}${escapeHtml(query)}">${escapeHtml(provider.label)}</a>`).join('\n');
    const dev = options.devUsers
        .map((name) => `<form class="inline" method="post" action="/signin/dev"><input type="hidden" name="user" value="${escapeHtml(name)}">${nextField}<button type="submit">${escapeHtml(fill(t['signin.as'], { name }))}</button></form>`)
        .join('\n');
    return page(
        options.look,
        t['signin.title'],
        [
            `<header><h1 class="brand">${LOGO_MARK}Magnetic</h1></header>`,
            `<p>${escapeHtml(t['signin.tagline'])}</p>`,
            options.error === undefined ? '' : `<p class="error" role="alert">${escapeHtml(options.error)}</p>`,
            `<div class="stack">${providers}</div>`,
            options.devUsers.length === 0 ? '' : `<h2>${escapeHtml(t['signin.devTitle'])}</h2><p class="muted">${escapeHtml(t['signin.devNote'])}</p><div class="stack">${dev}</div>`,
            options.providers.length === 0 && options.devUsers.length === 0 ? `<p class="muted">${escapeHtml(t['signin.none'])}</p>` : ''
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
    readonly look: PageLook;
}

/** `GET /s/<token>` when the link does not open an app at once: a remix offer, or why the link does not work */
export function linkPage(options: LinkPageOptions): string {
    const t = textsOf(options.look.language);
    return page(
        options.look,
        options.title,
        [
            `<header><h1>${escapeHtml(options.title)}</h1><a href="/">${escapeHtml(t['link.yourApps'])}</a></header>`,
            `<p>${escapeHtml(options.message)}</p>`,
            options.remix === undefined
                ? ''
                : `<form method="post" action="/s/${escapeHtml(options.remix.token)}/remix"><button type="submit" class="primary">${escapeHtml(t['link.remix'])}</button></form><p class="muted">${escapeHtml(t['link.remixNote'])}</p>`
        ].join('\n')
    );
}
