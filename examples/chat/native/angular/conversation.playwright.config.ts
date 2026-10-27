import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  testDir: '../e2e',
  testMatch: 'conversation.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  outputDir: join(tmpdir(), 'native-conversation-angular-conversation-results'),
  projects: [
    {
      name: 'chromium',
      metadata: { framework: 'angular' },
      use: { browserName: 'chromium' },
    },
  ],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
  },
});
