import { defineConfig, devices } from '@playwright/test';
import { portsFor } from '../../../../../cockpit/ports.mjs';

const { angular: angularPort } = portsFor('cockpit-deep-agents-memory-angular');


export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${angularPort}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  globalSetup: './global-setup-impl.ts',
});
