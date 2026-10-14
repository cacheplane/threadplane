import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';
export default defineConfig({
  testDir: '.',
  outputDir: resolve(__dirname, '../../../../../test-results/native-maf-react'),
  workers: 1,
  fullyParallel: false,
  timeout: 45000,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4642', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command:
      'node scripts/react-cockpit/serve.mjs runtimes-microsoft-agent-framework --no-parent',
    cwd: '../../../../..',
    url: 'http://127.0.0.1:4642',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
