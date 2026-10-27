import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.', outputDir: './test-results', workers: 1, fullyParallel: false, timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:4640', trace: 'retain-on-failure' },
  projects: [{name:'chromium', use: {...devices['Desktop Chrome']}}],
  webServer: {
    command: 'node scripts/react-cockpit/prepare-ag-ui-client-tools-fixture.mjs --serve',
    cwd: '../../../../..',
    url: 'http://127.0.0.1:4640', reuseExistingServer: false, timeout: 180000,
  },
});
