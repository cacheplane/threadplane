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
    'message-actions.spec.ts',
    'popup.spec.ts',
    'sidenav.spec.ts',
    'search-palette.spec.ts',
    'timeline.spec.ts',
    'state-comparison.spec.ts',
    'project-names.spec.ts',
    'project-assignment.spec.ts',
    'project-creation.spec.ts',
    'project-deletion.spec.ts',
    'project-deletion-race.spec.ts',
    'rename.spec.ts',
    'pin.spec.ts',
    'archive.spec.ts',
    'ordering.spec.ts',
    'delete.spec.ts',
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
