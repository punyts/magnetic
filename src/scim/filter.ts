import { ScimError } from './schemas.js';

/**
 * One comparison of a SCIM filter: `attribute eq value`, with the attribute's name in lower case and dotted
 * (`username`, `emails.value`, `members.value`). `emails[type eq "work"].value eq "…"` keeps the bracketed test in
 * `within`; `members[value eq "…"]` alone is `members.value eq "…"`
 */
export interface FilterTerm {
    readonly attribute: string;
    readonly value: string | boolean;
    readonly within?: { readonly attribute: string; readonly value: string | boolean };
}

/** The longest filter taken */
const MAX_FILTER = 1000;

/** Splits a filter into words, quoted strings and brackets */
function tokensOf(filter: string): string[] {
    const tokens: string[] = [];
    let at = 0;
    while (at < filter.length) {
        const char = filter[at] as string;
        if (/\s/.test(char)) {
            at++;
        } else if (char === '"') {
            let end = at + 1;
            while (end < filter.length && filter[end] !== '"') end += filter[end] === '\\' ? 2 : 1;
            if (end >= filter.length) throw invalid();
            tokens.push(filter.slice(at, end + 1));
            at = end + 1;
        } else if (char === '[' || char === ']' || char === '(' || char === ')') {
            tokens.push(char);
            at++;
        } else {
            let end = at;
            while (end < filter.length && !/[\s"[\]()]/.test(filter[end] as string)) end++;
            tokens.push(filter.slice(at, end));
            at = end;
        }
    }
    return tokens;
}

const invalid = (): ScimError => new ScimError(400, 'The filter is not one this server takes: use eq on userName, externalId, emails, displayName, id or members, joined by and.', 'invalidFilter');

function valueOf(token: string | undefined): string | boolean {
    if (token === undefined) throw invalid();
    if (token.startsWith('"')) {
        try {
            return JSON.parse(token) as string;
        } catch {
            throw invalid();
        }
    }
    if (/^true$/i.test(token)) return true;
    if (/^false$/i.test(token)) return false;
    throw invalid();
}

const NAME = /^[A-Za-z][A-Za-z0-9_$-]*(\.[A-Za-z][A-Za-z0-9_$-]*)?$/;
const CORE = /^urn:ietf:params:scim:schemas:core:2\.0:(User|Group):/i;

function nameOf(token: string | undefined): string {
    const name = (token ?? '').replace(CORE, '');
    if (!NAME.test(name)) throw invalid();
    return name.toLowerCase();
}

/**
 * Parses the filters SCIM clients send to find a user or a group: comparisons with `eq`, joined by `and`. Anything else
 * (`or`, `not`, `co`, `sw`, `pr`, grouping) is refused as `invalidFilter`
 */
export function parseFilter(filter: string): FilterTerm[] {
    if (filter.length > MAX_FILTER) throw invalid();
    const tokens = tokensOf(filter);
    const terms: FilterTerm[] = [];
    let at = 0;
    for (;;) {
        const attribute = nameOf(tokens[at++]);
        if (tokens[at] === '[') {
            const inner = nameOf(tokens[at + 1]);
            if (!/^eq$/i.test(tokens[at + 2] ?? '')) throw invalid();
            const innerValue = valueOf(tokens[at + 3]);
            if (tokens[at + 4] !== ']') throw invalid();
            at += 5;
            const sub = tokens[at]?.startsWith('.') === true ? nameOf(tokens[at++]?.slice(1)) : undefined;
            if (sub === undefined) {
                // `members[value eq "…"]`: has such a member
                terms.push({ attribute: `${attribute}.${inner}`, value: innerValue });
            } else {
                if (!/^eq$/i.test(tokens[at] ?? '')) throw invalid();
                terms.push({ attribute: `${attribute}.${sub}`, value: valueOf(tokens[at + 1]), within: { attribute: inner, value: innerValue } });
                at += 2;
            }
        } else {
            if (!/^eq$/i.test(tokens[at] ?? '')) throw invalid();
            terms.push({ attribute, value: valueOf(tokens[at + 1]) });
            at += 2;
        }
        if (at >= tokens.length) return terms;
        if (!/^and$/i.test(tokens[at] ?? '')) throw invalid();
        at++;
    }
}
