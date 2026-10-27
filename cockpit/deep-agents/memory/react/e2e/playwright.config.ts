import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: '**/*.spec.ts', outputDir: 'test-results',
  reporter: [['list']], workers: 1, fullyParallel: false, retries: 0, timeout: 60000,
  use: { baseURL: 'http://127.0.0.1:4632', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'node scripts/react-cockpit/serve.mjs deep-agents-memory --no-parent', cwd: '../../../../..', url: 'http://127.0.0.1:4632/__lifetime', reuseExistingServer: false, timeout: 30000 },
});
