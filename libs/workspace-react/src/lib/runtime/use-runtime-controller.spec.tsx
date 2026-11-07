/** @vitest-environment jsdom */
import React, { Suspense, act, startTransition, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
import {
  RUNTIME_BRIDGE_VERSION,
  RUNTIME_INSPECTION_VERSION,
  RUNTIME_CONFIGURATION_VERSION,
} from '@threadplane/cockpit-runtime-bridge';
import type { RuntimeActivityInput } from './session-activity';
import type { EffectiveRuntimeTarget } from './runtime-target-session';
import type { RuntimeTerminalTransition } from './runtime-state';
import {
  useRuntimeController,
  type RuntimeController,
  type UseRuntimeControllerOptions,
} from './use-runtime-controller';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const firstNonce = '00000000-0000-4000-8000-000000000001';
const firstEventId = '00000000-0000-4000-8000-000000000002';
const secondNonce = '00000000-0000-4000-8000-000000000003';
const secondEventId = '00000000-0000-4000-8000-000000000004';

interface HarnessProps extends UseRuntimeControllerOptions {
  mountFrame?: boolean;
}

let controller: RuntimeController;

function Harness({ mountFrame = true, ...options }: HarnessProps) {
  controller = useRuntimeController(options);
  return mountFrame ? <iframe ref={controller.frameRef} /> : null;
}

interface ConcurrentHarnessProps extends HarnessProps {
  suspend: boolean;
  suspension: Promise<never>;
}

let committedConcurrentController: RuntimeController;

function ConcurrentHarness({
  suspend,
  suspension,
  mountFrame = true,
  ...options
}: ConcurrentHarnessProps) {
  const candidate = useRuntimeController(options);
  useLayoutEffect(() => {
    committedConcurrentController = candidate;
  }, [candidate]);
  if (suspend) throw suspension;
  return mountFrame ? <iframe ref={candidate.frameRef} /> : null;
}

function runtimeReady(nonce: string) {
  return {
    type: 'tplane:runtime-ready',
    version: RUNTIME_BRIDGE_VERSION,
    nonce,
  } as const;
}

function runtimeError(nonce: string) {
  return {
    type: 'tplane:runtime-error',
    version: RUNTIME_BRIDGE_VERSION,
    nonce,
    code: 'bootstrap_failed',
  } as const;
}

const noneTarget: EffectiveRuntimeTarget = {
  adapter: 'none',
  target: null,
};

const sharedLangGraphTarget: EffectiveRuntimeTarget = {
  adapter: 'langgraph',
  target: { kind: 'shared' },
};

const customLangGraphTarget = (
  apiUrl = 'https://api.example.test/langgraph',
  apiKey = 'test-key-redact-me'
): EffectiveRuntimeTarget => ({
  adapter: 'langgraph',
  target: { kind: 'langsmith', apiUrl, apiKey },
});

function childReady(nonce: string) {
  return {
    type: 'tplane:runtime-child-ready',
    version: RUNTIME_CONFIGURATION_VERSION,
    nonce,
  } as const;
}

function configured(nonce: string, generation: number) {
  return {
    type: 'tplane:runtime-configured',
    version: RUNTIME_CONFIGURATION_VERSION,
    nonce,
    generation,
  } as const;
}

function emitMessage(
  data: unknown,
  origin: string,
  source: MessageEventSource | null
) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin, source }));
  });
}

