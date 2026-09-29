import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  testDir: '.',
  testMatch: 'development.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  outputDir: join(tmpdir(), 'native-conversation-angular-development-results'),
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
