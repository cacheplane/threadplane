import { resolve } from 'node:path';
import { portsFor } from '../../../../../cockpit/ports.mjs';
import { createGlobalSetup } from '@threadplane-internal/e2e-harness';

const ports = portsFor('cockpit-langgraph-client-tools-angular');

const setup = createGlobalSetup({
  langgraphCwd: 'cockpit/langgraph/client-tools/python',
  langgraphPort: ports.langgraph,
  angularProject: 'cockpit-langgraph-client-tools-angular',
  angularPort: ports.angular,
  fixturesDir: resolve(__dirname, 'fixtures'),
});

export default async function globalSetup(): Promise<void> {
  await setup();
  const harness = globalThis.__AIMOCK_HARNESS_STATE__?.get('cockpit-langgraph-client-tools-angular');
  if (!harness) throw new Error('Client-tools harness did not start');
  // Playwright forwards setup environment changes to workers. Expose the local
  // API and fixture journal URLs for protocol tests and model request counts.
  process.env['CLIENT_TOOLS_API_URL'] = `http://127.0.0.1:${ports.langgraph}`;
  process.env['CLIENT_TOOLS_AIMOCK_URL'] = `http://127.0.0.1:${harness.aimock.port}`;
}
