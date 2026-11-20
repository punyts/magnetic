import { X509Certificate } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { issueServerCertificate, localSecretKey, localTls, makeCertificateAuthority } from './localTls.js';

describe('localTls', () => {
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'magnetic-tls-'));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it('should make an authority that signs a server certificate for names and addresses', () => {
        // Arrange
        const authority = makeCertificateAuthority('Magnetic local authority (test)');

        // Act
        const server = issueServerCertificate(authority, ['192.168.1.20', 'desk.local', '::1']);

        // Assert
        const ca = new X509Certificate(authority.cert);
        const cert = new X509Certificate(server.cert);
        expect(ca.ca).toBe(true);
        expect(cert.ca).toBe(false);
        expect(cert.checkIssued(ca)).toBe(true);
        expect(cert.verify(ca.publicKey)).toBe(true);
        expect(cert.checkIP('192.168.1.20')).toBe('192.168.1.20');
        expect(cert.checkIP('::1')).toBeDefined();
        expect(cert.checkHost('desk.local')).toBe('desk.local');
        expect(cert.checkHost('other.local')).toBeUndefined();
    });

    it('should serve HTTPS that a client trusting only the authority accepts', async () => {
        // Arrange
        const tls = await localTls(dir, 'test', ['127.0.0.1']);
        const ca = await readFile(tls.authorityFile, 'utf8');
        const server = createServer({ key: tls.key, cert: tls.cert }, (_request, response) => response.end('hello'));
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const port = (server.address() as AddressInfo).port;

        // Act
        const body = await new Promise<string>((resolve, reject) => {
            request({ host: '127.0.0.1', port, path: '/', ca: [ca] }, (response) => {
                let text = '';
                response.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
                response.on('end', () => resolve(text));
            })
                .on('error', reject)
                .end();
        }).finally(() => server.close());

        // Assert
        expect(body).toBe('hello');
    });

    it('should keep the authority and make the server certificate again only for a new name', async () => {
        // Arrange
        const first = await localTls(dir, 'test', ['192.168.1.20']);
        const authority = await readFile(join(dir, 'authority.crt'), 'utf8');

        // Act
        const again = await localTls(dir, 'test', ['192.168.1.20']);
        const moved = await localTls(dir, 'test', ['192.168.1.30']);

        // Assert
        expect(first.made).toBe(true);
        expect(again.made).toBe(false);
        expect(again.cert).toBe(first.cert);
        expect(moved.made).toBe(true);
        expect(new X509Certificate(moved.cert).checkIP('192.168.1.30')).toBe('192.168.1.30');
        expect(await readFile(join(dir, 'authority.crt'), 'utf8')).toBe(authority);
    });

    it('should make a secret key once and read it back', async () => {
        // Arrange
        const dataDir = join(dir, 'data');

        // Act
        const made = await localSecretKey(dataDir);
        const read = await localSecretKey(dataDir);

        // Assert
        expect(made.made).toBe(true);
        expect(read).toEqual({ key: made.key, made: false });
        expect(made.key.length).toBeGreaterThanOrEqual(43);
    });

    it('should refuse a secret key file that holds no key', async () => {
        // Arrange
        await writeFile(join(dir, 'secret-key'), 'short');

        // Act
        const reading = localSecretKey(dir);

        // Assert
        await expect(reading).rejects.toThrow('holds no key');
    });
});
