import type { UiToolDefinition } from '@punyts/stateui-mcp';
import { textsOf } from '../http/text.js';
import { LANGUAGES } from '../prefs/Preferences.js';
import { run } from './run.js';

/** Each English text of Magnetic, by its words, to look a content value up */
const KEY_OF = new Map<string, string>(Object.entries(textsOf('en')).map(([key, text]) => [text, key]));

/**
 * The translations of one tree in one language: every content value (a `_` key) whose English words are one of
 * Magnetic's texts, at its path from `root`. Words that are not Magnetic's (an app name, data) are left out
 */
export function localeOperations(tree: unknown, language: (typeof LANGUAGES)[number], at = 'root'): { op: 'set'; path: string; value: string }[] {
    const texts = textsOf(language) as Record<string, string>;
    const operations: { op: 'set'; path: string; value: string }[] = [];
    const visit = (value: unknown, path: string): void => {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
        for (const [key, inner] of Object.entries(value)) {
            const here = `${path}.${key}`;
            if (key.startsWith('_') && typeof inner === 'string') {
                const textKey = KEY_OF.get(inner);
                if (textKey !== undefined && texts[textKey] !== undefined && texts[textKey] !== inner) operations.push({ op: 'set', path: here, value: texts[textKey] });
            } else if (!key.startsWith('<-') && key !== 'on') {
                visit(inner, here);
            }
        }
    };
    visit(tree, at);
    return operations;
}

/**
 * Writes every language Magnetic speaks into an app made in English, one screen at a time, with the agent's own tool
 * (`ui_locale_write`); answers the app's revision after the last write
 */
export async function writeLocales(tools: readonly UiToolDefinition[], app: string, screens: Readonly<Record<string, unknown>>, revision: number): Promise<number> {
    let now = revision;
    for (const language of LANGUAGES) {
        if (language === 'en') continue;
        for (const [screen, root] of Object.entries(screens)) {
            const operations = localeOperations(root, language);
            // The tool takes at most 50 operations a call
            for (let start = 0; start < operations.length; start += 50) {
                const written = await run(tools, 'ui_locale_write', { app, screen, language, expectedRevision: now, operations: operations.slice(start, start + 50) });
                if (typeof written['revision'] === 'number') now = written['revision'];
            }
        }
    }
    return now;
}
