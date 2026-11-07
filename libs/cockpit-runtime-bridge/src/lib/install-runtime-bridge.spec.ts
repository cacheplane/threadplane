import { describe, expect, it, vi } from 'vitest';
import { type InspectionFrame } from './inspection';
import {
  installRuntimeBridge,
  type RuntimeBridgeEnvironment,
} from './install-runtime-bridge';

type MessageListener = (event: MessageEvent<unknown>) => void;
type UnsafeRuntimeBridge = { markError(code: unknown): void };

const inspectionFrame: InspectionFrame = {
  sequence: 1,
  elapsedMs: 0,
  framework: 'react',
  messages: [],
  state: null,
  busy: false,
  calls: [],
  event: { type: 'snapshot', payload: null },
  limited: false,
};

function createEnvironment(...arguments_: [referrer?: string | undefined]) {
  const referrer =
    arguments_.length === 0 ? 'https://cockpit.example/embed' : arguments_[0];
  let messageListener: MessageListener | undefined;
  const parentPostMessage = vi.fn();
  const parent = { postMessage: parentPostMessage } as unknown as Window;
  const runtimeWindow = {
    parent,
    addEventListener: vi.fn(
      (type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === 'message') {
          messageListener = listener as unknown as MessageListener;
        }
      }
    ),
    removeEventListener: vi.fn(
      (type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === 'message' && messageListener === listener) {
          messageListener = undefined;
        }
      }
    ),
  } as unknown as Window;
  const environment = {
    window: runtimeWindow,
    document: { referrer } as Document,
  } as RuntimeBridgeEnvironment;

  return {
    environment,
    parent,
    parentPostMessage,
    runtimeWindow,
    dispatchCheck(
      nonce: string,
      origin = 'https://cockpit.example',
      source: MessageEventSource | null = parent
    ) {
      messageListener?.({
        data: {
          type: 'tplane:runtime-check',
          version: 1,
          nonce,
          capability: 'chat',
        },
        origin,
        source,
      } as MessageEvent<unknown>);
    },
    dispatchMessage(
      data: unknown,
      origin = 'https://cockpit.example',
      source: MessageEventSource | null = parent
    ) {
      messageListener?.({ data, origin, source } as MessageEvent<unknown>);
    },
  };
}

