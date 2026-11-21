import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { injectAgent, provideAgent } from '@threadplane/angular';
import { createFakeAgentSession } from '@threadplane/core/testing';
import * as telemetry from '@threadplane/telemetry/browser';
// Loading the package's entry is what registers the collector.
import { ChatComponent } from '../../public-api';

afterEach(() => {
  vi.restoreAllMocks();
  TestBed.resetTestingModule();
});

/** A session that uses the agent context the way a first-party session does. */
function provide(telemetryOption?: false) {
  const enabled = () => telemetryOption === undefined;
  TestBed.configureTestingModule({
    providers: [
      provideAgent({
        createSession: (context) => {
          const { session } = createFakeAgentSession();
          const collector = context.developmentRuntime({
            integration: 'langgraph',
            packageName: '@threadplane/langgraph',
            packageVersion: '1.2.3',
            installationToken: '11111111-1111-4111-8111-111111111111',
            enabled,
          });
          collector.touch();
          collector.milestone('transport.connected');
          return Object.assign(session, {
            isDevelopmentRuntimeEnabled: enabled,
          });
        },
      }),
    ],
  });
  return TestBed.runInInjectionContext(() => injectAgent());
}

describe('the development collector host', () => {
  it('connects an agent to the collector with no provider beyond provideAgent', () => {
    const calls: unknown[][] = [];
    const create = vi
      .spyOn(telemetry, 'createDevelopmentRuntime')
      .mockImplementation(() => ({
        touch: () => calls.push(['touch']),
        milestone: (kind) => calls.push([kind]),
        dispose: () => calls.push(['dispose']),
      }));
    const agent = provide();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({
      integration: 'langgraph',
      packageName: '@threadplane/langgraph',
      packageVersion: '1.2.3',
      installationToken: '11111111-1111-4111-8111-111111111111',
    });
    expect(create.mock.calls[0][0].enabled?.()).toBe(true);
    expect(calls).toEqual([['touch'], ['transport.connected']]);
    // The agent is registered, so `<chat>` passes its policy to nested renderers.
    expect(telemetry.isDevelopmentRuntimeEnabled(agent)).toBe(true);
    const view = TestBed.createComponent(ChatComponent);
    view.componentRef.setInput('agent', agent);
    expect(
      view.debugElement.injector.get(telemetry.DEVELOPMENT_COLLECTION_POLICY)()
    ).toBe(true);
  });

  it('keeps an agent whose session chose its own telemetry out of collection', () => {
    const create = vi.spyOn(telemetry, 'createDevelopmentRuntime');
    const agent = provide(false);
    expect(create.mock.calls[0][0].enabled?.()).toBe(false);
    expect(telemetry.isDevelopmentRuntimeEnabled(agent)).toBe(false);
  });

  it('sends nothing from the real collector once the page opted out', () => {
    // The package's test setup sets the page opt-out, as an app can.
    const fetched = vi.spyOn(globalThis, 'fetch');
    provide();
    expect(fetched).not.toHaveBeenCalled();
    expect(telemetry.getDevelopmentCollectionDiagnostics().pending).toBe(0);
  });
});
