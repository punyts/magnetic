/** What the component library's search reads of an entry */
export interface LibraryEntry {
    readonly name: string;
    readonly category: string;
    readonly summary?: string;
    readonly purposes?: readonly string[];
}

/**
 * The entries of the component library the Add tab shows for what is typed in its search, within a category (`all`
 * for every one), best first and at most `limit`: an entry named exactly what was typed, then those whose name starts
 * with it, then those whose name has it, then those whose summary or purposes have it. Entries of the same rank keep
 * the library's order, and with nothing typed the category's entries are shown as they are. Case does not matter.
 *
 * This function is also the inspector script's `rankLibrary`: `LIBRARY_RANK_JS` is its own text. So it must stay
 * self-contained, using only its arguments and the language
 */
export function rankLibrary<Entry extends LibraryEntry>(library: readonly Entry[], search: string, category: string, limit: number): Entry[] {
    const words = String(search || '').trim().toLowerCase();
    const within = library.filter((entry) => category === 'all' || entry.category === category);
    if (words === '') return within.slice(0, limit);
    const rankOf = (entry: Entry): number => {
        const name = String(entry.name || '').toLowerCase();
        if (name === words) return 0;
        if (name.startsWith(words)) return 1;
        if (name.includes(words)) return 2;
        const about = [entry.summary || '', ...(entry.purposes || [])].join(' ').toLowerCase();
        return about.includes(words) ? 3 : -1;
    };
    return within
        .map((entry, index) => ({ entry, index, rank: rankOf(entry) }))
        .filter((ranked) => ranked.rank >= 0)
        .sort((a, b) => a.rank - b.rank || a.index - b.index)
        .slice(0, limit)
        .map((ranked) => ranked.entry);
}

/** `rankLibrary(library, search, category, limit)` in the inspector script: the text of `rankLibrary` itself */
export const LIBRARY_RANK_JS = `${rankLibrary.toString()}\n`;
