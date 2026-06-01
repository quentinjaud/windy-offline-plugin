import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    timeout: 45000,
    use: {
        ignoreHTTPSErrors: true,
        headless: true,
    },
});
