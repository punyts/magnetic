/**
 * How a page script hears the app it mounts (docs/design/state-definitions-and-instances.md): the runtime reports each
 * event of a node that carries an `@id` (`RaisedReport { id, event, value?, row? }`, raised on the panel's element as
 * `stateui:raised`), and each page has a table that reads `<id>.<event>` as the name its code acts on and the payload.
 */

/** What a page script hears from one event of a node with an `@id` */
export interface Heard {
    /** The name the script's code acts on; none for an event it only keeps */
    readonly name?: string;
    /**
     * Where the payload comes from: `value` (the event's own, the default), `value.<field>`, `row` (the record of a node
     * in a row template), `row.<field>`, or a state path the script keeps (`keep`, or what it writes there itself)
     */
    readonly from?: string;
    /** A state path whose value the script keeps from this event (a field's change, `{ value }`) */
    readonly keep?: string;
    /** With `from` `row`: the field of the row that takes the event's value (a field's change in a row template) */
    readonly merge?: string;
    /** A fixed payload in place of `from`: which of several buttons of one kind was pressed */
    readonly send?: string;
}

/** A page's table: `<id>.<event>` to what the script hears */
export type Hearing = Readonly<Record<string, Heard>>;

/** The ids a page's table hears, each once: the ids a copy of the page must keep */
export function hearingIds(hearing: Hearing): string[] {
    return [...new Set(Object.keys(hearing).map((key) => key.slice(0, key.lastIndexOf('.'))))];
}

/**
 * `hearingOf(table)` in a page script: `heard(report)` answers `{ name, payload }` for a report the table names (and
 * keeps what it says to keep), else undefined; `keep(path, value)` records what the script writes to a state path a
 * press reads, and `known(path)` reads it back, with what was kept below it since.
 */
export const HEARING_JS = String.raw`function hearingOf(table) {
    const kept = {};
    const at = (value, field) => (value !== null && typeof value === 'object' ? value[field] : undefined);
    const fieldValue = (value) => (value !== null && typeof value === 'object' && !Array.isArray(value) && 'value' in value ? value.value : value);
    const segments = (path) => path.split('.').slice(1);
    const keep = (path, value) => {
        const names = segments(path);
        let into = kept;
        for (const name of names.slice(0, -1)) {
            if (into[name] === null || typeof into[name] !== 'object' || Array.isArray(into[name])) into[name] = {};
            into = into[name];
        }
        into[names[names.length - 1]] = value !== null && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
    };
    const known = (path) => segments(path).reduce((value, name) => at(value, name), kept);
    return {
        keep,
        known,
        heard(report) {
            if (!report || typeof report.id !== 'string' || typeof report.event !== 'string') return undefined;
            const entry = table[report.id + '.' + report.event];
            if (!entry) return undefined;
            if (entry.keep) keep(entry.keep, fieldValue(report.value));
            if (!entry.name) return undefined;
            if (entry.send !== undefined) return { name: entry.name, payload: entry.send };
            const from = entry.from || 'value';
            const dot = from.indexOf('.');
            const root = dot < 0 ? from : from.slice(0, dot);
            let payload;
            if (root === 'value' || root === 'row') payload = dot < 0 ? report[root] : at(report[root], from.slice(dot + 1));
            else payload = known(from);
            if (entry.merge && payload !== null && typeof payload === 'object') payload = { ...payload, [entry.merge]: fieldValue(report.value) };
            return { name: entry.name, payload };
        }
    };
}
`;

/** A page's table in its script, as `const <name> = hearingOf(...)` */
export function hearingJs(name: string, hearing: Hearing): string {
    return 'const ' + name + ' = hearingOf(' + JSON.stringify(hearing) + ');\n';
}
