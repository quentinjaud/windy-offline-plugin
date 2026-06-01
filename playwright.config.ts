import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    timeout: 60000,
    use: {
        ignoreHTTPSErrors: true,
        headless: true,
    },
    projects: [
        {
            name: 'desktop',
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'mobile',
            // Émulation iPhone (viewport, user-agent, touch) pour reproduire le
            // contexte où le panneau passait sous la barre de timestamp.
            use: { ...devices['iPhone 13'] },
        },
    ],
});
