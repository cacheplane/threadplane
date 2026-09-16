// @vitest-environment jsdom
import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
  Component,
  InjectionToken,
  type ApplicationConfig,
} from '@angular/core';
import type { InstalledRuntimeBridge } from '@threadplane/cockpit-runtime-bridge';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AG_UI_REPORTER = new InjectionToken<
  (code: 'unauthorized' | 'network_blocked') => void
>('AG_UI_REPORTER');
const LANGGRAPH_REPORTER = new InjectionToken<
  (code: 'unauthorized' | 'network_blocked') => void
>('LANGGRAPH_REPORTER');

const mocks = vi.hoisted(() => ({
  bootstrapApplication: vi.fn().mockResolvedValue(undefined),
  installRuntimeBridge: vi.fn(),
  providerModuleLoaded: vi.fn(),
  provideCockpitTelemetry: vi.fn(),
  telemetryProvider: { provide: 'COCKPIT_TELEMETRY', useValue: true },
}));

vi.mock('@angular/platform-browser', () => ({
  bootstrapApplication: mocks.bootstrapApplication,
}));

vi.mock('@threadplane/cockpit-runtime-bridge', () => ({
  GENERATED_RUNTIME_PARENT_ORIGINS: Object.freeze([
    'https://threadplane.ai',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:4308',
    'http://127.0.0.1:4308',
  ]),
  installRuntimeBridge: mocks.installRuntimeBridge,
}));

@Component({ selector: 'lib-test', standalone: true, template: '' })
class TestComponent {}

