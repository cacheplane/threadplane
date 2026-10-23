import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  workers: 1,
  retries: 0,
  fullyParallel: false,
  timeout: 30000,
  outputDir: '../../../../../output/playwright/chat-a2ui-react',
  use: { baseURL: 'http://127.0.0.1:4646', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/react-cockpit/serve.mjs chat-a2ui --no-parent',
    cwd: '../../../../..',
    url: 'http://127.0.0.1:4646/chat/a2ui/react/',
    reuseExistingServer: false,
    stdout: 'pipe',
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    timeout: 10000,
  },
});
