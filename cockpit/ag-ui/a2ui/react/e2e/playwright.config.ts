import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  workers: 1,
  retries: 0,
  fullyParallel: false,
  timeout: 60000,
  outputDir: '../../../../../output/playwright/ag-ui-a2ui-react',
  use: { baseURL: 'http://127.0.0.1:4647', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command:
      'node scripts/react-cockpit/prepare-ag-ui-a2ui-fixture.mjs --serve',
    cwd: '../../../../..',
    url: 'http://127.0.0.1:4647/ag-ui/a2ui/react/',
    reuseExistingServer: false,
    stdout: 'pipe',
    timeout: 330000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 15000 },
  },
});