describe('bootstrapWithCockpitHarness', () => {
  let bootstrapWithCockpitHarness: typeof import('./harness')['bootstrapWithCockpitHarness'];
  let bridge: InstalledRuntimeBridge;

  function setSearch(s: string): void {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, search: s },
    });
  }

  function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });

    return { promise, resolve, reject };
  }

  beforeEach(async () => {
    setSearch('');
    bridge = {
      awaitConfiguration: vi.fn().mockResolvedValue({ status: 'default' }),
      markReady: vi.fn(),
      markError: vi.fn(),
      dispose: vi.fn(),
    };
    mocks.bootstrapApplication.mockReset().mockResolvedValue(undefined);
    mocks.installRuntimeBridge.mockReset().mockReturnValue(bridge);
    mocks.providerModuleLoaded.mockReset();
    mocks.provideCockpitTelemetry
      .mockReset()
      .mockReturnValue(mocks.telemetryProvider);
    vi.resetModules();
    vi.doMock('./provide-cockpit-telemetry', () => {
      mocks.providerModuleLoaded();
      return { provideCockpitTelemetry: mocks.provideCockpitTelemetry };
    });
    ({ bootstrapWithCockpitHarness } = await import('./harness'));
  });

  test('installs the runtime bridge before invoking Angular bootstrap', async () => {
    const calls: string[] = [];
    mocks.installRuntimeBridge.mockImplementationOnce(() => {
      calls.push('install bridge');
      return bridge;
    });
    mocks.bootstrapApplication.mockImplementationOnce(async () => {
      calls.push('bootstrap Angular');
    });

    await bootstrapWithCockpitHarness(TestComponent, { providers: [] });

    expect(calls).toEqual(['install bridge', 'bootstrap Angular']);
  });

  test('does not mark the runtime ready while Angular bootstrap is pending', async () => {
    const bootstrap = deferred<void>();
    mocks.bootstrapApplication.mockReturnValueOnce(bootstrap.promise);

    const result = bootstrapWithCockpitHarness(TestComponent, {
      providers: [],
    });

    expect(bridge.markReady).not.toHaveBeenCalled();
    expect(bridge.markError).not.toHaveBeenCalled();

    bootstrap.resolve();
    await result;
  });

  test('marks the runtime ready exactly once after Angular bootstrap fulfills', async () => {
    const bootstrap = deferred<void>();
    const lifecycle: string[] = [];
    mocks.bootstrapApplication.mockImplementationOnce(() => {
      lifecycle.push('bootstrap started');
      return bootstrap.promise;
    });
    vi.mocked(bridge.markReady).mockImplementationOnce(() => {
      lifecycle.push('runtime ready');
    });

    const result = bootstrapWithCockpitHarness(TestComponent, {
      providers: [],
    });
    expect(lifecycle).toEqual(['bootstrap started']);

    bootstrap.resolve();
    await result;

    expect(lifecycle).toEqual(['bootstrap started', 'runtime ready']);
    expect(bridge.markReady).toHaveBeenCalledTimes(1);
    expect(bridge.markError).not.toHaveBeenCalled();
  });

  test('marks a bootstrap failure before rejecting with the original error', async () => {
    const bootstrap = deferred<void>();
    const failure = new Error('Angular bootstrap failed');
    const lifecycle: string[] = [];
    mocks.bootstrapApplication.mockReturnValueOnce(bootstrap.promise);
    vi.mocked(bridge.markError).mockImplementationOnce(() => {
      lifecycle.push('runtime error');
    });

    const result = bootstrapWithCockpitHarness(TestComponent, {
      providers: [],
    });
    const observed = result.catch((error: unknown) => {
      lifecycle.push('rejected');
      throw error;
    });
    bootstrap.reject(failure);

    await expect(observed).rejects.toBe(failure);
    expect(lifecycle).toEqual(['runtime error', 'rejected']);
    expect(bridge.markError).toHaveBeenCalledOnce();
    expect(bridge.markError).toHaveBeenCalledWith('bootstrap_failed');
    expect(bridge.dispose).toHaveBeenCalledOnce();
    expect(bridge.markReady).not.toHaveBeenCalled();
  });

  test('keeps bootstrap success unchanged when a ready reply cannot be delivered', async () => {
    const { installRuntimeBridge } = await vi.importActual<
      typeof import('@threadplane/cockpit-runtime-bridge')
    >('@threadplane/cockpit-runtime-bridge');
    const parentPostMessage = vi.fn(() => {
      throw new Error('delivery failed');
    });
    const parent = { postMessage: parentPostMessage } as unknown as Window;
    let messageListener: ((event: MessageEvent<unknown>) => void) | undefined;
    const runtimeWindow = {
      parent,
      addEventListener: vi.fn(
        (type: string, listener: EventListenerOrEventListenerObject) => {
          if (type === 'message') {
            messageListener = listener as (
              event: MessageEvent<unknown>
            ) => void;
          }
        }
      ),
      removeEventListener: vi.fn(),
    } as unknown as Window;
    mocks.installRuntimeBridge.mockImplementationOnce(() =>
      installRuntimeBridge({
        window: runtimeWindow,
        document: { referrer: 'https://cockpit.example/embed' },
      })
    );

    const result = bootstrapWithCockpitHarness(TestComponent, {
      providers: [],
    });
    messageListener?.({
      data: {
        type: 'tplane:runtime-check',
        version: 1,
        nonce: 'check-1',
        capability: 'streaming',
      },
      origin: 'https://cockpit.example',
      source: parent,
    } as MessageEvent<unknown>);

    await expect(result).resolves.toBeUndefined();
    expect(parentPostMessage).toHaveBeenCalledOnce();
  });

  test('keeps the original bootstrap failure when an error reply cannot be delivered', async () => {
    const { installRuntimeBridge } = await vi.importActual<
      typeof import('@threadplane/cockpit-runtime-bridge')
    >('@threadplane/cockpit-runtime-bridge');
    const parentPostMessage = vi.fn(() => {
      throw new Error('delivery failed');
    });
    const parent = { postMessage: parentPostMessage } as unknown as Window;
    let messageListener: ((event: MessageEvent<unknown>) => void) | undefined;
    const runtimeWindow = {
      parent,
      addEventListener: vi.fn(
        (type: string, listener: EventListenerOrEventListenerObject) => {
          if (type === 'message') {
            messageListener = listener as (
              event: MessageEvent<unknown>
            ) => void;
          }
        }
      ),
      removeEventListener: vi.fn(),
    } as unknown as Window;
    mocks.installRuntimeBridge.mockImplementationOnce(() =>
      installRuntimeBridge({
        window: runtimeWindow,
        document: { referrer: 'https://cockpit.example/embed' },
      })
    );
    const failure = new Error('Angular bootstrap failed');
    mocks.bootstrapApplication.mockRejectedValueOnce(failure);

    const result = bootstrapWithCockpitHarness(TestComponent, {
      providers: [],
    });
    messageListener?.({
      data: {
        type: 'tplane:runtime-check',
        version: 1,
        nonce: 'check-1',
        capability: 'streaming',
      },
      origin: 'https://cockpit.example',
      source: parent,
    } as MessageEvent<unknown>);

    await expect(result).rejects.toBe(failure);
    expect(parentPostMessage).toHaveBeenCalledOnce();
  });

  test('bootstraps pristine when no cockpit URL params present', async () => {
    setSearch('');
    const appConfig: ApplicationConfig = { providers: [] };
    await bootstrapWithCockpitHarness(TestComponent, appConfig);
    expect(mocks.providerModuleLoaded).not.toHaveBeenCalled();
    expect(mocks.provideCockpitTelemetry).not.toHaveBeenCalled();
    expect(mocks.bootstrapApplication).toHaveBeenCalledWith(
      TestComponent,
      expect.objectContaining({ providers: [] })
    );
  });

  test('bootstraps with provideCockpitTelemetry when params present', async () => {
    setSearch('?cockpit_did=d1&cockpit_phk=phc_test&cockpit_cap=streaming');
    const lifecycle: string[] = [];
    mocks.providerModuleLoaded.mockImplementationOnce(() => {
      lifecycle.push('telemetry provider loaded');
    });
    mocks.bootstrapApplication.mockImplementationOnce(async () => {
      lifecycle.push('bootstrap Angular');
    });
    const appConfig: ApplicationConfig = {
      providers: [{ provide: 'TEST', useValue: 1 }],
    };
    await bootstrapWithCockpitHarness(TestComponent, appConfig);
    const call = mocks.bootstrapApplication.mock.calls[0];
    expect(call[0]).toBe(TestComponent);
    const cfg = call[1] as ApplicationConfig;
    expect(lifecycle).toEqual([
      'telemetry provider loaded',
      'bootstrap Angular',
    ]);
    expect(mocks.providerModuleLoaded).toHaveBeenCalledOnce();
    expect(mocks.provideCockpitTelemetry).toHaveBeenCalledWith({
      distinctId: 'd1',
      posthogKey: 'phc_test',
      posthogHost: 'https://us.i.posthog.com',
      capabilitySlug: 'streaming',
    });
    expect(cfg.providers).toEqual([
      ...(appConfig.providers ?? []),
      mocks.telemetryProvider,
    ]);
  });

  test('awaits recognized compatible runtime configuration before Angular bootstrap', async () => {
    const configuration = deferred<{
      status: 'configured';
      generation: number;
      target: { kind: 'ag-ui'; endpoint: string };
      reportOperationFailure: (
        code: 'unauthorized' | 'network_blocked'
      ) => void;
    }>();
    vi.mocked(bridge.awaitConfiguration).mockReturnValueOnce(
      configuration.promise
    );

    const result = bootstrapWithCockpitHarness(
      TestComponent,
      { providers: [] },
      {
        runtime: {
          adapter: 'ag-ui',
          sharedUrl: '/agent',
          operationReporterToken: AG_UI_REPORTER,
        },
        allowedParentOrigins: ['https://threadplane.ai'],
      }
    );

    expect(mocks.bootstrapApplication).not.toHaveBeenCalled();
    configuration.resolve({
      status: 'configured',
      generation: 7,
      target: { kind: 'ag-ui', endpoint: 'https://agent.example/run' },
      reportOperationFailure: vi.fn(),
    });
    await result;

    expect(mocks.bootstrapApplication).toHaveBeenCalledOnce();
  });

  test('uses the generated authoritative parent allowlist by default', async () => {
    await bootstrapWithCockpitHarness(
      TestComponent,
      { providers: [] },
      {
        runtime: {
          adapter: 'ag-ui',
          sharedUrl: '/agent',
          operationReporterToken: AG_UI_REPORTER,
        },
      }
    );

    expect(mocks.installRuntimeBridge).toHaveBeenCalledWith(undefined, {
      allowedParentOrigins: [
        'https://threadplane.ai',
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:4308',
        'http://127.0.0.1:4308',
      ],
    });
  });

  test('maps Shared AG-UI to the current default connection', async () => {
    const { COCKPIT_RUNTIME_CONNECTION } = await import('./runtime-connection');
    vi.mocked(bridge.awaitConfiguration).mockResolvedValueOnce({
      status: 'configured',
      generation: 2,
      target: { kind: 'shared' },
      reportOperationFailure: vi.fn(),
    });

    await bootstrapWithCockpitHarness(
      TestComponent,
      { providers: [] },
      {
        runtime: {
          adapter: 'ag-ui',
          sharedUrl: '/agent',
          operationReporterToken: AG_UI_REPORTER,
        },
        allowedParentOrigins: ['https://threadplane.ai'],
      }
    );

    const config = mocks.bootstrapApplication.mock
      .calls[0][1] as ApplicationConfig;
    expect(config.providers).toContainEqual({
      provide: COCKPIT_RUNTIME_CONNECTION,
      useValue: { adapter: 'ag-ui', url: '/agent' },
    });
  });

  test('maps custom AG-UI to the configured endpoint', async () => {
    const { COCKPIT_RUNTIME_CONNECTION } = await import('./runtime-connection');
    vi.mocked(bridge.awaitConfiguration).mockResolvedValueOnce({
      status: 'configured',
      generation: 2,
      target: { kind: 'ag-ui', endpoint: 'https://agent.example/run' },
      reportOperationFailure: vi.fn(),
    });

    await bootstrapWithCockpitHarness(
      TestComponent,
      { providers: [] },
      {
        runtime: {
          adapter: 'ag-ui',
          sharedUrl: '/agent',
          operationReporterToken: AG_UI_REPORTER,
        },
        allowedParentOrigins: ['https://threadplane.ai'],
      }
    );

    const config = mocks.bootstrapApplication.mock
      .calls[0][1] as ApplicationConfig;
    expect(config.providers).toContainEqual({
      provide: COCKPIT_RUNTIME_CONNECTION,
      useValue: { adapter: 'ag-ui', url: 'https://agent.example/run' },
    });
  });

  test('binds the accepted generation reporter only to the AG-UI adapter hook', async () => {
    const reportOperationFailure = vi.fn();
    vi.mocked(bridge.awaitConfiguration).mockResolvedValueOnce({
      status: 'configured',
      generation: 2,
      target: { kind: 'ag-ui', endpoint: 'https://agent.example/run' },
      reportOperationFailure,
    });

    await bootstrapWithCockpitHarness(
      TestComponent,
      { providers: [] },
      {
        runtime: {
          adapter: 'ag-ui',
          sharedUrl: '/agent',
          operationReporterToken: AG_UI_REPORTER,
        },
        allowedParentOrigins: ['https://threadplane.ai'],
      }
    );

    const providers =
      (mocks.bootstrapApplication.mock.calls[0][1] as ApplicationConfig)
        .providers ?? [];
    expect(providers).toContainEqual({
      provide: AG_UI_REPORTER,
      useValue: reportOperationFailure,
    });
    expect(providers).not.toContainEqual(
      expect.objectContaining({
        provide: LANGGRAPH_REPORTER,
      })
    );
  });

  test('maps custom LangSmith to the existing assistant plus explicit URL and key', async () => {
    const { COCKPIT_RUNTIME_CONNECTION } = await import('./runtime-connection');
    vi.mocked(bridge.awaitConfiguration).mockResolvedValueOnce({
      status: 'configured',
      generation: 3,
      target: {
        kind: 'langsmith',
        apiUrl: 'https://runtime.example/api',
        apiKey: 'test-key-redact-me',
      },
      reportOperationFailure: vi.fn(),
    });

    await bootstrapWithCockpitHarness(
      TestComponent,
      { providers: [] },
      {
        runtime: {
          adapter: 'langgraph',
          sharedApiUrl: '/api',
          assistantId: 'streaming',
          operationReporterToken: LANGGRAPH_REPORTER,
        },
        allowedParentOrigins: ['https://threadplane.ai'],
      }
    );

    const config = mocks.bootstrapApplication.mock
      .calls[0][1] as ApplicationConfig;
    expect(config.providers).toContainEqual({
      provide: COCKPIT_RUNTIME_CONNECTION,
      useValue: {
        adapter: 'langgraph',
        apiUrl: 'https://runtime.example/api',
        assistantId: 'streaming',
        clientOptions: { defaultHeaders: { 'x-api-key': 'test-key-redact-me' } },
      },
    });
    expect(
      JSON.stringify(
        config.providers?.filter(
          (provider) =>
            (provider as { provide?: unknown }).provide !==
            COCKPIT_RUNTIME_CONNECTION
        )
      )
    ).not.toContain('test-key-redact-me');
  });

  test('binds the accepted generation reporter only to the LangGraph adapter hook', async () => {
    const reportOperationFailure = vi.fn();
    vi.mocked(bridge.awaitConfiguration).mockResolvedValueOnce({
      status: 'configured',
      generation: 3,
      target: {
        kind: 'langsmith',
        apiUrl: 'https://runtime.example/api',
        apiKey: 'test-key-redact-me',
      },
      reportOperationFailure,
    });

    await bootstrapWithCockpitHarness(
      TestComponent,
      { providers: [] },
      {
        runtime: {
          adapter: 'langgraph',
          sharedApiUrl: '/api',
          assistantId: 'streaming',
          operationReporterToken: LANGGRAPH_REPORTER,
        },
        allowedParentOrigins: ['https://threadplane.ai'],
      }
    );

    const providers =
      (mocks.bootstrapApplication.mock.calls[0][1] as ApplicationConfig)
        .providers ?? [];
    expect(providers).toContainEqual({
      provide: LANGGRAPH_REPORTER,
      useValue: reportOperationFailure,
    });
    expect(providers).not.toContainEqual(
      expect.objectContaining({
        provide: AG_UI_REPORTER,
      })
    );
  });

  test('uses shared LangGraph defaults for standalone or unrecognized embeds', async () => {
    const { COCKPIT_RUNTIME_CONNECTION } = await import('./runtime-connection');

    await bootstrapWithCockpitHarness(
      TestComponent,
      { providers: [] },
      {
        runtime: {
          adapter: 'langgraph',
          sharedApiUrl: '/api',
          assistantId: 'streaming',
          operationReporterToken: LANGGRAPH_REPORTER,
        },
        allowedParentOrigins: ['https://threadplane.ai'],
      }
    );

    const config = mocks.bootstrapApplication.mock
      .calls[0][1] as ApplicationConfig;
    expect(config.providers).toContainEqual({
      provide: COCKPIT_RUNTIME_CONNECTION,
      useValue: {
        adapter: 'langgraph',
        apiUrl: '/api',
        assistantId: 'streaming',
      },
    });
  });

  test('bootstraps static adapters immediately without awaiting configuration', async () => {
    const pending = deferred<never>();
    vi.mocked(bridge.awaitConfiguration).mockReturnValueOnce(pending.promise);

    await bootstrapWithCockpitHarness(
      TestComponent,
      { providers: [] },
      {
        runtime: { adapter: 'none' },
        allowedParentOrigins: ['https://threadplane.ai'],
      }
    );

    expect(bridge.awaitConfiguration).not.toHaveBeenCalled();
    expect(mocks.bootstrapApplication).toHaveBeenCalledOnce();
    expect(bridge.markReady).toHaveBeenCalledOnce();
  });

  test('prevents bootstrap on configuration failure and sends one bridge error signal', async () => {
    vi.mocked(bridge.awaitConfiguration).mockResolvedValueOnce({
      status: 'error',
      code: 'incompatible_bridge',
    });

    await expect(
      bootstrapWithCockpitHarness(
        TestComponent,
        { providers: [] },
        {
          runtime: {
            adapter: 'ag-ui',
            sharedUrl: '/agent',
            operationReporterToken: AG_UI_REPORTER,
          },
          allowedParentOrigins: ['https://threadplane.ai'],
        }
      )
    ).rejects.toMatchObject({ name: 'RuntimeConfigurationError' });

    expect(mocks.bootstrapApplication).not.toHaveBeenCalled();
    expect(bridge.markError).toHaveBeenCalledOnce();
    expect(bridge.dispose).toHaveBeenCalledOnce();
    expect(bridge.markReady).not.toHaveBeenCalled();
  });

  test('rejects an adapter-incompatible configured target without exposing its values', async () => {
    vi.mocked(bridge.awaitConfiguration).mockResolvedValueOnce({
      status: 'configured',
      generation: 4,
      target: {
        kind: 'langsmith',
        apiUrl: 'https://runtime.example/test-key-redact-me',
        apiKey: 'test-key-redact-me',
      },
      reportOperationFailure: vi.fn(),
    });

    const result = bootstrapWithCockpitHarness(
      TestComponent,
      { providers: [] },
      {
        runtime: {
          adapter: 'ag-ui',
          sharedUrl: '/agent',
          operationReporterToken: AG_UI_REPORTER,
        },
        allowedParentOrigins: ['https://threadplane.ai'],
      }
    );

    const error = await result.catch((reason: unknown) => reason);
    expect(error).toMatchObject({ name: 'RuntimeConfigurationError' });
    expect(JSON.stringify(error)).not.toContain('test-key-redact-me');
    expect(mocks.bootstrapApplication).not.toHaveBeenCalled();
    expect(bridge.markError).toHaveBeenCalledOnce();
    expect(bridge.dispose).toHaveBeenCalledOnce();
  });

  test('harness has no static adapter barrel imports', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'harness.ts'),
      'utf8'
    );
    expect(source).not.toContain("from '@threadplane/ag-ui'");
    expect(source).not.toContain("from '@threadplane/langgraph'");
  });
});
