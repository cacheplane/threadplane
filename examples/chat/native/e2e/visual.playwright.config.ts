import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import config from './playwright.config';

export default defineConfig({
  ...config,
  testMatch: 'visual-parity.spec.ts',
  outputDir: join(tmpdir(), 'native-conversation-visual-e2e-results'),
  projects: ['angular', 'react'].map((framework) => ({
    name: framework,
    metadata: { framework },
    use: { browserName: 'chromium' as const },
  })),
});
