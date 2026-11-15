import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Seals and opens the secrets Magnetic keeps for others, such as an org's SSO client secret, with the server's key
 * (`MAGNETIC_SECRET_KEY`): AES-256-GCM under the SHA-256 of the key, a random IV each time. A sealed secret reads
 * `v1.<iv>.<tag>.<ciphertext>` (base64url); a changed or truncated one does not open
 */
export class SecretBox {
    private readonly key: Buffer;

    constructor(secretKey: string) {
        if (secretKey.length < 16) throw new Error('The secret key must be at least 16 characters');
        this.key = createHash('sha256').update(secretKey).digest();
    }

    seal(plain: string): string {
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', this.key, iv);
        const sealed = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
        return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), sealed.toString('base64url')].join('.');
    }

    open(sealed: string): string {
        const [version, iv, tag, data] = sealed.split('.');
        if (version !== 'v1' || iv === undefined || tag === undefined || data === undefined) throw new Error('Not a sealed secret');
        const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
        decipher.setAuthTag(Buffer.from(tag, 'base64url'));
        return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
    }
}
