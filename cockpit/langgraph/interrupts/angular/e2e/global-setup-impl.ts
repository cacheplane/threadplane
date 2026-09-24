import { resolve } from 'node:path';
import { portsFor } from '../../../../../cockpit/ports.mjs';
import { createGlobalSetup } from '@threadplane-internal/e2e-harness';

const ports = portsFor('cockpit-langgraph-interrupts-angular');

const setup = createGlobalSetup({
  langgraphCwd: 'cockpit/langgraph/interrupts/python',
  langgraphPort: ports.langgraph,
  angularProject: 'cockpit-langgraph-interrupts-angular',
  angularPort: ports.angular,
  fixturesDir: resolve(__dirname, 'fixtures'),
});

export default async function globalSetup(): Promise<void> {
  await setup();
  const harness = globalThis.__AIMOCK_HARNESS_STATE__?.get('cockpit-langgraph-interrupts-angular');
  if (!harness) throw new Error('Interrupts harness did not start');
  // Playwright forwards setup environment changes to protocol test workers.
  process.env['INTERRUPTS_API_URL'] = `http://127.0.0.1:${harness.langgraphPort}`;
  process.env['INTERRUPTS_AIMOCK_URL'] = `http://127.0.0.1:${harness.aimock.port}`;
}
