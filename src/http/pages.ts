import { escapeHtml } from '@punyts/stateui-mcp';
import type { User } from '../accounts/Accounts.js';

/** The policy of Magnetic's own pages: its stylesheet, forms that post to itself, profile pictures over HTTPS */
export const MAGNETIC_PAGE_CSP = ["default-src 'none'", "style-src 'self'", 'img-src https: data:', "form-action 'self'", "base-uri 'none'", "frame-ancestors 'none'"].join('; ');

/** The stylesheet of Magnetic's own pages, served as `/assets/magnetic.css`. A file, because the policy forbids inline styles */
export const MAGNETIC_CSS = `:root { color-scheme: light dark; --ink: #1b1d22; --muted: #5d6470; --line: #d9dce2; --paper: #ffffff; --accent: #3047d8; }
@media (prefers-color-scheme: dark) { :root { --ink: #e8eaee; --muted: #a2a8b3; --line: #343842; --paper: #15171c; --accent: #8c9cff; } }
html, body { margin: 0; background: var(--paper); color: var(--ink); font-family: system-ui, sans-serif; }
main { max-width: 44rem; margin: 0 auto; padding: 2.5rem 1rem; }
header { display: flex; align-items: center; gap: 0.75rem; justify-content: space-between; margin-bottom: 2rem; }
h1 { font-size: 1.5rem; margin: 0; letter-spacing: -0.01em; }
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
            '<header><h1>Magnetic</h1></header>',
            '<p>Describe an app, and watch it being built.</p>',
            options.error === undefined ? '' : `<p class="error" role="alert">${escapeHtml(options.error)}</p>`,
            `<div class="stack">${providers}</div>`,
            options.devUsers.length === 0 ? '' : `<h2>Development users</h2><p class="muted">Only a server on this machine offers these.</p><div class="stack">${dev}</div>`,
            options.providers.length === 0 && options.devUsers.length === 0 ? '<p class="muted">No way to sign in is set up on this server.</p>' : ''
        ].join('\n')
    );
}

export interface AppsPageOptions {
    readonly user: User;
    /** Why the last new app was not made */
    readonly error?: string;
    readonly apps: readonly { readonly id: string; readonly name: string; readonly updatedAt: Date }[];
}

/** `GET /`: the signed-in user's apps */
export function appsPage(options: AppsPageOptions): string {
    const { user, apps } = options;
    const picture = user.picture !== undefined && user.picture.startsWith('https://') ? `<img alt="" src="${escapeHtml(user.picture)}">` : '';
    const rows = [...apps]
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .map((app) => `<li><a href="/edit/${escapeHtml(app.id)}">${escapeHtml(app.name)}</a><span class="muted"><a href="/apps/${escapeHtml(app.id)}">Open</a> · ${escapeHtml(app.updatedAt.toISOString().slice(0, 10))}</span></li>`)
        .join('\n');
    return page(
        'Magnetic',
        [
            '<header>',
            '<h1>Your apps</h1>',
            `<div class="who">${picture}<span>${escapeHtml(user.name)}</span><form class="inline" method="post" action="/signout"><button type="submit">Sign out</button></form></div>`,
            '</header>',
            '<form class="new" method="post" action="/new"><label for="new-name">New app</label><input id="new-name" name="name" maxlength="60" placeholder="todo-list" required><button type="submit" class="primary">Create</button></form>',
            options.error === undefined ? '' : `<p class="error" role="alert">${escapeHtml(options.error)}</p>`,
            apps.length === 0 ? '<p class="muted">No apps yet.</p>' : `<ul class="list">\n${rows}\n</ul>`
        ].join('\n')
    );
}
