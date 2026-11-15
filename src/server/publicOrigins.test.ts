import { request } from 'node:http';
import type { PreviewBrowser } from '@punyts/stateui-mcp';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { magneticTestDatabase } from '../testing/testDb.js';
import { startMagnetic } from './startMagnetic.js';
import type { RunningMagnetic } from './startMagnetic.js';

const noBrowser: PreviewBrowser = {
    open: async () => ({ rendered: false }),
    screenshot: async () => {
        throw new Error('no browser in this test');
    },
    interact: async () => {
        throw new Error('no browser in this test');
    },
    rendered: async () => {
        throw new Error('no browser in this test');
    },
    closePage: async () => undefined,
    close: async () => undefined
};

interface Answer {
    readonly status: number;
    readonly headers: Record<string, string | string[] | undefined>;
    readonly body: string;
}

/** A GET with the `Host` a proxy passes on, which fetch does not let a caller set */
function getAs(host: string, port: number, path: string): Promise<Answer> {
    return new Promise((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port, path, headers: { Host: host } }, (response) => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', (chunk: string) => (body += chunk));
            response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body }));
        });
        req.on('error', reject);
        req.end();
    });
}

describe('A server behind a proxy, at two public origins', () => {
    const databases: TestDatabase[] = [];
    let magnetic: RunningMagnetic;
    let port: number;

    beforeAll(async () => {
        const database = await magneticTestDatabase();
        databases.push(database);
        magnetic = await startMagnetic({
            database: database.db,
            host: '127.0.0.1',
            port: 0,
            report: { info: () => undefined },
            starter: 'none',
            browser: noBrowser,
            publicOrigin: 'https://magnetic.example',
            runtimeOrigin: 'https://run.magnetic.example'
        });
        port = magnetic.port;
    });

    afterAll(async () => {
        await magnetic?.stop();
        await Promise.all(databases.splice(0).map((test) => test.drop()));
    });

    it('should frame the runtime from the public runtime origin', async () => {
        // Act
        const page = await getAs('magnetic.example', port, '/signin');

        // Assert
        expect(page.status).toBe(200);
        expect(page.headers['content-security-policy']).toContain('frame-src https://run.magnetic.example');
        expect(page.body).toMatch(/https:\/\/run\.magnetic\.example\/runtime\/[^"]+\.html/);
    });

    it('should let only the public page origin frame the runtime page', async () => {
        // Arrange
        const page = await getAs('magnetic.example', port, '/signin');
        const path = (/https:\/\/run\.magnetic\.example(\/runtime\/[^"]+\.html)/.exec(page.body) as RegExpExecArray)[1] as string;

        // Act
        const runtime = await getAs('run.magnetic.example', magnetic.runtimePort, path);

        // Assert
        expect(runtime.status).toBe(200);
        expect(runtime.headers['content-security-policy']).toContain('frame-ancestors https://magnetic.example');
    });

    it('should refuse a host name it was not given', async () => {
        // Act
        const page = await getAs('elsewhere.example', port, '/signin');
        const runtime = await getAs('elsewhere.example', magnetic.runtimePort, '/runtime/runtime.css');

        // Assert
        expect(page.status).toBe(403);
        expect(runtime.status).toBe(403);
    });

    it('should still answer a health check on loopback', async () => {
        // Act
        const page = await getAs('127.0.0.1', port, '/signin');

        // Assert
        expect(page.status).toBe(200);
    });
});

describe('Starting with a runtime origin', () => {
    const databases: TestDatabase[] = [];

    afterAll(async () => {
        await Promise.all(databases.splice(0).map((test) => test.drop()));
    });

    async function startWith(origins: { publicOrigin?: string; runtimeOrigin: string }): Promise<RunningMagnetic> {
        const database = await magneticTestDatabase();
        databases.push(database);
        return startMagnetic({ database: database.db, host: '127.0.0.1', port: 0, report: { info: () => undefined }, starter: 'none', browser: noBrowser, ...origins });
    }

    it('should refuse one without a public origin', async () => {
        // Act and assert
        await expect(startWith({ runtimeOrigin: 'https://run.magnetic.example' })).rejects.toThrow('needs a public origin');
    });

    it('should refuse one on the same host as the public origin, where an app could reach the session cookie', async () => {
        // Act and assert
        await expect(startWith({ publicOrigin: 'https://magnetic.example', runtimeOrigin: 'https://magnetic.example' })).rejects.toThrow('another host');
    });
});
