import { describe, expect, it } from 'vitest';
import { parseOptions, UsageError } from './options.js';

describe('parseOptions', () => {
    it('should read LinkedIn from the environment, with PKCE on by default', () => {
        // Act
        const options = parseOptions([], { MAGNETIC_LINKEDIN_CLIENT_ID: 'id', MAGNETIC_LINKEDIN_CLIENT_SECRET: 'secret' });

        // Assert
        expect(options.linkedIn).toEqual({ clientId: 'id', clientSecret: 'secret', pkce: true });
    });

    it('should turn PKCE off for LinkedIn when asked', () => {
        expect(parseOptions([], { MAGNETIC_LINKEDIN_CLIENT_ID: 'id', MAGNETIC_LINKEDIN_CLIENT_SECRET: 'secret', MAGNETIC_LINKEDIN_PKCE: 'false' }).linkedIn?.pkce).toBe(false);
    });

    it('should refuse a LinkedIn client id without its secret', () => {
        expect(() => parseOptions([], { MAGNETIC_LINKEDIN_CLIENT_ID: 'id' })).toThrow(UsageError);
    });

    it('should have no LinkedIn without its variables', () => {
        expect(parseOptions([], {}).linkedIn).toBeUndefined();
    });

    it('should take a public origin from the flag over the environment', () => {
        expect(parseOptions(['--public-origin', 'https://magnetic.example'], { MAGNETIC_PUBLIC_ORIGIN: 'http://127.0.0.1:4300' }).publicOrigin).toBe('https://magnetic.example');
    });

    it.each(['magnetic.example', 'https://magnetic.example/app', 'ftp://magnetic.example'])('should refuse the public origin %s', (origin) => {
        expect(() => parseOptions(['--public-origin', origin], {})).toThrow(UsageError);
    });
});