describe('installRuntimeBridge', () => {
  it('does not publish inspection in default mode', () => {
    const { environment, parentPostMessage } = createEnvironment();
    const bridge = installRuntimeBridge(environment);
    bridge.publishInspection(inspectionFrame);
    expect(parentPostMessage).not.toHaveBeenCalled();
    bridge.dispose();
  });
  it('uses the current browser globals when no environment is provided', () => {
    const { environment, dispatchCheck, parentPostMessage } =
      createEnvironment();

    vi.stubGlobal('window', environment.window);
    vi.stubGlobal('document', environment.document);

    try {
      const bridge = installRuntimeBridge();

      dispatchCheck('nonce-1');
      bridge.markReady();

      expect(parentPostMessage).toHaveBeenCalledWith(
        { type: 'tplane:runtime-ready', version: 1, nonce: 'nonce-1' },
        'https://cockpit.example'
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not emit a ready reply when installed', () => {
    const { environment, parentPostMessage } = createEnvironment();

    installRuntimeBridge(environment);

    expect(parentPostMessage).not.toHaveBeenCalled();
  });

  it('ignores checks from a non-parent source', () => {
    const { environment, dispatchCheck, parentPostMessage } =
      createEnvironment();
    const bridge = installRuntimeBridge(environment);

    dispatchCheck(
      'nonce-1',
      'https://cockpit.example',
      {} as MessageEventSource
    );
    bridge.markReady();

    expect(parentPostMessage).not.toHaveBeenCalled();
  });

  it('ignores checks whose origin does not match the referrer origin', () => {
    const { environment, dispatchCheck, parentPostMessage } =
      createEnvironment();
    const bridge = installRuntimeBridge(environment);

    dispatchCheck('nonce-1', 'https://other.example');
    bridge.markReady();

    expect(parentPostMessage).not.toHaveBeenCalled();
  });

  it('derives the referrer origin once during installation', () => {
    const { environment, dispatchCheck, parentPostMessage } =
      createEnvironment();
    let referrerReads = 0;
    environment.document = {
      get referrer() {
        referrerReads += 1;

        if (referrerReads === 1) {
          return 'https://cockpit.example/embedded';
        }

        throw new Error('referrer should only be read during installation');
      },
    } as Document;

    const bridge = installRuntimeBridge(environment);

    expect(referrerReads).toBe(1);

    dispatchCheck('nonce-1');
    bridge.markReady();
    dispatchCheck('nonce-2');

    expect(referrerReads).toBe(1);
    expect(parentPostMessage).toHaveBeenNthCalledWith(
      1,
      { type: 'tplane:runtime-ready', version: 1, nonce: 'nonce-1' },
      'https://cockpit.example'
    );
    expect(parentPostMessage).toHaveBeenNthCalledWith(
      2,
      { type: 'tplane:runtime-ready', version: 1, nonce: 'nonce-2' },
      'https://cockpit.example'
    );
  });

  it.each([
    undefined,
    '',
    '/embedded',
    'not a URL',
    'ftp://cockpit.example',
    'javascript:alert(1)',
  ])('disables replies for an unusable referrer: %j', (referrer) => {
    const { environment, dispatchCheck, parentPostMessage } =
      createEnvironment(referrer);
    const bridge = installRuntimeBridge(environment);

    dispatchCheck('nonce-1');
    bridge.markReady();

    expect(parentPostMessage).not.toHaveBeenCalled();
  });

  it('accepts an HTTP referrer origin', () => {
    const { environment, dispatchCheck, parentPostMessage } = createEnvironment(
      'http://cockpit.example/some/path'
    );
    const bridge = installRuntimeBridge(environment);

    dispatchCheck('nonce-1', 'http://cockpit.example');
    bridge.markReady();

    expect(parentPostMessage).toHaveBeenCalledWith(
      { type: 'tplane:runtime-ready', version: 1, nonce: 'nonce-1' },
      'http://cockpit.example'
    );
  });

  it('uses only the referrer URL origin rather than query-provided origins', () => {
    const { environment, dispatchCheck, parentPostMessage } = createEnvironment(
      'https://cockpit.example/embed?parent=https://evil.example'
    );
    const bridge = installRuntimeBridge(environment);

    dispatchCheck('evil-nonce', 'https://evil.example');
    dispatchCheck('cockpit-nonce');
    bridge.markReady();

    expect(parentPostMessage).toHaveBeenCalledTimes(1);
    expect(parentPostMessage).toHaveBeenCalledWith(
      { type: 'tplane:runtime-ready', version: 1, nonce: 'cockpit-nonce' },
      'https://cockpit.example'
    );
  });

  it('retains only the newest valid check while initializing', () => {
    const { environment, dispatchCheck, parentPostMessage } =
      createEnvironment();
    const bridge = installRuntimeBridge(environment);

    dispatchCheck('nonce-1');
    dispatchCheck('nonce-2');
    bridge.markReady();

    expect(parentPostMessage).toHaveBeenCalledTimes(1);
    expect(parentPostMessage).toHaveBeenCalledWith(
      { type: 'tplane:runtime-ready', version: 1, nonce: 'nonce-2' },
      'https://cockpit.example'
    );
  });

  it('flushes a pending check once when marked ready', () => {
    const { environment, dispatchCheck, parentPostMessage } =
      createEnvironment();
    const bridge = installRuntimeBridge(environment);

    dispatchCheck('nonce-1');
    bridge.markReady();

    expect(parentPostMessage).toHaveBeenCalledWith(
      { type: 'tplane:runtime-ready', version: 1, nonce: 'nonce-1' },
      'https://cockpit.example'
    );
    expect(parentPostMessage).not.toHaveBeenCalledWith(expect.anything(), '*');
  });

  it('keeps the ready state when a pending reply cannot be delivered', () => {
    const { environment, dispatchCheck, parentPostMessage } =
      createEnvironment();
    const bridge = installRuntimeBridge(environment);

    parentPostMessage.mockImplementationOnce(() => {
      throw new Error('delivery failed');
    });
    dispatchCheck('nonce-1');

    expect(() => bridge.markReady()).not.toThrow();

    dispatchCheck('nonce-2');

    expect(parentPostMessage).toHaveBeenCalledTimes(2);
    expect(parentPostMessage).toHaveBeenLastCalledWith(
      { type: 'tplane:runtime-ready', version: 1, nonce: 'nonce-2' },
      'https://cockpit.example'
    );
  });

  it('flushes an allowlisted bootstrap failure once when marked errored', () => {
    const { environment, dispatchCheck, parentPostMessage } =
      createEnvironment();
    const bridge = installRuntimeBridge(environment);

    dispatchCheck('nonce-1');
    bridge.markError('bootstrap_failed');

    expect(parentPostMessage).toHaveBeenCalledTimes(1);
    expect(parentPostMessage).toHaveBeenCalledWith(
      {
        type: 'tplane:runtime-error',
        version: 1,
        nonce: 'nonce-1',
        code: 'bootstrap_failed',
      },
      'https://cockpit.example'
    );
  });

  it('ignores invalid runtime error codes while retaining a pending check', () => {
    const { environment, dispatchCheck, parentPostMessage } =
      createEnvironment();
    const bridge = installRuntimeBridge(environment);
    const unsafeBridge = bridge as unknown as UnsafeRuntimeBridge;

    dispatchCheck('nonce-1');

    expect(() => unsafeBridge.markError('unexpected_failure')).not.toThrow();
    expect(() =>
      unsafeBridge.markError({ code: 'bootstrap_failed' })
    ).not.toThrow();
    expect(parentPostMessage).not.toHaveBeenCalled();

    bridge.markError('bootstrap_failed');

    expect(parentPostMessage).toHaveBeenCalledTimes(1);
    expect(parentPostMessage).toHaveBeenCalledWith(
      {
        type: 'tplane:runtime-error',
        version: 1,
        nonce: 'nonce-1',
        code: 'bootstrap_failed',
      },
      'https://cockpit.example'
    );
  });

  it('allows a later ready transition after an invalid error call before any check', () => {
    const { environment, dispatchCheck, parentPostMessage } =
      createEnvironment();
    const bridge = installRuntimeBridge(environment);
    const unsafeBridge = bridge as unknown as UnsafeRuntimeBridge;

    unsafeBridge.markError('unexpected_failure');
    dispatchCheck('nonce-1');
    bridge.markReady();

    expect(parentPostMessage).toHaveBeenCalledWith(
      { type: 'tplane:runtime-ready', version: 1, nonce: 'nonce-1' },
      'https://cockpit.example'
    );
  });

  it('allows a later error transition after an invalid error call before any check', () => {
    const { environment, dispatchCheck, parentPostMessage } =
      createEnvironment();
    const bridge = installRuntimeBridge(environment);
    const unsafeBridge = bridge as unknown as UnsafeRuntimeBridge;

    unsafeBridge.markError('unexpected_failure');
    dispatchCheck('nonce-1');
    bridge.markError('bootstrap_failed');

    expect(parentPostMessage).toHaveBeenCalledWith(
      {
        type: 'tplane:runtime-error',
        version: 1,
        nonce: 'nonce-1',
        code: 'bootstrap_failed',
      },
      'https://cockpit.example'
    );
  });

  it('keeps the error state when a pending reply cannot be delivered', () => {
    const { environment, dispatchCheck, parentPostMessage } =
      createEnvironment();
    const bridge = installRuntimeBridge(environment);

    parentPostMessage.mockImplementationOnce(() => {
      throw new Error('delivery failed');
    });
    dispatchCheck('nonce-1');

    expect(() => bridge.markError('bootstrap_failed')).not.toThrow();

    dispatchCheck('nonce-2');

    expect(parentPostMessage).toHaveBeenCalledTimes(2);
    expect(parentPostMessage).toHaveBeenLastCalledWith(
      {
        type: 'tplane:runtime-error',
        version: 1,
        nonce: 'nonce-2',
        code: 'bootstrap_failed',
      },
      'https://cockpit.example'
    );
  });

  it('makes lifecycle calls idempotent and preserves the first terminal state', () => {
    const { environment, dispatchCheck, parentPostMessage } =
      createEnvironment();
    const bridge = installRuntimeBridge(environment);

    dispatchCheck('nonce-1');
    bridge.markReady();
    bridge.markError('bootstrap_failed');
    bridge.markReady();
    dispatchCheck('nonce-2');

    expect(parentPostMessage).toHaveBeenCalledTimes(2);
    expect(parentPostMessage).toHaveBeenNthCalledWith(
      1,
      { type: 'tplane:runtime-ready', version: 1, nonce: 'nonce-1' },
      'https://cockpit.example'
    );
    expect(parentPostMessage).toHaveBeenNthCalledWith(
      2,
      { type: 'tplane:runtime-ready', version: 1, nonce: 'nonce-2' },
      'https://cockpit.example'
    );
  });

  it('preserves bootstrap failure when error is the first terminal state', () => {
    const { environment, dispatchCheck, parentPostMessage } =
      createEnvironment();
    const bridge = installRuntimeBridge(environment);

    dispatchCheck('nonce-1');
    bridge.markError('bootstrap_failed');
    bridge.markReady();
    bridge.markError('bootstrap_failed');
    dispatchCheck('nonce-2');

    expect(parentPostMessage).toHaveBeenCalledTimes(2);
    expect(parentPostMessage).toHaveBeenNthCalledWith(
      1,
      {
        type: 'tplane:runtime-error',
        version: 1,
        nonce: 'nonce-1',
        code: 'bootstrap_failed',
      },
      'https://cockpit.example'
    );
    expect(parentPostMessage).toHaveBeenNthCalledWith(
      2,
      {
        type: 'tplane:runtime-error',
        version: 1,
        nonce: 'nonce-2',
        code: 'bootstrap_failed',
      },
      'https://cockpit.example'
    );
  });

  it('immediately returns the terminal error with the later check nonce', () => {
    const { environment, dispatchCheck, parentPostMessage } =
      createEnvironment();
    const bridge = installRuntimeBridge(environment);

    bridge.markError('bootstrap_failed');
    dispatchCheck('nonce-2');

    expect(parentPostMessage).toHaveBeenCalledWith(
      {
        type: 'tplane:runtime-error',
        version: 1,
        nonce: 'nonce-2',
        code: 'bootstrap_failed',
      },
      'https://cockpit.example'
    );
  });

  it('does not throw or change terminal state when an immediate reply cannot be delivered', () => {
    const { environment, dispatchCheck, parentPostMessage } =
      createEnvironment();
    const bridge = installRuntimeBridge(environment);

    bridge.markReady();
    parentPostMessage.mockImplementationOnce(() => {
      throw new Error('delivery failed');
    });

    expect(() => dispatchCheck('nonce-1')).not.toThrow();

    dispatchCheck('nonce-2');

    expect(parentPostMessage).toHaveBeenCalledTimes(2);
    expect(parentPostMessage).toHaveBeenLastCalledWith(
      { type: 'tplane:runtime-ready', version: 1, nonce: 'nonce-2' },
      'https://cockpit.example'
    );
  });

  it('removes its listener and blocks future replies when disposed', () => {
    const { environment, dispatchCheck, parentPostMessage, runtimeWindow } =
      createEnvironment();
    const bridge = installRuntimeBridge(environment);

    dispatchCheck('nonce-1');
    bridge.dispose();
    dispatchCheck('nonce-2');
    bridge.markReady();
    bridge.markError('bootstrap_failed');

    expect(runtimeWindow.removeEventListener).toHaveBeenCalledTimes(1);
    expect(parentPostMessage).not.toHaveBeenCalled();
  });

  it('ignores malformed protocol checks', () => {
    const { environment, dispatchMessage, parentPostMessage } =
      createEnvironment();
    const bridge = installRuntimeBridge(environment);

    dispatchMessage({
      type: 'tplane:runtime-check',
      version: 1,
      nonce: 'nonce-1',
      capability: 'chat',
      extra: true,
    });
    bridge.markReady();

    expect(parentPostMessage).not.toHaveBeenCalled();
  });
});

describe('runtime configuration child state machine', () => {
  const parentOrigin = 'https://threadplane.ai';
  type ConfigurationListener = (event: MessageEvent<unknown>) => void;

  function createConfigurationEnvironment(options?: {
    referrer?: string;
    standalone?: boolean;
    nonce?: string;
  }) {
    let messageListener: ConfigurationListener | undefined;
    const parentPostMessage = vi.fn();
    const parent = { postMessage: parentPostMessage } as unknown as Window;
    const runtimeWindow = {
      parent,
      addEventListener: vi.fn(
        (type: string, listener: EventListenerOrEventListenerObject) => {
          if (type === 'message') {
            messageListener = listener as unknown as ConfigurationListener;
          }
        }
      ),
      removeEventListener: vi.fn(
        (type: string, listener: EventListenerOrEventListenerObject) => {
          if (type === 'message' && messageListener === listener) {
            messageListener = undefined;
          }
        }
      ),
    } as unknown as Window;
    if (options?.standalone) {
      Object.assign(runtimeWindow, { parent: runtimeWindow });
    }

    const environment: RuntimeBridgeEnvironment = {
      window: runtimeWindow,
      document: {
        referrer: options?.referrer ?? `${parentOrigin}/docs/langgraph`,
      },
      crypto: {
        randomUUID: vi.fn(() => options?.nonce ?? 'fresh-child-nonce'),
      },
    };

    const dispatch = (
      data: unknown,
      origin = parentOrigin,
      source: MessageEventSource | null = parent
    ) => {
      messageListener?.({ data, origin, source } as MessageEvent<unknown>);
    };
    const configure = (
      generation: number,
      target: unknown = { kind: 'shared' },
      overrides: Partial<{
        version: number;
        nonce: string;
        origin: string;
        source: MessageEventSource | null;
      }> = {}
    ) => {
      dispatch(
        {
          type: 'tplane:runtime-configure',
          version: overrides.version ?? 2,
          nonce: overrides.nonce ?? options?.nonce ?? 'fresh-child-nonce',
          generation,
          target,
        },
        overrides.origin ?? parentOrigin,
        overrides.source ?? parent
      );
    };

    return {
      configure,
      dispatch,
      environment,
      getMessageListener: () => messageListener,
      parent,
      parentPostMessage,
      runtimeWindow,
    };
  }

  it('resolves standalone windows to their registry default immediately', async () => {
    const { environment, parentPostMessage } = createConfigurationEnvironment({
      standalone: true,
    });
    const bridge = installRuntimeBridge(environment, {
      allowedParentOrigins: [parentOrigin],
    });

    await expect(bridge.awaitConfiguration()).resolves.toEqual({
      status: 'default',
    });
    expect(parentPostMessage).not.toHaveBeenCalled();
  });

  it('uses the default immediately for an unrecognized embed and ignores configuration', async () => {
    const { configure, environment, parentPostMessage } =
      createConfigurationEnvironment({
        referrer: 'https://lookalike.threadplane.ai/embed',
      });
    const bridge = installRuntimeBridge(environment, {
      allowedParentOrigins: [parentOrigin],
    });

    configure(3);

    await expect(bridge.awaitConfiguration()).resolves.toEqual({
      status: 'default',
    });
    expect(parentPostMessage).not.toHaveBeenCalled();
  });

  it('installs the listener before announcing a fresh child nonce to an exact allowlisted parent', () => {
    const { environment, parentPostMessage, runtimeWindow } =
      createConfigurationEnvironment({ nonce: 'fresh-nonce-1' });
    const callOrder: string[] = [];
    vi.mocked(runtimeWindow.addEventListener).mockImplementationOnce(
      (type: string, listener: EventListenerOrEventListenerObject) => {
        callOrder.push('listener');
        if (type === 'message') {
          // This callback is intentionally not dispatched: this assertion is
          // only about installation order.
          expect(listener).toBeDefined();
        }
      }
    );
    parentPostMessage.mockImplementationOnce(() => {
      callOrder.push('ready');
    });

    installRuntimeBridge(environment, {
      allowedParentOrigins: [parentOrigin],
    });

    expect(callOrder).toEqual(['listener', 'ready']);
    expect(parentPostMessage).toHaveBeenCalledWith(
      {
        type: 'tplane:runtime-child-ready',
        version: 2,
        nonce: 'fresh-nonce-1',
      },
      parentOrigin
    );
    expect(parentPostMessage).not.toHaveBeenCalledWith(expect.anything(), '*');
  });

  it('creates a fresh nonce for each recognized bridge installation', () => {
    const first = createConfigurationEnvironment({ nonce: 'fresh-nonce-1' });
    const second = createConfigurationEnvironment({ nonce: 'fresh-nonce-2' });

    installRuntimeBridge(first.environment, {
      allowedParentOrigins: [parentOrigin],
    });
    installRuntimeBridge(second.environment, {
      allowedParentOrigins: [parentOrigin],
    });

    expect(first.parentPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: 'fresh-nonce-1' }),
      parentOrigin
    );
    expect(second.parentPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: 'fresh-nonce-2' }),
      parentOrigin
    );
  });

  it('fails closed without posting when the nonce source is invalid', async () => {
    const { environment, parentPostMessage } = createConfigurationEnvironment({
      nonce: '   ',
    });
    const bridge = installRuntimeBridge(environment, {
      allowedParentOrigins: [parentOrigin],
    });

    await expect(bridge.awaitConfiguration()).resolves.toEqual({
      status: 'error',
      code: 'incompatible_bridge',
    });
    expect(parentPostMessage).not.toHaveBeenCalled();
  });

  it('retries child-ready until an exact configuration is accepted', async () => {
    vi.useFakeTimers();
    try {
      const { configure, environment, parentPostMessage } =
        createConfigurationEnvironment();
      const bridge = installRuntimeBridge(environment, {
        allowedParentOrigins: [parentOrigin],
        childReadyRetryMs: 25,
        configurationTimeoutMs: 200,
      });

      expect(parentPostMessage).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(75);
      expect(parentPostMessage).toHaveBeenCalledTimes(4);

      configure(4, { kind: 'ag-ui', endpoint: 'https://agent.example/run' });
      await expect(bridge.awaitConfiguration()).resolves.toMatchObject({
        status: 'configured',
        generation: 4,
        target: { kind: 'ag-ui', endpoint: 'https://agent.example/run' },
      });
      expect(parentPostMessage).toHaveBeenLastCalledWith(
        {
          type: 'tplane:runtime-configured',
          version: 2,
          nonce: 'fresh-child-nonce',
          generation: 4,
        },
        parentOrigin
      );

      const settledCallCount = parentPostMessage.mock.calls.length;
      await vi.advanceTimersByTimeAsync(100);
      expect(parentPostMessage).toHaveBeenCalledTimes(settledCallCount);
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-acknowledges an identical duplicate when the first configured acknowledgement is lost', async () => {
    const { configure, environment, parentPostMessage } =
      createConfigurationEnvironment();
    const bridge = installRuntimeBridge(environment, {
      allowedParentOrigins: [parentOrigin],
    });
    parentPostMessage.mockClear();
    parentPostMessage.mockImplementationOnce(() => {
      throw new Error('configured acknowledgement lost');
    });
    const target = {
      kind: 'langsmith',
      apiUrl: 'https://api.example/v1',
      apiKey: 'test-key-redact-me',
    };

    expect(() => configure(8, target)).not.toThrow();
    configure(8, target);

    await expect(bridge.awaitConfiguration()).resolves.toMatchObject({
      status: 'configured',
      generation: 8,
      target,
    });
    expect(parentPostMessage).toHaveBeenCalledTimes(2);
    expect(parentPostMessage).toHaveBeenLastCalledWith(
      {
        type: 'tplane:runtime-configured',
        version: 2,
        nonce: 'fresh-child-nonce',
        generation: 8,
      },
      parentOrigin
    );
  });

  it('fails a conflicting duplicate for the authoritative nonce and generation', async () => {
    const { configure, environment, parentPostMessage } =
      createConfigurationEnvironment();
    const bridge = installRuntimeBridge(environment, {
      allowedParentOrigins: [parentOrigin],
    });
    configure(5, { kind: 'ag-ui', endpoint: 'https://one.example/run' });
    parentPostMessage.mockClear();

    configure(5, { kind: 'ag-ui', endpoint: 'https://two.example/run' });

    await expect(bridge.awaitConfiguration()).resolves.toMatchObject({
      status: 'configured',
      generation: 5,
      target: { kind: 'ag-ui', endpoint: 'https://one.example/run' },
    });
    expect(parentPostMessage).toHaveBeenCalledWith(
      {
        type: 'tplane:runtime-configuration-failed',
        version: 2,
        nonce: 'fresh-child-nonce',
        generation: 5,
        code: 'incompatible_bridge',
      },
      parentOrigin
    );
  });

  it('keeps the accepted target immutable for duplicate equality', async () => {
    const { configure, environment, parentPostMessage } =
      createConfigurationEnvironment();
    const bridge = installRuntimeBridge(environment, {
      allowedParentOrigins: [parentOrigin],
    });
    const rawTarget = {
      kind: 'langsmith',
      apiUrl: 'https://api.example/v1',
      apiKey: 'test-key-redact-me',
    };
    configure(9, rawTarget);
    const configured = await bridge.awaitConfiguration();
    expect(configured.status).toBe('configured');
    if (configured.status !== 'configured') return;
    expect(Object.isFrozen(configured.target)).toBe(true);
    expect(() => {
      (
        configured.target as {
          apiKey?: string;
        }
      ).apiKey = 'mutated-key';
    }).toThrow(TypeError);
    parentPostMessage.mockClear();

    configure(9, rawTarget);
    expect(parentPostMessage).toHaveBeenCalledWith(
      {
        type: 'tplane:runtime-configured',
        version: 2,
        nonce: 'fresh-child-nonce',
        generation: 9,
      },
      parentOrigin
    );

    parentPostMessage.mockClear();
    configure(9, { ...rawTarget, apiKey: 'different-key' });
    expect(parentPostMessage).toHaveBeenCalledWith(
      {
        type: 'tplane:runtime-configuration-failed',
        version: 2,
        nonce: 'fresh-child-nonce',
        generation: 9,
        code: 'incompatible_bridge',
      },
      parentOrigin
    );
  });

  it('ignores wrong source, origin, version, nonce, malformed, and stale configuration messages', async () => {
    vi.useFakeTimers();
    try {
      const { configure, dispatch, environment, parentPostMessage } =
        createConfigurationEnvironment();
      const bridge = installRuntimeBridge(environment, {
        allowedParentOrigins: [parentOrigin],
        configurationTimeoutMs: 200,
      });
      parentPostMessage.mockClear();

      configure(1, { kind: 'shared' }, { source: {} as Window });
      configure(1, { kind: 'shared' }, { origin: 'https://evil.example' });
      configure(1, { kind: 'shared' }, { version: 1 });
      configure(1, { kind: 'shared' }, { nonce: 'wrong-nonce' });
      dispatch({
        type: 'tplane:runtime-configure',
        version: 2,
        nonce: 'fresh-child-nonce',
        generation: 1,
        target: { kind: 'shared' },
        extra: true,
      });
      expect(parentPostMessage).not.toHaveBeenCalled();

      configure(6);
      await bridge.awaitConfiguration();
      parentPostMessage.mockClear();
      configure(5);
      expect(parentPostMessage).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails closed when recognized configuration does not complete before the deadline', async () => {
    vi.useFakeTimers();
    try {
      const { environment } = createConfigurationEnvironment();
      const bridge = installRuntimeBridge(environment, {
        allowedParentOrigins: [parentOrigin],
        childReadyRetryMs: 25,
        configurationTimeoutMs: 100,
      });

      await vi.advanceTimersByTimeAsync(100);

      await expect(bridge.awaitConfiguration()).resolves.toEqual({
        status: 'error',
        code: 'incompatible_bridge',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('disposes listeners and timers and rejects later configuration', async () => {
    vi.useFakeTimers();
    try {
      const { configure, environment, parentPostMessage, runtimeWindow } =
        createConfigurationEnvironment();
      const bridge = installRuntimeBridge(environment, {
        allowedParentOrigins: [parentOrigin],
        childReadyRetryMs: 25,
        configurationTimeoutMs: 100,
      });
      parentPostMessage.mockClear();

      bridge.dispose();
      configure(3);
      await vi.advanceTimersByTimeAsync(200);

      expect(runtimeWindow.removeEventListener).toHaveBeenCalledOnce();
      expect(parentPostMessage).not.toHaveBeenCalled();
      await expect(bridge.awaitConfiguration()).resolves.toEqual({
        status: 'error',
        code: 'incompatible_bridge',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports only allowlisted operation failures for the accepted generation', async () => {
    const { configure, environment, parentPostMessage } =
      createConfigurationEnvironment();
    const bridge = installRuntimeBridge(environment, {
      allowedParentOrigins: [parentOrigin],
    });
    configure(12);
    const configured = await bridge.awaitConfiguration();
    expect(configured.status).toBe('configured');
    if (configured.status !== 'configured') return;
    parentPostMessage.mockClear();

    configured.reportOperationFailure('unauthorized');
    configured.reportOperationFailure('network_blocked');
    const unsafeReporter = configured.reportOperationFailure as (
      code: unknown
    ) => void;
    unsafeReporter('incompatible_bridge');
    unsafeReporter({ code: 'unauthorized' });

    expect(parentPostMessage.mock.calls).toEqual([
      [
        {
          type: 'tplane:runtime-operation-failed',
          version: 2,
          nonce: 'fresh-child-nonce',
          generation: 12,
          code: 'unauthorized',
        },
        parentOrigin,
      ],
      [
        {
          type: 'tplane:runtime-operation-failed',
          version: 2,
          nonce: 'fresh-child-nonce',
          generation: 12,
          code: 'network_blocked',
        },
        parentOrigin,
      ],
    ]);

    bridge.dispose();
    configured.reportOperationFailure('unauthorized');
    expect(parentPostMessage).toHaveBeenCalledTimes(2);
  });

  it('publishes detached inspection only while configured to the accepted parent generation', () => {
    const { configure, environment, parentPostMessage } =
      createConfigurationEnvironment();
    const bridge = installRuntimeBridge(environment, {
      allowedParentOrigins: [parentOrigin],
    });
    parentPostMessage.mockClear();
    bridge.publishInspection(inspectionFrame);
    expect(parentPostMessage).not.toHaveBeenCalled();
    configure(12, {
      kind: 'langsmith',
      apiUrl: 'https://api.example',
      apiKey: 'must-not-leak',
    });
    parentPostMessage.mockClear();
    bridge.publishInspection(inspectionFrame);
    expect(parentPostMessage).toHaveBeenCalledExactlyOnceWith(
      {
        type: 'tplane:runtime-inspection',
        version: 1,
        nonce: 'fresh-child-nonce',
        generation: 12,
        frame: inspectionFrame,
      },
      parentOrigin
    );
    expect(parentPostMessage.mock.calls[0][0].frame).not.toBe(inspectionFrame);
    expect(JSON.stringify(parentPostMessage.mock.calls)).not.toContain(
      'must-not-leak'
    );
    bridge.publishInspection({
      ...inspectionFrame,
      extra: 'secret',
    } as InspectionFrame);
    bridge.dispose();
    bridge.publishInspection(inspectionFrame);
    expect(parentPostMessage).toHaveBeenCalledTimes(1);
  });

  it('isolates parent postMessage failures for inspection', () => {
    const { configure, environment, parentPostMessage } =
      createConfigurationEnvironment();
    const bridge = installRuntimeBridge(environment, {
      allowedParentOrigins: [parentOrigin],
    });
    configure(1);
    parentPostMessage.mockImplementation(() => {
      throw new Error('closed');
    });
    expect(() => bridge.publishInspection(inspectionFrame)).not.toThrow();
    bridge.dispose();
  });

  it('delivers a configured target once and exposes no credential after disposal', async () => {
    const { configure, environment, parentPostMessage } =
      createConfigurationEnvironment();
    const bridge = installRuntimeBridge(environment, {
      allowedParentOrigins: [parentOrigin],
    });
    configure(14, {
      kind: 'langsmith',
      apiUrl: 'https://api.example/v1',
      apiKey: 'test-key-redact-me',
    });

    const configured = await bridge.awaitConfiguration();
    expect(configured.status).toBe('configured');
    if (configured.status !== 'configured') return;

    const consumedAgain = await bridge.awaitConfiguration();
    expect(consumedAgain).toEqual({
      status: 'error',
      code: 'incompatible_bridge',
    });
    expect(consumedAgain).not.toBe(configured);
    expect(JSON.stringify(consumedAgain)).not.toContain('test-key-redact-me');

    bridge.dispose();
    parentPostMessage.mockClear();
    configured.reportOperationFailure('unauthorized');
    const afterDisposal = await bridge.awaitConfiguration();

    expect(parentPostMessage).not.toHaveBeenCalled();
    expect(afterDisposal).toEqual({
      status: 'error',
      code: 'incompatible_bridge',
    });
    expect(afterDisposal).not.toBe(configured);
    expect(JSON.stringify(afterDisposal)).not.toContain('test-key-redact-me');
  });
});
