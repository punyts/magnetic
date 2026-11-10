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

    it('should run the agent on Opus 5.5 at high effort with $1 a day and $100 a month by default', () => {
        expect(parseOptions([], {})).toMatchObject({ model: 'claude-opus-5-5', effort: 'high', dailyBudget: 1, monthlyBudget: 100 });
    });

    it('should take the model, effort and budgets from flags over the environment', () => {
        const options = parseOptions(['--model', 'claude-sonnet-5-5', '--effort=medium', '--daily-budget', '0.5', '--monthly-budget', '20'], { MAGNETIC_MODEL: 'claude-opus-5-5', MAGNETIC_EFFORT: 'max', MAGNETIC_DAILY_BUDGET: '3', MAGNETIC_MONTHLY_BUDGET: '300' });
        expect(options).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'medium', dailyBudget: 0.5, monthlyBudget: 20 });
    });

    it.each([['--effort', 'extreme'], ['--daily-budget', '-1'], ['--monthly-budget', 'lots'], ['--model', 'two words']])('should refuse %s %s', (flag, value) => {
        expect(() => parseOptions([flag, value], {})).toThrow(UsageError);
    });
});
