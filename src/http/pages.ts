import type { Language, Mode } from '../prefs/Preferences.js';

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
main.settings { max-width: 60rem; }
main.settings header nav { display: flex; gap: 0.5rem; flex-wrap: wrap; }
main.settings input, main.settings select { font: inherit; padding: 0.4rem 0.5rem; border-radius: 0.5rem; border: 1px solid var(--line); background: var(--paper); color: var(--ink); max-width: 100%; }
main.settings .stack label { display: grid; gap: 0.25rem; }
main.settings .stack.wide { max-width: 34rem; }
main.settings form.row { display: flex; gap: 0.5rem; align-items: end; flex-wrap: wrap; margin-top: 0.75rem; }
main.settings div.row { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin: 0.5rem 0; }
main.settings form.spaced { display: block; margin-top: 0.75rem; }
main.settings div.table { overflow-x: auto; }
main.settings dl.balance { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: 0.75rem; margin: 1rem 0 2rem; }
main.settings dl.balance div { border: 1px solid var(--line); border-radius: 0.5rem; padding: 0.75rem; }
main.settings dl.balance dt { color: var(--muted); font-size: 0.875rem; }
main.settings dl.balance dd { margin: 0.25rem 0 0; font-size: 1.25rem; }
main.settings form.inline button + button { margin-left: 0.25rem; }
main.settings table { width: 100%; border-collapse: collapse; }
main.settings th, main.settings td { text-align: left; vertical-align: top; padding: 0.5rem 0.4rem; border-bottom: 1px solid var(--line); }
main.settings th { color: var(--muted); font-weight: 600; font-size: 0.9rem; }
main.settings table.audit code { font-size: 0.8rem; overflow-wrap: anywhere; }
main.settings ul.plain { list-style: none; padding: 0; margin: 0.5rem 0; display: grid; gap: 0.25rem; }
main.settings ul.list li.app { display: block; }
main.settings .app-head { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
main.settings .app-head a.button { margin-left: auto; padding: 0.25rem 0.7rem; }
main.settings h4 { margin: 0.75rem 0 0.25rem; font-size: 0.95rem; }
main.settings fieldset { border: 1px solid var(--line); border-radius: 0.5rem; display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; }
main.settings label.check { display: flex; gap: 0.35rem; align-items: center; }
main.settings .chip { display: inline-flex; align-items: center; gap: 0.25rem; border: 1px solid var(--line); border-radius: 1rem; padding: 0.1rem 0.6rem; margin: 0.15rem 0.15rem 0 0; }
main.settings button.link { border: none; padding: 0 0.25rem; color: var(--accent); background: none; }
main.settings button.danger { color: var(--bad); }
main.settings .notice { border: 1px solid var(--accent); border-radius: 0.5rem; padding: 0.6rem 0.8rem; }
main.settings code.link { overflow-wrap: anywhere; user-select: all; }
main.admin .chip { color: var(--ink); text-decoration: none; }
main.admin .chip[aria-current] { border-color: var(--accent); color: var(--accent); font-weight: 600; }
main.admin header nav a[aria-current] { border-color: var(--accent); color: var(--accent); }
main.admin ul.feedback li { display: block; }
main.admin ul.feedback li.done { opacity: 0.6; }
main.admin p.said { white-space: pre-wrap; margin: 0.5rem 0; }
main.admin p.small { font-size: 0.8rem; margin: 0 0 0.5rem; overflow-wrap: anywhere; }
main.admin form.give { display: flex; gap: 0.25rem; flex-wrap: wrap; }
main.admin form.give input[name=dollars] { width: 4rem; }
main.admin form.give input[name=note] { width: 8rem; }
main.admin dl.balance dd a { color: var(--accent); }
main.admin input.link { box-sizing: border-box; width: 100%; max-width: 40rem; font-family: ui-monospace, monospace; }
main.settings pre { background: color-mix(in srgb, var(--line) 35%, transparent); padding: 0.75rem; border-radius: 0.5rem; overflow-x: auto; font-size: 0.85rem; }
`;

/** An app another person shared with the user */
export interface SharedApp {
    readonly appId: string;
    readonly name: string;
    readonly right: 'view' | 'use';
    readonly ownerName: string;
}
