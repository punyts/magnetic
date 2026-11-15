import { describe, expect, it } from 'vitest';
import { parseOptions, UsageError } from './options.js';

describe('parseOptions', () => {
    it('should take the database from the flag over the environment, and the command first', () => {
        // Act
        const fromEnv = parseOptions([], { MAGNETIC_DATABASE_URL: 'postgres://env/db' });
        const fromFlag = parseOptions(['migrate', '--database-url', 'postgres://flag/db'], { MAGNETIC_DATABASE_URL: 'postgres://env/db' });

        // Assert
        expect(fromEnv).toMatchObject({ command: 'serve', databaseUrl: 'postgres://env/db' });
        expect(fromFlag).toMatchObject({ command: 'migrate', databaseUrl: 'postgres://flag/db' });
        expect(parseOptions(['import', '--data-dir', 'old'], {})).toMatchObject({ command: 'import', dataDir: 'old', databaseUrl: undefined });
    });

    it('should refuse a database URL that is not postgres', () => {
        expect(() => parseOptions(['--database-url', 'mysql://x/y'], {})).toThrow(UsageError);
    });

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

    it('should take a runtime origin from the flag over the environment', () => {
        expect(parseOptions(['--runtime-origin', 'https://run.magnetic.example'], { MAGNETIC_RUNTIME_ORIGIN: 'https://other.example' }).runtimeOrigin).toBe('https://run.magnetic.example');
        expect(parseOptions([], { MAGNETIC_RUNTIME_ORIGIN: 'https://run.magnetic.example' }).runtimeOrigin).toBe('https://run.magnetic.example');
        expect(parseOptions([], {}).runtimeOrigin).toBeUndefined();
    });

    it('should run the agent on Haiku 5.5 at high effort with $1 a day and $100 a month by default', () => {
        expect(parseOptions([], {})).toMatchObject({ model: 'claude-haiku-5-5', models: undefined, effort: 'high', dailyBudget: 1, monthlyBudget: 100 });
    });

    it('should take the models people may pick from a flag over the environment', () => {
        expect(parseOptions(['--models', 'claude-haiku-5-5, claude-sonnet-5-5'], { MAGNETIC_MODELS: 'claude-opus-5-5' }).models).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5']);
        expect(parseOptions([], { MAGNETIC_MODELS: 'claude-opus-5-5' }).models).toEqual(['claude-opus-5-5']);
        expect(() => parseOptions(['--models', ' , '], {})).toThrow('Invalid models');
    });

    it('should take the model, effort and budgets from flags over the environment', () => {
        const options = parseOptions(['--model', 'claude-sonnet-5-5', '--effort=medium', '--daily-budget', '0.5', '--monthly-budget', '20'], { MAGNETIC_MODEL: 'claude-opus-5-5', MAGNETIC_EFFORT: 'max', MAGNETIC_DAILY_BUDGET: '3', MAGNETIC_MONTHLY_BUDGET: '300' });
        expect(options).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'medium', dailyBudget: 0.5, monthlyBudget: 20 });
    });

    it('should run as one of several servers with a mesh port, from flags over the environment, and only with the secret key', () => {
        const secret = { MAGNETIC_SECRET_KEY: 'a-secret-of-enough-length' };
        expect(parseOptions([], secret).statenet).toBeUndefined();
        expect(parseOptions(['--mesh-port', '4310', '--mesh-url', 'ws://magnetic-2:4310', '--node-id', 'magnetic-2'], { ...secret, MAGNETIC_MESH_HOST: '0.0.0.0', MAGNETIC_NODE_ID: 'other' }).statenet).toEqual({ meshPort: 4310, meshHost: '0.0.0.0', meshUrl: 'ws://magnetic-2:4310', nodeId: 'magnetic-2' });
        expect(() => parseOptions(['--mesh-port', '4310'], {})).toThrow('MAGNETIC_SECRET_KEY');
        expect(() => parseOptions(['--mesh-port', '4310', '--mesh-url', 'http://x'], secret)).toThrow('Invalid mesh URL');
        expect(parseOptions(['relay-certificate', '--node-id', 'relay-1', '--out', 'certs'], secret)).toMatchObject({ command: 'relay-certificate', nodeId: 'relay-1', out: 'certs' });
    });

    it.each([['--effort', 'extreme'], ['--daily-budget', '-1'], ['--monthly-budget', 'lots'], ['--model', 'two words']])('should refuse %s %s', (flag, value) => {
        expect(() => parseOptions([flag, value], {})).toThrow(UsageError);
    });
});
