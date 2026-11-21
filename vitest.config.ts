import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        include: ['src/**/*.test.ts'],
        testTimeout: 30000,
        // Most files start a server and make a database schema in beforeAll; with a worker per core they starve each other
        // of CPU and time out, so a few run at once
        maxWorkers: 4,
        hookTimeout: 60000
    }
});
