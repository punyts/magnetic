import { lookup as dnsLookup } from 'node:dns';
import type { LookupAddress } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';

/** How long a call may take, and how much of an answer is read */
export const CALL_TIMEOUT_MS = 10_000;
export const MAX_ANSWER_BYTES = 1_000_000;

/** What a guarded call may reach: tests and a development server on loopback may allow http and private addresses */
export interface GuardOptions {
    readonly allowHttp?: boolean;
    readonly allowPrivate?: boolean;
}

/** A call refused before it went out, or an answer that broke a limit: its message is safe to show the app's owner */
export class CallRefused extends Error {}

/**
 * The addresses an app may never reach: this machine, private networks, link-local (the cloud's metadata service at
 * 169.254.169.254), carrier-grade NAT, benchmarking, documentation, multicast and reserved ranges, in IPv4 and IPv6
 * (an IPv4-mapped IPv6 address is checked as its IPv4 address)
 */
const BLOCKED = new BlockList();
for (const [network, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4]
] as const) {
    BLOCKED.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
    ['::', 128],
    ['::1', 128],
    ['64:ff9b::', 96],
    ['100::', 64],
    ['2001:db8::', 32],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8]
] as const) {
    BLOCKED.addSubnet(network, prefix, 'ipv6');
}

/** Whether an address is one an app may never reach */
export function isBlockedAddress(address: string): boolean {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped !== null) return BLOCKED.check(mapped[1] as string, 'ipv4');
    const family = isIP(address);
    if (family === 0) return true;
    return BLOCKED.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/** A URL a call may go to: https (or http where allowed), no user or password, and an address that is not blocked when it is one */
export function checkUrl(url: string, options: GuardOptions = {}): URL {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new CallRefused('That is not a URL.');
    }
    if (parsed.protocol !== 'https:' && !(options.allowHttp === true && parsed.protocol === 'http:')) throw new CallRefused('Only https addresses can be called.');
    if (parsed.username !== '' || parsed.password !== '') throw new CallRefused('A URL may not carry a user or password: give the key to the connection instead.');
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) !== 0 && !options.allowPrivate && isBlockedAddress(host)) throw new CallRefused('That address is not on the public internet.');
    if (!options.allowPrivate && /(^|\.)(localhost|local|internal)$/i.test(host)) throw new CallRefused('That address is not on the public internet.');
    return parsed;
}

/** What a guarded call answers */
export interface GuardedAnswer {
    readonly status: number;
    readonly contentType: string;
    readonly body: string;
}

/**
 * Calls a URL with the guards: the URL checked (`checkUrl`), every address its name resolves to checked as the
 * connection is made (so a name cannot resolve to a public address when checked and a private one when used), no
 * redirect followed, at most `CALL_TIMEOUT_MS` and `MAX_ANSWER_BYTES`. Headers and body go as given
 */
export function guardedCall(
    url: string,
    init: { readonly method: string; readonly headers?: Record<string, string>; readonly body?: string; readonly signal?: AbortSignal },
    options: GuardOptions = {}
): Promise<GuardedAnswer> {
    const target = checkUrl(url, options);
    const lookup = (hostname: string, lookupOptions: { all?: boolean }, callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void): void => {
        dnsLookup(hostname, { all: true }, (error, addresses) => {
            if (error !== null) {
                callback(error, '', 0);
                return;
            }
            const list = addresses as LookupAddress[];
            if (!options.allowPrivate && (list.length === 0 || list.some((entry) => isBlockedAddress(entry.address)))) {
                callback(Object.assign(new CallRefused('That address is not on the public internet.'), { code: 'EBLOCKED' }), '', 0);
                return;
            }
            if (lookupOptions.all === true) callback(null, list);
            else callback(null, (list[0] as LookupAddress).address, (list[0] as LookupAddress).family);
        });
    };
    return new Promise((resolve, reject) => {
        const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
        const outgoing = send(
            target,
            { method: init.method, headers: { 'User-Agent': 'Magnetic', Accept: 'application/json, text/plain;q=0.8, */*;q=0.5', ...init.headers }, lookup: lookup as never, timeout: CALL_TIMEOUT_MS },
            (incoming) => {
                const status = incoming.statusCode ?? 0;
                if (status >= 300 && status < 400) {
                    incoming.resume();
                    reject(new CallRefused(`The API answered ${status} (a redirect); redirects are not followed.`));
                    return;
                }
                const chunks: Buffer[] = [];
                let size = 0;
                incoming.on('data', (chunk: Buffer) => {
                    size += chunk.length;
                    if (size > MAX_ANSWER_BYTES) {
                        incoming.destroy();
                        reject(new CallRefused(`The answer is larger than ${MAX_ANSWER_BYTES / 1_000_000} MB.`));
                        return;
                    }
                    chunks.push(chunk);
                });
                incoming.on('end', () => resolve({ status, contentType: String(incoming.headers['content-type'] ?? ''), body: Buffer.concat(chunks).toString('utf8') }));
                incoming.on('error', reject);
            }
        );
        const timer = setTimeout(() => outgoing.destroy(new CallRefused(`The API did not answer within ${CALL_TIMEOUT_MS / 1000} seconds.`)), CALL_TIMEOUT_MS);
        outgoing.on('close', () => clearTimeout(timer));
        outgoing.on('timeout', () => outgoing.destroy(new CallRefused(`The API did not answer within ${CALL_TIMEOUT_MS / 1000} seconds.`)));
        outgoing.on('error', (error) => reject(error instanceof CallRefused ? error : new CallRefused(`The call failed: ${(error as NodeJS.ErrnoException).code ?? error.message}`)));
        init.signal?.addEventListener('abort', () => outgoing.destroy(new CallRefused('The call was replaced by a newer one.')), { once: true });
        if (init.body !== undefined) outgoing.write(init.body);
        outgoing.end();
    });
}
