const { defineConfig } = require('@playwright/test')
module.exports = defineConfig({
    testDir: './tests/browser',
    timeout: 45000,
    expect: { timeout: 10000 },
    fullyParallel: false,
    workers: 1,
    retries: 0,
    use: {
        channel: 'chromium',
        headless: true,
        viewport: { width: 1440, height: 1000 },
        trace: 'retain-on-failure'
    },
    webServer: {
        command: 'node tests/browser/server.cjs',
        url: `http://127.0.0.1:${process.env.ALAKAZAM_TEST_PORT || 4173}`,
        reuseExistingServer: false
    },
    projects: [
        { name: 'game', testMatch: 'game.spec.cjs' },
        { name: 'extension', testMatch: 'extension.spec.cjs' }
    ]
})
