import { addListener, setCategories } from '@punyts/core';

/** Milliseconds since `start` (a `performance.now()`), rounded to a tenth */
export const msSince = (start: number): number => Math.round((performance.now() - start) * 10) / 10;

/** A segment that is a word of a route ("edit", "views", "Users", "magnetic.css"), not an id, a token or a name someone chose */
const WORD = /^(?:[A-Za-z][a-z]*(?:[-.][a-z]+)*|v[0-9])$/;

/** Segments whose next segment is always an id, a code or a token, even when it looks like a word */
const BEFORE_ID = new Set(['s', 'beta', 'link', 'allow', 'invites', 'shares', 'share', 'edit', 'apps', 'Users', 'Groups', 'feedback', 'people', 'orgs', 'grants', 'saml', 'v2', 'members', 'groups', 'domains', 'instances']);

/**
 * A request's path as a route pattern, for a report: each segment that is not a plain word, or follows a segment that
 * an id follows, is `:id`, so no token, code, id or name reaches the log (`/signin/link/<token>` is `/signin/link/:id`)
 */
export function routeOf(path: string): string {
    const segments = path.split('/');
    return segments.map((segment, index) => (index === 0 || segment === '' || (WORD.test(segment) && segment.length <= 32 && !BEFORE_ID.has(segments[index - 1] as string)) ? segment : ':id')).join('/');
}

/** A comma-separated list of categories, with blanks dropped */
export function parseCategories(text: string): string[] {
    return text
        .split(',')
        .map((category) => category.trim())
        .filter((category) => category !== '');
}

/**
 * Listens to `@punyts/core`'s default reporter, where the libraries and Magnetic's own areas report: warnings and errors
 * always, and the categories `--report`/`PUNYTS_REPORT` name, each written as one line `[<name>] category message details`
 */
export function listenToLibraries(name: string, categories: readonly string[], write: (line: string) => void): void {
    const on = [...new Set(['warning', 'error', ...categories])];
    setCategories(on);
    addListener((_timestamp, category, message, details) => {
        write(`[${name}] ${category} ${message}${details === undefined ? '' : ` ${JSON.stringify(details)}`}\n`);
    }, on);
}
