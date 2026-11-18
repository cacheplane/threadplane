import { resolve } from 'node:path';
import { createLanggraphGlobalSetup } from '@threadplane-internal/e2e-harness';

/**
 * Playwright global setup for an aimock-backed React cockpit example: aimock
 * replays the Angular example's fixtures into a real `langgraph dev`, and the
 * static server (the config's `webServer`) proxies /api to it through
 * scripts/react-cockpit/langgraph-proxy.mjs.
 *
 * Mirrors `aimockLanggraph()` in scripts/react-cockpit/configuration.mjs
 * (scripts/cockpit-frontend-matrix.spec.mjs keeps the two in step). It does
 * not import it, so unrelated `scripts/` changes don't select every React cap.
 */
export function reactAimockGlobalSetup(options: {
  /** e.g. 'chat/theming' */
  example: string;
  /** The React app port from configuration.mjs. */
  port: number;
}): () => Promise<void> {
  const name = `cockpit-${options.example.replace('/', '-')}-react`;
  return createLanggraphGlobalSetup({
    stateKey: name,
    langgraphCwd: `cockpit/${options.example}/python`,
    langgraphPort: options.port + 1000,
    fixturesDir: resolve(__dirname, '..', options.example, 'angular/e2e/fixtures'),
  });
}
