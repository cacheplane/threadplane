import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseCollectionBatch } from './contracts.ts';
const { collectInstall } = createRequire(import.meta.url)(
  resolve('libs/telemetry/install/collector.cjs')
);
describe('published install collector contract', () => {
  it('accepts the real synthetic collector payload with explicit consumer context', async () => {
    let payload: unknown;
    await collectInstall({
      packageRoot: 'unused',
      env: { CI: '1' },
      getHome: () => '/synthetic',
      readPackage: async () => ({
        name: '@threadplane/angular',
        version: '0.0.65',
      }),
      identify: async () => ({ id: randomUUID(), scope: 'memory' }),
      discover: async () => ({
        consumerContext: 'checkout',
        identity: {
          gitEmail: 'synthetic@example.invalid',
          gitDisplayName: 'Synthetic',
          gitConfigOrigin: 'local',
          repositoryProvider: 'github',
          repositoryOwner: 'synthetic',
        },
      }),
      send: async (value: unknown) => {
        payload = value;
      },
    });
    expect(
      parseCollectionBatch('install', payload, new Date()).events[0].properties
        .consumerContext
    ).toBe('checkout');
    const invalid = structuredClone(payload) as {
      events: { properties: Record<string, string> }[];
    };
    invalid.events[0].properties.consumerContext = '/private/checkouts';
    expect(() =>
      parseCollectionBatch('install', invalid, new Date())
    ).toThrow();
  });
});