describe('useRuntimeController', () => {
  let container: HTMLDivElement;
  let root: Root;
  let onActivity: Mock<(event: RuntimeActivityInput) => void>;
  let onTerminalTransition: Mock<(event: RuntimeTerminalTransition) => void>;
  let randomUUID: Mock<
    () => `${string}-${string}-${string}-${string}-${string}`
  >;

  let onInspection = vi.fn();
  let onInspectionReset = vi.fn();

  const render = (
    runtimeUrl: string | null,
    capability = 'streaming',
    mountFrame = true,
    effectiveTarget: EffectiveRuntimeTarget = noneTarget
  ) => {
    act(() => {
      root.render(
        <Harness
          runtimeUrl={runtimeUrl}
          capability={capability}
          effectiveTarget={effectiveTarget}
          onActivity={onActivity}
          onTerminalTransition={onTerminalTransition}
          onInspection={onInspection}
          onInspectionReset={onInspectionReset}
          mountFrame={mountFrame}
        />
      );
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T17:00:00.000Z'));
    randomUUID = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue(firstNonce);
    onInspection = vi.fn();
    onInspectionReset = vi.fn();
    onActivity = vi.fn();
    onTerminalTransition = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function inspection(sequence: number, nonce = 'child', generation = 0) {
    return {
      type: 'tplane:runtime-inspection',
      version: RUNTIME_INSPECTION_VERSION,
      nonce,
      generation,
      frame: {
        sequence,
        elapsedMs: 0,
        framework: 'react',
        messages: [],
        state: { busy: false },
        busy: false,
        calls: [],
        event: { type: 'snapshot', payload: null },
        limited: false,
      },
    };
  }

  it('accepts inspection only from a configured session with exact identity and increasing sequence', () => {
    render(
      'https://runtime.example.test',
      'streaming',
      true,
      sharedLangGraphTarget
    );
    const source = controller.frameRef.current!.contentWindow;
    const emit = (
      data: unknown,
      origin = 'https://runtime.example.test',
      sender = source
    ) => emitMessage(data, origin, sender);
    emit(inspection(1));
    emit(childReady('child'));
    emit(inspection(1));
    expect(onInspection).not.toHaveBeenCalled();
    emit(configured('child', 0));
    emit(inspection(1), 'https://hostile.test');
    emit(inspection(1), undefined, window);
    emit(inspection(1, 'other'));
    emit(inspection(1, 'child', 2));
    expect(onInspection).not.toHaveBeenCalled();
    emit(inspection(2));
    emit(inspection(1));
    emit(inspection(2));
    expect(onInspection).toHaveBeenCalledTimes(1);
    expect(onInspection).toHaveBeenLastCalledWith(inspection(2).frame);
    act(() => controller.onFrameLoad());
    emit(inspection(3));
    expect(onInspection).toHaveBeenCalledTimes(2);
    // The first load after child-ready/configured must not erase early frames.
    expect(onInspectionReset).not.toHaveBeenCalled();
    act(() => controller.reload());
    expect(onInspectionReset).toHaveBeenCalledTimes(1);
    emit(inspection(4));
    expect(onInspection).toHaveBeenCalledTimes(2);
    emit(childReady('next'));
    emit(configured('next', 0));
    emit(inspection(1, 'next'));
    expect(onInspection).toHaveBeenCalledTimes(3);
  });

  it('resets inspection ownership on target, route and disposal and isolates callback exceptions', () => {
    render(
      'https://runtime.example.test',
      'streaming',
      true,
      sharedLangGraphTarget
    );
    const source = controller.frameRef.current!.contentWindow;
    const emit = (data: unknown) =>
      emitMessage(data, 'https://runtime.example.test', source);
    emit(childReady('child'));
    emit(configured('child', 0));
    onInspection.mockImplementation(() => {
      throw new Error('consumer');
    });
    expect(() => emit(inspection(1))).not.toThrow();
    onInspectionReset.mockImplementation(() => {
      throw new Error('consumer reset');
    });
    render(
      'https://runtime.example.test',
      'streaming',
      true,
      customLangGraphTarget()
    );
    expect(onInspectionReset).toHaveBeenCalledTimes(1);
    emit(inspection(2));
    expect(onInspection).toHaveBeenCalledTimes(1);
    render(
      'https://other.example.test',
      'streaming',
      true,
      customLangGraphTarget()
    );
    expect(onInspectionReset).toHaveBeenCalledTimes(2);
    act(() => root.render(null));
    expect(onInspectionReset).toHaveBeenCalledTimes(3);
  });

  it('clears inspection on a second iframe load and requires a fresh handshake', () => {
    render(
      'https://runtime.example.test',
      'streaming',
      true,
      sharedLangGraphTarget
    );
    const source = controller.frameRef.current!.contentWindow;
    const emit = (data: unknown) =>
      emitMessage(data, 'https://runtime.example.test', source);
    act(() => controller.onFrameLoad());
    emit(childReady('first-page'));
    emit(configured('first-page', 0));
    emit(inspection(20, 'first-page'));
    expect(onInspection).toHaveBeenCalledTimes(1);
    act(() => controller.onFrameLoad());
    expect(onInspectionReset).toHaveBeenCalledTimes(1);
    emit(inspection(21, 'first-page'));
    emit(configured('first-page', 0));
    expect(onInspection).toHaveBeenCalledTimes(1);
    emit(childReady('second-page'));
    emit(inspection(1, 'second-page'));
    expect(onInspection).toHaveBeenCalledTimes(1);
    emit(configured('second-page', 0));
    emit(inspection(1, 'second-page'));
    expect(onInspection).toHaveBeenCalledTimes(2);
  });

  it('clears inspection when a replacement frame window takes ownership', () => {
    render(
      'https://runtime.example.test',
      'streaming',
      true,
      sharedLangGraphTarget
    );
    const source = controller.frameRef.current!.contentWindow;
    emitMessage(
      childReady('first-page'),
      'https://runtime.example.test',
      source
    );
    emitMessage(
      configured('first-page', 0),
      'https://runtime.example.test',
      source
    );
    emitMessage(
      inspection(1, 'first-page'),
      'https://runtime.example.test',
      source
    );
    render(
      'https://runtime.example.test',
      'streaming',
      false,
      sharedLangGraphTarget
    );
    render(
      'https://runtime.example.test',
      'streaming',
      true,
      sharedLangGraphTarget
    );
    emitMessage(
      childReady('replacement'),
      'https://runtime.example.test',
      controller.frameRef.current!.contentWindow
    );
    expect(onInspectionReset).toHaveBeenCalledTimes(1);
    emitMessage(
      inspection(2, 'first-page'),
      'https://runtime.example.test',
      source
    );
    expect(onInspection).toHaveBeenCalledTimes(1);
    emitMessage(
      configured('replacement', 0),
      'https://runtime.example.test',
      controller.frameRef.current!.contentWindow
    );
    emitMessage(
      inspection(1, 'replacement'),
      'https://runtime.example.test',
      controller.frameRef.current!.contentWindow
    );
    expect(onInspection).toHaveBeenCalledTimes(2);
  });

  it('omits frame commands for missing and invalid targets', () => {
    const open = vi.spyOn(window, 'open');

    render(null);
    expect(controller.snapshot.phase).toBe('not_configured');
    expect(controller.validatedRuntimeUrl).toBeNull();
    act(() => {
      controller.onFrameLoad();
      controller.recheck();
      controller.reload();
    });
    expect(controller.open()).toBe('failed');

    render('javascript:alert(1)');
    expect(controller.snapshot.phase).toBe('invalid_configuration');
    expect(controller.validatedRuntimeUrl).toBeNull();
    act(() => {
      controller.onFrameLoad();
      controller.recheck();
      controller.reload();
    });
    expect(controller.open()).toBe('failed');

    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(onActivity).toHaveBeenCalledTimes(1);
    expect(onActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'configuration_invalid',
        capability: 'streaming',
      })
    );
    expect(onTerminalTransition).toHaveBeenCalledTimes(1);
    expect(onTerminalTransition).toHaveBeenCalledWith({
      capability: 'streaming',
      fromState: 'not_configured',
      toState: 'invalid_configuration',
      reasonCode: 'invalid_runtime_url',
    });
  });

  it('starts configured targets in connecting without doing hydration-placeholder work', () => {
    render('https://runtime.test/path?secret=x#hash');

    expect(controller.snapshot).toMatchObject({
      phase: 'connecting',
      activeNonce: null,
      frameGeneration: 0,
    });
    expect(controller.validatedRuntimeUrl).toBe('https://runtime.test/path');
    expect(randomUUID).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(onActivity).not.toHaveBeenCalled();
    expect(onTerminalTransition).not.toHaveBeenCalled();
  });

  it('posts one exact-origin v1 check on frame load without treating load as ready', () => {
    randomUUID
      .mockReturnValueOnce(firstNonce)
      .mockReturnValueOnce(firstEventId);
    render('https://runtime.test/path?secret=x#hash');
    const frameWindow = controller.frameRef.current?.contentWindow;
    expect(frameWindow).not.toBeNull();
    const postMessage = vi.spyOn(frameWindow!, 'postMessage');

    act(() => controller.onFrameLoad());

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'tplane:runtime-check',
        version: RUNTIME_BRIDGE_VERSION,
        nonce: firstNonce,
        capability: 'streaming',
      },
      'https://runtime.test'
    );
    expect(postMessage).not.toHaveBeenCalledWith(expect.anything(), '*');
    expect(controller.snapshot).toMatchObject({
      phase: 'connecting',
      activeNonce: firstNonce,
      checkStartedAt: Date.parse('2026-08-31T17:00:00.000Z'),
    });
    expect(vi.getTimerCount()).toBe(1);
    expect(onActivity).toHaveBeenCalledTimes(1);
    expect(onActivity).toHaveBeenCalledWith({
      id: firstEventId,
      at: '2026-08-31T17:00:00.000Z',
      kind: 'runtime_check_requested',
      capability: 'streaming',
    });
    expect(onTerminalTransition).not.toHaveBeenCalled();
  });

  it('configures a compatible child at the exact iframe origin and stops retrying only for the matching acknowledgement', () => {
    const childNonce = 'child-configuration-nonce';
    render(
      'https://runtime.test/path',
      'streaming',
      true,
      customLangGraphTarget()
    );
    const frameWindow = controller.frameRef.current!.contentWindow!;
    const postMessage = vi.spyOn(frameWindow, 'postMessage');

    expect(controller.snapshot).toMatchObject({
      phase: 'configuring',
      targetGeneration: 0,
      frameGeneration: 0,
      routeGeneration: 0,
    });
    emitMessage(childReady(childNonce), 'https://runtime.test', frameWindow);

    const configureMessage = {
      type: 'tplane:runtime-configure',
      version: RUNTIME_CONFIGURATION_VERSION,
      nonce: childNonce,
      generation: 0,
      target: {
        kind: 'langsmith',
        apiUrl: 'https://api.example.test/langgraph',
        apiKey: 'test-key-redact-me',
      },
    } as const;
    expect(postMessage).toHaveBeenCalledWith(
      configureMessage,
      'https://runtime.test'
    );
    expect(postMessage).not.toHaveBeenCalledWith(expect.anything(), '*');

    act(() => vi.advanceTimersByTime(250));
    expect(postMessage).toHaveBeenCalledTimes(2);

    emitMessage(
      { ...childReady('wrong-version'), version: 1 },
      'https://runtime.test',
      frameWindow
    );
    emitMessage(
      configured('wrong-child-nonce', 0),
      'https://runtime.test',
      frameWindow
    );
    emitMessage(configured(childNonce, 1), 'https://runtime.test', frameWindow);
    emitMessage(configured(childNonce, 0), 'https://sibling.test', frameWindow);
    emitMessage(configured(childNonce, 0), 'https://runtime.test', window);
    expect(controller.snapshot.phase).toBe('configuring');

    emitMessage(configured(childNonce, 0), 'https://runtime.test', frameWindow);
    expect(controller.snapshot.phase).toBe('connecting');
    const callCount = postMessage.mock.calls.length;
    act(() => vi.advanceTimersByTime(5_000));
    expect(postMessage).toHaveBeenCalledTimes(callCount);
    expect(vi.getTimerCount()).toBe(0);

    const serialized = JSON.stringify({
      snapshot: controller.snapshot,
      runtimeContext: controller.runtimeContext,
      validatedRuntimeUrl: controller.validatedRuntimeUrl,
      frameGeneration: controller.frameGeneration,
      targetGeneration: controller.targetGeneration,
    });
    expect(serialized).not.toContain('test-key-redact-me');
    expect(serialized).not.toContain('api.example.test');
  });

  it('owns a distinct target generation and increments it exactly once per semantic target change', () => {
    render(
      'https://runtime.test/path',
      'streaming',
      true,
      sharedLangGraphTarget
    );
    expect(controller.snapshot).toMatchObject({
      targetGeneration: 0,
      routeGeneration: 0,
      frameGeneration: 0,
    });

    render(
      'https://runtime.test/path',
      'persistence',
      true,
      sharedLangGraphTarget
    );
    expect(controller.snapshot).toMatchObject({
      targetGeneration: 0,
      routeGeneration: 1,
      frameGeneration: 0,
    });

    render('https://runtime.test/path', 'persistence', true, {
      adapter: 'ag-ui',
      target: { kind: 'shared' },
    });
    expect(controller.snapshot).toMatchObject({
      targetGeneration: 1,
      routeGeneration: 1,
      frameGeneration: 1,
    });

    const custom = customLangGraphTarget();
    render('https://runtime.test/path', 'persistence', true, custom);
    expect(controller.snapshot).toMatchObject({
      targetGeneration: 2,
      routeGeneration: 1,
      frameGeneration: 2,
    });

    render(
      'https://runtime.test/path',
      'persistence',
      true,
      customLangGraphTarget()
    );
    expect(controller.snapshot).toMatchObject({
      targetGeneration: 2,
      routeGeneration: 1,
      frameGeneration: 2,
    });

    render(
      'https://runtime.test/path',
      'persistence',
      true,
      customLangGraphTarget(
        'https://api.example.test/langgraph',
        'replacement-key'
      )
    );
    expect(controller.snapshot).toMatchObject({
      targetGeneration: 3,
      routeGeneration: 1,
      frameGeneration: 3,
    });
  });

  it('detects in-place endpoint and adapter mutation from primitive target fields', () => {
    const mutableTarget = {
      adapter: 'ag-ui' as 'ag-ui' | 'langgraph',
      target: {
        kind: 'ag-ui' as 'ag-ui' | 'shared',
        endpoint: 'HTTPS://AGENT.EXAMPLE.TEST:443/one',
      },
    };

    render(
      'https://runtime.test/path',
      'streaming',
      true,
      mutableTarget as EffectiveRuntimeTarget
    );
    expect(controller.snapshot).toMatchObject({
      targetGeneration: 0,
      frameGeneration: 0,
    });

    mutableTarget.target.endpoint = 'https://agent.example.test/one';
    render(
      'https://runtime.test/path',
      'streaming',
      true,
      mutableTarget as EffectiveRuntimeTarget
    );
    expect(controller.snapshot).toMatchObject({
      targetGeneration: 0,
      frameGeneration: 0,
    });

    mutableTarget.target.endpoint = 'https://agent.example.test/two';
    render(
      'https://runtime.test/path',
      'streaming',
      true,
      mutableTarget as EffectiveRuntimeTarget
    );
    expect(controller.snapshot).toMatchObject({
      targetGeneration: 1,
      frameGeneration: 1,
    });

    mutableTarget.adapter = 'langgraph';
    mutableTarget.target.kind = 'shared';
    render(
      'https://runtime.test/path',
      'streaming',
      true,
      mutableTarget as EffectiveRuntimeTarget
    );
    expect(controller.snapshot).toMatchObject({
      targetGeneration: 2,
      frameGeneration: 2,
    });
  });

  it('detects an in-place LangSmith key mutation and never posts it under the old generation', () => {
    const mutableTarget = {
      adapter: 'langgraph' as const,
      target: {
        kind: 'langsmith' as const,
        apiUrl: 'https://api.example.test/langgraph',
        apiKey: 'first-private-key',
      },
    };
    render('https://runtime.test/path', 'streaming', true, mutableTarget);
    const frameWindow = controller.frameRef.current!.contentWindow!;
    const postMessage = vi.spyOn(frameWindow, 'postMessage');
    emitMessage(childReady('first-child'), 'https://runtime.test', frameWindow);
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        generation: 0,
        target: expect.objectContaining({ apiKey: 'first-private-key' }),
      }),
      'https://runtime.test'
    );

    mutableTarget.target.apiKey = 'replacement-private-key';
    render('https://runtime.test/path', 'streaming', true, mutableTarget);
    expect(controller.snapshot).toMatchObject({
      phase: 'configuring',
      targetGeneration: 1,
      frameGeneration: 1,
    });

    const oldGenerationCallCount = postMessage.mock.calls.length;
    act(() => vi.advanceTimersByTime(250));
    expect(postMessage).toHaveBeenCalledTimes(oldGenerationCallCount);

    emitMessage(
      childReady('replacement-child'),
      'https://runtime.test',
      frameWindow
    );
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        generation: 1,
        target: expect.objectContaining({ apiKey: 'replacement-private-key' }),
      }),
      'https://runtime.test'
    );
    expect(JSON.stringify(controller.runtimeContext)).not.toContain(
      'replacement-private-key'
    );
  });

  it('does not send configuration for a static runtime adapter', () => {
    render('https://runtime.test/path', 'streaming', true, noneTarget);
    const frameWindow = controller.frameRef.current!.contentWindow!;
    const postMessage = vi.spyOn(frameWindow, 'postMessage');

    emitMessage(
      childReady('static-child-nonce'),
      'https://runtime.test',
      frameWindow
    );
    expect(postMessage).not.toHaveBeenCalled();
    expect(controller.snapshot.phase).toBe('connecting');
  });

  it.each([
    ['unauthorized', 'unauthorized'],
    ['network_blocked', 'network_blocked'],
  ] as const)(
    'accepts only a generation-bound %s operation failure from the configured child',
    (code, phase) => {
      const childNonce = 'child-operation-nonce';
      render(
        'https://runtime.test/path',
        'streaming',
        true,
        customLangGraphTarget()
      );
      const frameWindow = controller.frameRef.current!.contentWindow!;
      emitMessage(childReady(childNonce), 'https://runtime.test', frameWindow);
      emitMessage(
        configured(childNonce, 0),
        'https://runtime.test',
        frameWindow
      );

      const failure = {
        type: 'tplane:runtime-operation-failed',
        version: RUNTIME_CONFIGURATION_VERSION,
        nonce: childNonce,
        generation: 0,
        code,
      } as const;
      emitMessage(
        { ...failure, generation: 1 },
        'https://runtime.test',
        frameWindow
      );
      emitMessage(failure, 'https://sibling.test', frameWindow);
      emitMessage(failure, 'https://runtime.test', window);
      expect(controller.snapshot.phase).toBe('connecting');

      emitMessage(failure, 'https://runtime.test', frameWindow);
      expect(controller.snapshot).toMatchObject({
        phase,
        errorCode: code,
        targetGeneration: 0,
      });
      expect(onActivity).toHaveBeenLastCalledWith(
        expect.objectContaining({
          capability: 'streaming',
          runtime: {
            adapter: 'langgraph',
            targetKind: 'langsmith',
            protocolVersion: RUNTIME_CONFIGURATION_VERSION,
            configurationGeneration: 0,
            phase,
            reasonCode: code,
          },
        })
      );
      expect(JSON.stringify(onActivity.mock.calls)).not.toContain(
        'test-key-redact-me'
      );
      expect(JSON.stringify(onActivity.mock.calls)).not.toContain(
        'api.example.test'
      );
    }
  );

  it('maps a bounded configuration timeout and strict failure to incompatible_bridge without clearing the target', () => {
    const childNonce = 'child-timeout-nonce';
    render(
      'https://runtime.test/path',
      'streaming',
      true,
      customLangGraphTarget()
    );
    const frameWindow = controller.frameRef.current!.contentWindow!;
    const postMessage = vi.spyOn(frameWindow, 'postMessage');
    emitMessage(childReady(childNonce), 'https://runtime.test', frameWindow);

    act(() => vi.advanceTimersByTime(5_000));
    expect(controller.snapshot).toMatchObject({
      phase: 'incompatible_bridge',
      errorCode: 'incompatible_bridge',
      targetGeneration: 0,
    });
    expect(controller.runtimeContext).toEqual({
      adapter: 'langgraph',
      targetKind: 'langsmith',
      protocolVersion: RUNTIME_CONFIGURATION_VERSION,
      configurationGeneration: 0,
      phase: 'incompatible_bridge',
      reasonCode: 'incompatible_bridge',
    });

    emitMessage(configured(childNonce, 0), 'https://runtime.test', frameWindow);
    expect(controller.snapshot.phase).toBe('incompatible_bridge');

    const priorConfigurationCount = postMessage.mock.calls.length;
    act(() => controller.recheck());
    expect(controller.snapshot).toMatchObject({
      phase: 'configuring',
      targetGeneration: 0,
    });
    expect(postMessage).toHaveBeenCalledTimes(priorConfigurationCount + 1);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    act(() => vi.advanceTimersByTime(5_000));
    expect(controller.snapshot.phase).toBe('incompatible_bridge');
  });

  it('times out a compatible frame that never loads or announces child-ready', () => {
    render(
      'https://runtime.test/path',
      'streaming',
      true,
      customLangGraphTarget()
    );
    expect(controller.snapshot.phase).toBe('configuring');
    expect(vi.getTimerCount()).toBe(1);

    act(() => vi.advanceTimersByTime(5_000));
    expect(controller.snapshot).toMatchObject({
      phase: 'incompatible_bridge',
      errorCode: 'incompatible_bridge',
      targetGeneration: 0,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the fail-closed deadline through StrictMode layout-effect replay', () => {
    act(() => {
      root.render(
        <React.StrictMode>
          <Harness
            runtimeUrl="https://runtime.test/path"
            capability="streaming"
            effectiveTarget={customLangGraphTarget()}
            onActivity={onActivity}
            onTerminalTransition={onTerminalTransition}
          />
        </React.StrictMode>
      );
    });
    expect(controller.snapshot.phase).toBe('configuring');
    expect(vi.getTimerCount()).toBe(1);

    act(() => vi.advanceTimersByTime(5_000));
    expect(controller.snapshot).toMatchObject({
      phase: 'incompatible_bridge',
      errorCode: 'incompatible_bridge',
      targetGeneration: 0,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores late child-ready after a no-session terminal timeout until explicit retry', () => {
    render(
      'https://runtime.test/path',
      'streaming',
      true,
      customLangGraphTarget()
    );
    const frameWindow = controller.frameRef.current!.contentWindow!;
    const postMessage = vi.spyOn(frameWindow, 'postMessage');
    act(() => vi.advanceTimersByTime(5_000));

    emitMessage(
      childReady('late-child-nonce'),
      'https://runtime.test',
      frameWindow
    );
    expect(controller.snapshot.phase).toBe('incompatible_bridge');
    expect(postMessage).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    act(() => controller.recheck());
    expect(controller.snapshot.phase).toBe('configuring');
    expect(postMessage).not.toHaveBeenCalled();
    emitMessage(
      childReady('retry-child-nonce'),
      'https://runtime.test',
      frameWindow
    );
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        nonce: 'retry-child-nonce',
        generation: 0,
      }),
      'https://runtime.test'
    );
  });

  it('ignores a late frame load after a no-session terminal timeout until explicit retry', () => {
    render(
      'https://runtime.test/path',
      'streaming',
      true,
      customLangGraphTarget()
    );
    const frameWindow = controller.frameRef.current!.contentWindow!;
    const postMessage = vi.spyOn(frameWindow, 'postMessage');
    act(() => vi.advanceTimersByTime(5_000));

    act(() => controller.onFrameLoad());
    expect(controller.snapshot.phase).toBe('incompatible_bridge');
    expect(postMessage).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    act(() => controller.reload());
    expect(controller.snapshot).toMatchObject({
      phase: 'reloading',
      frameGeneration: 1,
      targetGeneration: 0,
    });
    expect(vi.getTimerCount()).toBe(1);
  });

  it('does not let duplicate child-ready retries extend the frame configuration deadline', () => {
    const childNonce = 'bounded-child-nonce';
    render(
      'https://runtime.test/path',
      'streaming',
      true,
      customLangGraphTarget()
    );
    const frameWindow = controller.frameRef.current!.contentWindow!;
    act(() => vi.advanceTimersByTime(4_999));
    emitMessage(childReady(childNonce), 'https://runtime.test', frameWindow);
    emitMessage(childReady(childNonce), 'https://runtime.test', frameWindow);
    act(() => vi.advanceTimersByTime(1));

    expect(controller.snapshot.phase).toBe('incompatible_bridge');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('maps a strict configuration failure and invalidates every old-generation response after replacement', () => {
    const oldNonce = 'old-child-nonce';
    const nextNonce = 'next-child-nonce';
    render(
      'https://runtime.test/path',
      'streaming',
      true,
      customLangGraphTarget()
    );
    const frameWindow = controller.frameRef.current!.contentWindow!;
    emitMessage(childReady(oldNonce), 'https://runtime.test', frameWindow);
    emitMessage(
      {
        type: 'tplane:runtime-configuration-failed',
        version: RUNTIME_CONFIGURATION_VERSION,
        nonce: oldNonce,
        generation: 0,
        code: 'incompatible_bridge',
      },
      'https://runtime.test',
      frameWindow
    );
    expect(controller.snapshot.phase).toBe('incompatible_bridge');

    render(
      'https://runtime.test/path',
      'streaming',
      true,
      customLangGraphTarget(
        'https://api.example.test/langgraph',
        'replacement-key'
      )
    );
    expect(controller.snapshot).toMatchObject({
      phase: 'configuring',
      targetGeneration: 1,
      frameGeneration: 1,
    });

    emitMessage(
      {
        type: 'tplane:runtime-operation-failed',
        version: RUNTIME_CONFIGURATION_VERSION,
        nonce: oldNonce,
        generation: 0,
        code: 'unauthorized',
      },
      'https://runtime.test',
      frameWindow
    );
    expect(controller.snapshot.phase).toBe('configuring');

    emitMessage(childReady(nextNonce), 'https://runtime.test', frameWindow);
    emitMessage(configured(nextNonce, 1), 'https://runtime.test', frameWindow);
    emitMessage(
      {
        type: 'tplane:runtime-operation-failed',
        version: RUNTIME_CONFIGURATION_VERSION,
        nonce: oldNonce,
        generation: 0,
        code: 'network_blocked',
      },
      'https://runtime.test',
      frameWindow
    );
    expect(controller.snapshot.phase).toBe('connecting');
  });

  it('cancels an active health check before replacing the target generation', () => {
    const childNonce = 'health-child-nonce';
    render(
      'https://runtime.test/path',
      'streaming',
      true,
      customLangGraphTarget()
    );
    const frameWindow = controller.frameRef.current!.contentWindow!;
    emitMessage(childReady(childNonce), 'https://runtime.test', frameWindow);
    emitMessage(configured(childNonce, 0), 'https://runtime.test', frameWindow);
    act(() => controller.onFrameLoad());
    expect(controller.snapshot.activeNonce).toBe(firstNonce);
    expect(vi.getTimerCount()).toBe(1);

    render(
      'https://runtime.test/path',
      'streaming',
      true,
      customLangGraphTarget(
        'https://api.example.test/langgraph',
        'replacement-key'
      )
    );
    expect(controller.snapshot).toMatchObject({
      phase: 'configuring',
      activeNonce: null,
      targetGeneration: 1,
    });
    expect(vi.getTimerCount()).toBe(1);

    emitMessage(runtimeReady(firstNonce), 'https://runtime.test', frameWindow);
    expect(controller.snapshot.phase).toBe('configuring');
  });

  it('keeps reload and recheck bound to the current target generation', () => {
    const childNonce = 'reload-child-nonce';
    render(
      'https://runtime.test/path',
      'streaming',
      true,
      customLangGraphTarget()
    );
    const frameWindow = controller.frameRef.current!.contentWindow!;
    emitMessage(childReady(childNonce), 'https://runtime.test', frameWindow);
    emitMessage(configured(childNonce, 0), 'https://runtime.test', frameWindow);

    act(() => controller.reload());
    expect(controller.snapshot).toMatchObject({
      phase: 'reloading',
      targetGeneration: 0,
      frameGeneration: 1,
    });
    emitMessage(
      {
        type: 'tplane:runtime-operation-failed',
        version: RUNTIME_CONFIGURATION_VERSION,
        nonce: childNonce,
        generation: 0,
        code: 'unauthorized',
      },
      'https://runtime.test',
      frameWindow
    );
    expect(controller.snapshot.phase).toBe('reloading');

    act(() => controller.onFrameLoad());
    expect(controller.snapshot).toMatchObject({
      phase: 'configuring',
      targetGeneration: 0,
      frameGeneration: 1,
    });
    act(() => controller.recheck());
    expect(controller.snapshot.targetGeneration).toBe(0);
  });

  it('accepts ready only from the mounted frame, exact origin, valid shape, and current nonce', () => {
    randomUUID
      .mockReturnValueOnce(firstNonce)
      .mockReturnValueOnce(firstEventId)
      .mockReturnValueOnce(secondEventId);
    render('https://runtime.test/path');
    const frameWindow = controller.frameRef.current!.contentWindow!;
    act(() => controller.onFrameLoad());

    emitMessage(runtimeReady(firstNonce), 'https://runtime.test', window);
    emitMessage(runtimeReady(firstNonce), 'https://sibling.test', frameWindow);
    emitMessage(
      { ...runtimeReady(firstNonce), version: 2 },
      'https://runtime.test',
      frameWindow
    );
    emitMessage(
      { ...runtimeReady(firstNonce), extra: true },
      'https://runtime.test',
      frameWindow
    );
    emitMessage(runtimeReady('stale'), 'https://runtime.test', frameWindow);
    expect(controller.snapshot.phase).toBe('connecting');

    vi.setSystemTime(new Date('2026-08-31T17:00:00.250Z'));
    emitMessage(runtimeReady(firstNonce), 'https://runtime.test', frameWindow);

    expect(controller.snapshot).toMatchObject({
      phase: 'ready',
      activeNonce: null,
      checkedAt: Date.parse('2026-08-31T17:00:00.250Z'),
      lastReadyAt: Date.parse('2026-08-31T17:00:00.250Z'),
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(onTerminalTransition).toHaveBeenCalledTimes(1);
    expect(onTerminalTransition).toHaveBeenCalledWith({
      capability: 'streaming',
      fromState: 'connecting',
      toState: 'ready',
      elapsedMs: 250,
    });
    expect(onActivity.mock.calls.map(([event]) => event.kind)).toEqual([
      'runtime_check_requested',
      'runtime_ready',
    ]);
  });

  it('accepts only the allowlisted current runtime error response', () => {
    randomUUID
      .mockReturnValueOnce(firstNonce)
      .mockReturnValueOnce(firstEventId)
      .mockReturnValueOnce(secondEventId);
    render('https://runtime.test/path');
    const frameWindow = controller.frameRef.current!.contentWindow!;
    act(() => controller.onFrameLoad());

    emitMessage(
      { ...runtimeError(firstNonce), code: 'raw_failure' },
      'https://runtime.test',
      frameWindow
    );
    expect(controller.snapshot.phase).toBe('connecting');

    vi.setSystemTime(new Date('2026-08-31T17:00:00.300Z'));
    emitMessage(runtimeError(firstNonce), 'https://runtime.test', frameWindow);

    expect(controller.snapshot).toMatchObject({
      phase: 'error',
      errorCode: 'bootstrap_failed',
      activeNonce: null,
    });
    expect(onTerminalTransition).toHaveBeenCalledWith({
      capability: 'streaming',
      fromState: 'connecting',
      toState: 'error',
      elapsedMs: 300,
      reasonCode: 'bootstrap_failed',
    });
    expect(onActivity.mock.calls.map(([event]) => event.kind)).toEqual([
      'runtime_check_requested',
      'runtime_initialization_error',
    ]);
  });

  it('becomes unresponsive after five seconds', () => {
    randomUUID
      .mockReturnValueOnce(firstNonce)
      .mockReturnValueOnce(firstEventId)
      .mockReturnValueOnce(secondEventId);
    render('https://runtime.test/path');
    act(() => controller.onFrameLoad());

    act(() => vi.advanceTimersByTime(4_999));
    expect(controller.snapshot.phase).toBe('connecting');
    act(() => vi.advanceTimersByTime(1));

    expect(controller.snapshot).toMatchObject({
      phase: 'unresponsive',
      activeNonce: null,
      checkedAt: Date.parse('2026-08-31T17:00:05.000Z'),
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(onTerminalTransition).toHaveBeenCalledWith({
      capability: 'streaming',
      fromState: 'connecting',
      toState: 'unresponsive',
      elapsedMs: 5_000,
    });
    expect(onActivity.mock.calls.map(([event]) => event.kind)).toEqual([
      'runtime_check_requested',
      'runtime_unresponsive',
    ]);
  });

  it('recheck cancels the prior timer and nonce before starting one new check', () => {
    randomUUID
      .mockReturnValueOnce(firstNonce)
      .mockReturnValueOnce(firstEventId)
      .mockReturnValueOnce(secondNonce)
      .mockReturnValueOnce(secondEventId);
    render('https://runtime.test/path');
    const frameWindow = controller.frameRef.current!.contentWindow!;
    const postMessage = vi.spyOn(frameWindow, 'postMessage');
    act(() => controller.onFrameLoad());
    act(() => controller.recheck());

    expect(controller.snapshot).toMatchObject({
      phase: 'checking',
      activeNonce: secondNonce,
    });
    expect(vi.getTimerCount()).toBe(1);
    expect(postMessage).toHaveBeenCalledTimes(2);

    emitMessage(runtimeReady(firstNonce), 'https://runtime.test', frameWindow);
    expect(controller.snapshot.phase).toBe('checking');
    emitMessage(runtimeReady(secondNonce), 'https://runtime.test', frameWindow);
    expect(controller.snapshot.phase).toBe('ready');
  });

  it('reload cancels active work, increments only frame generation, and checks the new load while reloading', () => {
    randomUUID
      .mockReturnValueOnce(firstNonce)
      .mockReturnValueOnce(firstEventId)
      .mockReturnValueOnce(secondEventId)
      .mockReturnValueOnce(secondNonce)
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000005');
    render('https://runtime.test/path');
    act(() => controller.onFrameLoad());
    const routeGeneration = controller.snapshot.routeGeneration;

    act(() => controller.reload());

    expect(controller.snapshot).toMatchObject({
      phase: 'reloading',
      activeNonce: null,
      frameGeneration: 1,
      routeGeneration,
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(onActivity.mock.calls.map(([event]) => event.kind)).toEqual([
      'runtime_check_requested',
      'runtime_reload_requested',
    ]);

    act(() => controller.onFrameLoad());
    expect(controller.snapshot).toMatchObject({
      phase: 'reloading',
      activeNonce: secondNonce,
      frameGeneration: 1,
      routeGeneration,
    });
    expect(vi.getTimerCount()).toBe(1);
  });

  it('preserves recovery origin through recheck and reports one recovered transition', () => {
    randomUUID
      .mockReturnValueOnce(firstNonce)
      .mockReturnValueOnce(firstEventId)
      .mockReturnValueOnce(secondEventId)
      .mockReturnValueOnce(secondNonce)
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000005')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000006');
    render('https://runtime.test/path');
    const frameWindow = controller.frameRef.current!.contentWindow!;
    act(() => controller.onFrameLoad());
    act(() => vi.advanceTimersByTime(5_000));
    act(() => controller.recheck());
    vi.setSystemTime(new Date('2026-08-31T17:00:05.100Z'));
    emitMessage(runtimeReady(secondNonce), 'https://runtime.test', frameWindow);

    expect(onTerminalTransition).toHaveBeenCalledTimes(2);
    expect(onTerminalTransition).toHaveBeenLastCalledWith({
      capability: 'streaming',
      fromState: 'unresponsive',
      toState: 'ready',
      elapsedMs: 100,
      transition: 'recovered',
    });
    expect(onActivity.mock.calls.map(([event]) => event.kind)).toEqual([
      'runtime_check_requested',
      'runtime_unresponsive',
      'runtime_check_requested',
      'runtime_recovered',
    ]);
  });

  it('invalidates the old route context before accepting messages or timers', () => {
    randomUUID
      .mockReturnValueOnce(firstNonce)
      .mockReturnValueOnce(firstEventId)
      .mockReturnValueOnce(secondNonce)
      .mockReturnValueOnce(secondEventId);
    render('https://runtime.test/old', 'streaming');
    const frameWindow = controller.frameRef.current!.contentWindow!;
    act(() => controller.onFrameLoad());

    render('https://next.runtime.test/new', 'persistence');

    expect(controller.snapshot).toMatchObject({
      phase: 'connecting',
      capability: 'persistence',
      activeNonce: null,
      routeGeneration: 1,
    });
    expect(controller.validatedRuntimeUrl).toBe(
      'https://next.runtime.test/new'
    );
    expect(vi.getTimerCount()).toBe(0);
    emitMessage(runtimeReady(firstNonce), 'https://runtime.test', frameWindow);
    expect(controller.snapshot.phase).toBe('connecting');

    act(() => controller.onFrameLoad());
    expect(controller.snapshot.activeNonce).toBe(secondNonce);
    emitMessage(runtimeReady(secondNonce), 'https://runtime.test', frameWindow);
    expect(controller.snapshot.phase).toBe('connecting');
    emitMessage(
      runtimeReady(secondNonce),
      'https://next.runtime.test',
      frameWindow
    );
    expect(controller.snapshot.phase).toBe('ready');
  });

  it('keeps the operational route ready when only credentials, query, and hash change', () => {
    randomUUID
      .mockReturnValueOnce(firstNonce)
      .mockReturnValueOnce(firstEventId)
      .mockReturnValueOnce(secondEventId)
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000005');
    render('https://runtime.test/path?token=a#one');
    const frameWindow = controller.frameRef.current!.contentWindow!;
    act(() => controller.onFrameLoad());
    emitMessage(runtimeReady(firstNonce), 'https://runtime.test', frameWindow);
    const ready = controller.snapshot;
    const activityCount = onActivity.mock.calls.length;
    const terminalCount = onTerminalTransition.mock.calls.length;

    const latestConfiguredUrl = 'https://user:pw@runtime.test/path?token=b#two';
    render(latestConfiguredUrl);

    expect(controller.validatedRuntimeUrl).toBe('https://runtime.test/path');
    expect(controller.snapshot).toMatchObject({
      phase: 'ready',
      routeGeneration: ready.routeGeneration,
      frameGeneration: ready.frameGeneration,
      activeNonce: null,
      checkedAt: ready.checkedAt,
      lastReadyAt: ready.lastReadyAt,
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(randomUUID).toHaveBeenCalledTimes(3);
    expect(onActivity).toHaveBeenCalledTimes(activityCount);
    expect(onTerminalTransition).toHaveBeenCalledTimes(terminalCount);

    const open = vi.spyOn(window, 'open').mockReturnValue(window);
    expect(controller.open()).toBe('requested');
    expect(open).toHaveBeenCalledWith(
      latestConfiguredUrl,
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('does not publish future route context from a suspended render', () => {
    randomUUID
      .mockReturnValueOnce(firstNonce)
      .mockReturnValueOnce(firstEventId)
      .mockReturnValueOnce(secondEventId);
    const suspension = new Promise<never>(() => undefined);
    const futureOnActivity = vi.fn<(event: RuntimeActivityInput) => void>();
    const futureOnTerminalTransition =
      vi.fn<(event: RuntimeTerminalTransition) => void>();
    const renderConcurrent = (
      runtimeUrl: string,
      capability: string,
      suspend: boolean,
      activity = onActivity,
      terminalTransition = onTerminalTransition
    ) => (
      <Suspense fallback={<div>Suspended</div>}>
        <ConcurrentHarness
          runtimeUrl={runtimeUrl}
          capability={capability}
          effectiveTarget={noneTarget}
          onActivity={activity}
          onTerminalTransition={terminalTransition}
          suspend={suspend}
          suspension={suspension}
        />
      </Suspense>
    );

    act(() => {
      root.render(
        renderConcurrent('https://runtime.test/committed', 'streaming', false)
      );
    });
    const committedController = committedConcurrentController;
    const frameWindow = committedController.frameRef.current!.contentWindow!;
    const postMessage = vi.spyOn(frameWindow, 'postMessage');

    act(() => {
      startTransition(() => {
        root.render(
          renderConcurrent(
            'https://runtime.test/future',
            'persistence',
            true,
            futureOnActivity,
            futureOnTerminalTransition
          )
        );
      });
    });
    expect(container.querySelector('iframe')?.contentWindow).toBe(frameWindow);

    act(() => committedController.onFrameLoad());
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'tplane:runtime-check',
        version: RUNTIME_BRIDGE_VERSION,
        nonce: firstNonce,
        capability: 'streaming',
      },
      'https://runtime.test'
    );
    expect(onActivity.mock.calls.map(([event]) => event.kind)).toEqual([
      'runtime_check_requested',
    ]);
    expect(futureOnActivity).not.toHaveBeenCalled();
    emitMessage(runtimeReady(firstNonce), 'https://runtime.test', frameWindow);
    expect(onActivity.mock.calls.map(([event]) => event.kind)).toEqual([
      'runtime_check_requested',
      'runtime_ready',
    ]);
    expect(onTerminalTransition).toHaveBeenCalledTimes(1);
    expect(futureOnActivity).not.toHaveBeenCalled();
    expect(futureOnTerminalTransition).not.toHaveBeenCalled();

    act(() => {
      root.render(
        renderConcurrent('https://runtime.test/committed', 'streaming', false)
      );
    });
    expect(committedConcurrentController.snapshot).toMatchObject({
      phase: 'ready',
      capability: 'streaming',
      routeGeneration: 0,
      frameGeneration: 0,
    });
    expect(onTerminalTransition).toHaveBeenCalledTimes(1);
    expect(futureOnActivity).not.toHaveBeenCalled();
    expect(futureOnTerminalTransition).not.toHaveBeenCalled();
  });

  it('reports each committed invalid raw input once without exposing it', () => {
    render('invalid-secret-a');
    const firstRouteGeneration = controller.snapshot.routeGeneration;
    expect(onTerminalTransition).toHaveBeenCalledTimes(1);
    expect(onActivity).toHaveBeenCalledTimes(1);

    render('invalid-secret-a');
    expect(controller.snapshot.routeGeneration).toBe(firstRouteGeneration);
    expect(onTerminalTransition).toHaveBeenCalledTimes(1);
    expect(onActivity).toHaveBeenCalledTimes(1);

    render('invalid-secret-b');
    expect(controller.snapshot).toMatchObject({
      phase: 'invalid_configuration',
      routeGeneration: firstRouteGeneration + 1,
    });
    expect(onTerminalTransition).toHaveBeenCalledTimes(2);
    expect(onActivity).toHaveBeenCalledTimes(2);
    expect(
      JSON.stringify({
        snapshot: controller.snapshot,
        activity: onActivity.mock.calls,
        terminal: onTerminalTransition.mock.calls,
      })
    ).not.toMatch(/invalid-secret-[ab]/);
  });

  it('installs one message listener and invalidates work on unmount', () => {
    const addEventListener = vi.spyOn(window, 'addEventListener');
    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    render('https://runtime.test/path');
    act(() => controller.onFrameLoad());

    expect(
      addEventListener.mock.calls.filter(([type]) => type === 'message')
    ).toHaveLength(1);
    act(() => root.unmount());

    expect(vi.getTimerCount()).toBe(0);
    expect(
      removeEventListener.mock.calls.filter(([type]) => type === 'message')
    ).toHaveLength(1);
  });

  it('reports Open as requested for any non-throwing call', () => {
    randomUUID
      .mockReturnValueOnce(firstEventId)
      .mockReturnValueOnce(secondEventId)
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000005');
    const configuredUrl =
      'https://runtime.test/path?existing=private#original-fragment';
    render(configuredUrl);
    const open = vi
      .spyOn(window, 'open')
      .mockReturnValueOnce(window)
      .mockReturnValueOnce(null)
      .mockImplementationOnce(() => {
        throw new Error('blocked');
      });

    expect(controller.open()).toBe('requested');
    expect(controller.open()).toBe('requested');
    expect(controller.open()).toBe('failed');

    expect(open).toHaveBeenNthCalledWith(
      1,
      configuredUrl,
      '_blank',
      'noopener,noreferrer'
    );
    expect(onActivity.mock.calls.map(([event]) => event.kind)).toEqual([
      'runtime_open_requested',
      'runtime_open_requested',
      'runtime_open_requested',
    ]);
    expect(JSON.stringify(onActivity.mock.calls)).not.toContain(configuredUrl);
  });

  it.each(['missing frame window', 'postMessage failure'])(
    'settles safely without a pending check after %s',
    (failure) => {
      randomUUID
        .mockReturnValueOnce(firstNonce)
        .mockReturnValueOnce(firstEventId)
        .mockReturnValueOnce(secondEventId);
      render(
        'https://runtime.test/path',
        'streaming',
        failure !== 'missing frame window'
      );
      if (failure === 'postMessage failure') {
        vi.spyOn(
          controller.frameRef.current!.contentWindow!,
          'postMessage'
        ).mockImplementation(() => {
          throw new Error('cross-origin failure');
        });
      }

      act(() => controller.onFrameLoad());

      expect(controller.snapshot).toMatchObject({
        phase: 'unresponsive',
        activeNonce: null,
      });
      expect(vi.getTimerCount()).toBe(0);
      expect(onActivity.mock.calls.map(([event]) => event.kind)).toEqual([
        'runtime_check_requested',
        'runtime_unresponsive',
      ]);
    }
  );
});
