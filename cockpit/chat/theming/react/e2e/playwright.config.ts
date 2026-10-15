import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  workers: 1,
  retries: 0,
  fullyParallel: false,
  timeout: 45000,
  outputDir: '../../../../../output/playwright/chat-theming-react',
  use: { baseURL: 'http://127.0.0.1:4644', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/react-cockpit/serve.mjs chat-theming --no-parent',
    cwd: '../../../../..',
    url: 'http://127.0.0.1:4644',
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    timeout: 10000,
  },
});
