import { resolve } from 'node:path';
import {
  createAgUiBackendGlobalSetup,
  createLanggraphGlobalSetup,
} from '@threadplane-internal/e2e-harness';

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

/**
 * The AG-UI flavor: aimock replays the Angular example's fixtures into the
 * example's uvicorn AG-UI server (`src/server.py`); the static server proxies
 * the agent endpoint to it through scripts/react-cockpit/ag-ui-proxy.mjs.
 * Mirrors `aimockAgUi()` in scripts/react-cockpit/configuration.mjs
 * (backend port + 1000, aimock port + 2000).
 */
export function reactAimockAgUiGlobalSetup(options: {
  /** e.g. 'ag-ui/streaming' */
  example: string;
  /** The React app port from configuration.mjs. */
  port: number;
}): () => Promise<void> {
  return createAgUiBackendGlobalSetup({
    stateKey: `cockpit-${options.example.replace('/', '-')}-react`,
    pythonCwd: `cockpit/${options.example}/python`,
    backendPort: options.port + 1000,
    // The proxy reads model requests from aimock's journal on this port.
    aimockPort: options.port + 2000,
    fixturesDir: resolve(__dirname, '..', options.example, 'angular/e2e/fixtures'),
  });
}
