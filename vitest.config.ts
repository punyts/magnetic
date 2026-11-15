import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        include: ['src/**/*.test.ts'],
        testTimeout: 30000,
        // A beforeAll that starts a server and makes its database waits on the CPU when every file runs at once
        hookTimeout: 60000
    }
});
