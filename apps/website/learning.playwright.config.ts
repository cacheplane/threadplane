import { defineConfig } from '@playwright/test';
import { createWebsitePlaywrightConfig } from './playwright.config';

// The learning journey needs only the two streaming runtimes and target fixture.
const config = createWebsitePlaywrightConfig();
export default defineConfig({
  ...config,
  testMatch: '**/learning-workbench.spec.ts',
  fullyParallel: false,
  workers: 1,
  webServer: Array.isArray(config.webServer)
    ? config.webServer.filter(
        (server, index) =>
          index === 0 ||
          ['4300', '4600', '4399'].includes(new URL(server.url ?? '').port)
      )
    : config.webServer,
});
