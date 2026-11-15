import { defineConfig } from '@playwright/test';

/**
 * Magnetic's whole UI, as a person uses it (docs/design/magnetic-m8.md, N1). `npm run e2e` builds and runs it; the
 * suite starts its own server (e2e/server.mjs) on a fresh schema of the test database, with dev users, the mock
 * provider and the scripted agent. Each spec runs at desktop size and at a phone's.
 */
const port = Number(process.env['MAGNETIC_E2E_PORT'] ?? 4390);

export default defineConfig({
    testDir: './e2e',
    testMatch: '**/*.spec.ts',
    timeout: 60_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
    outputDir: 'e2e-results',
    use: {
        baseURL: `http://127.0.0.1:${port}`,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure'
    },
    projects: [
        { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
        { name: 'phone', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 } }
    ],
    webServer: {
        command: 'node e2e/server.mjs',
        url: `http://127.0.0.1:${port}/privacy`,
        reuseExistingServer: !process.env['CI'],
        timeout: 60_000,
        stderr: 'pipe'
    }
});
