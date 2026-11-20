import { createHash, generateKeyPairSync, randomBytes, sign, X509Certificate } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { join } from 'node:path';

/**
 * A certificate authority of one machine and the server certificates it signs (docs/design/statenet-network.md, S10):
 * so a Magnetic on a local network serves HTTPS with nothing to set up, and the computers that reach it trust the
 * authority once. X.509 is written here as DER, with ECDSA P-256 keys and SHA-256, since Node only reads certificates
 */

/** A key and a certificate, PEM */
export interface KeyAndCertificate {
    readonly key: string;
    readonly cert: string;
}

const AUTHORITY_DAYS = 3650;
/** What browsers accept for a server certificate */
const SERVER_DAYS = 397;
/** A server certificate this close to its end is made again */
const RENEW_DAYS = 30;
const DAY_MS = 86_400_000;

function length(size: number): Buffer {
    if (size < 0x80) return Buffer.from([size]);
    const bytes: number[] = [];
    for (let rest = size; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
    return Buffer.from([0x80 | bytes.length, ...bytes]);
}

const tlv = (tag: number, ...parts: Buffer[]): Buffer => {
    const body = Buffer.concat(parts);
    return Buffer.concat([Buffer.from([tag]), length(body.length), body]);
};
const sequence = (...parts: Buffer[]): Buffer => tlv(0x30, ...parts);
const set = (...parts: Buffer[]): Buffer => tlv(0x31, ...parts);
const octets = (value: Buffer): Buffer => tlv(0x04, value);
const bits = (value: Buffer, unused = 0): Buffer => tlv(0x03, Buffer.from([unused]), value);
const boolean = (value: boolean): Buffer => tlv(0x01, Buffer.from([value ? 0xff : 0]));
const explicit = (n: number, inner: Buffer): Buffer => tlv(0xa0 + n, inner);

function oid(dotted: string): Buffer {
    const [first, second, ...rest] = dotted.split('.').map(Number) as [number, number, ...number[]];
    const out = [40 * first + second];
    for (const arc of rest) {
        const chunk = [arc & 0x7f];
        for (let value = Math.floor(arc / 128); value > 0; value = Math.floor(value / 128)) chunk.unshift((value & 0x7f) | 0x80);
        out.push(...chunk);
    }
    return tlv(0x06, Buffer.from(out));
}

/** A positive INTEGER from big-endian bytes */
function integer(value: Buffer): Buffer {
    let bytes = value;
    while (bytes.length > 1 && bytes[0] === 0 && ((bytes[1] as number) & 0x80) === 0) bytes = bytes.subarray(1);
    if (((bytes[0] as number) & 0x80) !== 0) bytes = Buffer.concat([Buffer.from([0]), bytes]);
    return tlv(0x02, bytes);
}

/** UTCTime, which X.509 uses until 2050 */
function time(date: Date): Buffer {
    const text = date.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z';
    return tlv(date.getUTCFullYear() < 2050 ? 0x17 : 0x18, Buffer.from(date.getUTCFullYear() < 2050 ? text : `${date.getUTCFullYear().toString().slice(0, 2)}${text}`, 'ascii'));
}

const commonName = (name: string): Buffer => sequence(set(sequence(oid('2.5.4.3'), tlv(0x0c, Buffer.from(name, 'utf8')))));
const ECDSA_SHA256 = sequence(oid('1.2.840.10045.4.3.2'));
const extension = (id: string, critical: boolean, value: Buffer): Buffer => sequence(oid(id), ...(critical ? [boolean(true)] : []), octets(value));

/** The bytes of an IPv4 or IPv6 address */
function addressBytes(address: string): Buffer {
    if (isIP(address) === 4) return Buffer.from(address.split('.').map(Number));
    const [head = '', tail] = address.split('::') as [string, string | undefined];
    const groups = (part: string): number[] => (part === '' ? [] : part.split(':').map((group) => parseInt(group, 16)));
    const left = groups(head);
    const right = tail === undefined ? [] : groups(tail);
    const all = [...left, ...new Array<number>(8 - left.length - right.length).fill(0), ...right];
    const out = Buffer.alloc(16);
    all.forEach((group, index) => out.writeUInt16BE(group, index * 2));
    return out;
}

function keyPair(): { privateKey: string; spki: Buffer; keyId: Buffer } {
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const spki = pair.publicKey.export({ type: 'spki', format: 'der' });
    return { privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, spki, keyId: createHash('sha1').update(spki).digest() };
}

function certificate(fields: { subject: string; issuer: string; days: number; spki: Buffer; signWith: string; extensions: Buffer[] }): string {
    const now = Date.now();
    const tbs = sequence(
        explicit(0, integer(Buffer.from([2]))),
        integer(Buffer.concat([Buffer.from([0x01]), randomBytes(15)])),
        ECDSA_SHA256,
        commonName(fields.issuer),
        sequence(time(new Date(now - DAY_MS)), time(new Date(now + fields.days * DAY_MS))),
        commonName(fields.subject),
        fields.spki,
        explicit(3, sequence(...fields.extensions))
    );
    const der = sequence(tbs, ECDSA_SHA256, bits(sign('sha256', tbs, fields.signWith)));
    return `-----BEGIN CERTIFICATE-----\n${der.toString('base64').replace(/.{1,64}/g, '$&\n')}-----END CERTIFICATE-----\n`;
}

/** A new certificate authority, named for the machine it belongs to */
export function makeCertificateAuthority(name: string): KeyAndCertificate {
    const keys = keyPair();
    const cert = certificate({
        subject: name,
        issuer: name,
        days: AUTHORITY_DAYS,
        spki: keys.spki,
        signWith: keys.privateKey,
        extensions: [
            extension('2.5.29.19', true, sequence(boolean(true), integer(Buffer.from([0])))),
            // keyCertSign and cRLSign
            extension('2.5.29.15', true, bits(Buffer.from([0x06]), 1)),
            extension('2.5.29.14', false, octets(keys.keyId))
        ]
    });
    return { key: keys.privateKey, cert };
}

/** A server certificate the authority signs for these host names and addresses */
export function issueServerCertificate(authority: KeyAndCertificate, names: readonly string[]): KeyAndCertificate {
    if (names.length === 0) throw new Error('A server certificate needs at least one name');
    const issuer = new X509Certificate(authority.cert);
    const authorityKeyId = createHash('sha1').update(issuer.publicKey.export({ type: 'spki', format: 'der' })).digest();
    const keys = keyPair();
    const alternatives = names.map((name) => (isIP(name) === 0 ? tlv(0x82, Buffer.from(name.toLowerCase(), 'ascii')) : tlv(0x87, addressBytes(name))));
    const cert = certificate({
        subject: names[0] as string,
        issuer: subjectName(issuer),
        days: SERVER_DAYS,
        spki: keys.spki,
        signWith: authority.key,
        extensions: [
            extension('2.5.29.19', true, sequence()),
            // digitalSignature
            extension('2.5.29.15', true, bits(Buffer.from([0x80]), 7)),
            // serverAuth
            extension('2.5.29.37', false, sequence(oid('1.3.6.1.5.5.7.3.1'))),
            extension('2.5.29.17', false, sequence(...alternatives)),
            extension('2.5.29.14', false, octets(keys.keyId)),
            extension('2.5.29.35', false, sequence(tlv(0x80, authorityKeyId)))
        ]
    });
    return { key: keys.privateKey, cert };
}

/**
 * A certificate the authority signs for a key that signs documents rather than serving TLS, such as the RSA key of
 * the test SAML provider (`src/testing/mockSamlProvider.ts`): `spki` is its public key, DER
 */
export function issueSigningCertificate(authority: KeyAndCertificate, name: string, spki: Buffer): string {
    const issuer = new X509Certificate(authority.cert);
    return certificate({
        subject: name,
        issuer: subjectName(issuer),
        days: SERVER_DAYS,
        spki,
        signWith: authority.key,
        extensions: [
            extension('2.5.29.19', true, sequence()),
            // digitalSignature
            extension('2.5.29.15', true, bits(Buffer.from([0x80]), 7))
        ]
    });
}

function subjectName(cert: X509Certificate): string {
    return /CN=([^\n]+)/.exec(cert.subject)?.[1] ?? '';
}

/** Whether a server certificate names every one of these and has more than `RENEW_DAYS` left */
function covers(cert: string, names: readonly string[], authority: string): boolean {
    const parsed = new X509Certificate(cert);
    if (!parsed.checkIssued(new X509Certificate(authority))) return false;
    if (new Date(parsed.validTo).getTime() - Date.now() < RENEW_DAYS * DAY_MS) return false;
    return names.every((name) => (isIP(name) === 0 ? parsed.checkHost(name) !== undefined : parsed.checkIP(name) !== undefined));
}

async function readPair(dir: string, base: string): Promise<KeyAndCertificate | undefined> {
    try {
        return { key: await readFile(join(dir, `${base}.key`), 'utf8'), cert: await readFile(join(dir, `${base}.crt`), 'utf8') };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
    }
}

async function writePair(dir: string, base: string, pair: KeyAndCertificate): Promise<void> {
    await writeFile(join(dir, `${base}.key`), pair.key, { mode: 0o600 });
    await writeFile(join(dir, `${base}.crt`), pair.cert);
}

/**
 * The local network's TLS of a server, kept in `<dir>`: `authority.crt` and `authority.key`, made once and named for
 * the machine, and `server.crt` and `server.key`, made again when they do not name each of `names` or end within 30
 * days. Another computer trusts `authority.crt` once
 */
export async function localTls(dir: string, machine: string, names: readonly string[]): Promise<KeyAndCertificate & { readonly authorityFile: string; readonly made: boolean }> {
    await mkdir(dir, { recursive: true });
    let authority = await readPair(dir, 'authority');
    if (authority === undefined) {
        authority = makeCertificateAuthority(`Magnetic local authority (${machine})`);
        await writePair(dir, 'authority', authority);
    }
    const server = await readPair(dir, 'server');
    if (server !== undefined && covers(server.cert, names, authority.cert)) return { ...server, authorityFile: join(dir, 'authority.crt'), made: false };
    const made = issueServerCertificate(authority, names);
    await writePair(dir, 'server', made);
    return { ...made, authorityFile: join(dir, 'authority.crt'), made: true };
}

/**
 * The secret key of a server with no `MAGNETIC_SECRET_KEY` (docs/design/statenet-network.md, "Locally"): 32 random
 * bytes made once in `<dataDir>/secret-key`, which seals what the server keeps secret, its statenet's authority among
 * them. Two processes that start at once read the same one
 */
export async function localSecretKey(dataDir: string): Promise<{ readonly key: string; readonly made: boolean }> {
    const file = join(dataDir, 'secret-key');
    await mkdir(dataDir, { recursive: true });
    try {
        await writeFile(file, randomBytes(32).toString('base64url'), { mode: 0o600, flag: 'wx' });
        return { key: (await readFile(file, 'utf8')).trim(), made: true };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const key = (await readFile(file, 'utf8')).trim();
    if (key.length < 16) throw new Error(`${file} holds no key; remove it to make a new one`);
    return { key, made: false };
}
