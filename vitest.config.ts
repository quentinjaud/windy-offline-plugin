/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        // Les tests e2e tournent sous Playwright (npx playwright test), pas Vitest.
        exclude: ['**/node_modules/**', 'tests/e2e/**'],
    },
});
