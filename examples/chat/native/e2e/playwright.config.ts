import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  testDir: '.',
  testMatch: [
    'development.spec.ts',
    'conversation.spec.ts',
    'production.spec.ts',
    'message-list.spec.ts',
    'reasoning.spec.ts',
  ],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  outputDir: join(tmpdir(), 'native-conversation-react-e2e-results'),
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
  },
});
