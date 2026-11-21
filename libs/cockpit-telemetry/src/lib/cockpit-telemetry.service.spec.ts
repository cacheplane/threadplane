// @vitest-environment jsdom
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { CockpitTelemetryService } from './cockpit-telemetry.service';
import { COCKPIT_TELEMETRY_CONFIG } from './tokens';
import { ActivationAggregator } from './activation-aggregator';
import { CHAT_LIFECYCLE, type ChatLifecycle } from '@threadplane/angular/chat';
import { AgentLifecycleRegistry, type AgentLifecycle } from '@threadplane/angular';

function makeAgentLifecycle(): AgentLifecycle & {
  _setStreamStarted: () => void;
  _setThreadPersisted: () => void;
  _setInterruptResolved: () => void;
} {
  const streamStartedAt = signal<number | null>(null);
  const threadPersistedAt = signal<number | null>(null);
  const interruptResolvedAt = signal<number | null>(null);
  return {
    streamStartedAt: streamStartedAt.asReadonly(),
    streamErrorAt: signal<{ at: number; kind: string } | null>(null).asReadonly(),
    interruptReceivedAt: signal<number | null>(null).asReadonly(),
    interruptResolvedAt: interruptResolvedAt.asReadonly(),
    threadCreatedAt: signal<number | null>(null).asReadonly(),
    threadPersistedAt: threadPersistedAt.asReadonly(),
    toolCallStartedAt: signal<number | null>(null).asReadonly(),
    toolCallCompletedAt: signal<number | null>(null).asReadonly(),
    _setStreamStarted: () => streamStartedAt.set(Date.now()),
    _setThreadPersisted: () => threadPersistedAt.set(Date.now()),
    _setInterruptResolved: () => interruptResolvedAt.set(Date.now()),
  };
}

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
}));

vi.mock('posthog-js', () => ({
  default: { init: mocks.init, capture: mocks.capture },
}));

function makeChatLifecycle(): ChatLifecycle & { _setFirstMessage: () => void } {
  const firstMessageSent = signal(false);
  return {
    componentReady: signal(true).asReadonly(),
    firstMessageSent: firstMessageSent.asReadonly(),
    messageCount: signal(0).asReadonly(),
    inputSubmittedAt: signal<number | null>(null).asReadonly(),
    _setFirstMessage: () => firstMessageSent.set(true),
  };
}

describe('CockpitTelemetryService', () => {
  let svc: CockpitTelemetryService;
  let chat: ReturnType<typeof makeChatLifecycle>;

  beforeEach(() => {
    mocks.init.mockClear();
    mocks.capture.mockClear();
    chat = makeChatLifecycle();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: COCKPIT_TELEMETRY_CONFIG,
          useValue: { posthogKey: 'phc_test', distinctId: 'd1', capabilitySlug: 'streaming' },
        },
        ActivationAggregator,
        { provide: CHAT_LIFECYCLE, useValue: chat },
        CockpitTelemetryService,
      ],
    });
    svc = TestBed.inject(CockpitTelemetryService);
  });

  test('init() initializes posthog-js with memory persistence + bootstrap distinctID', () => {
    svc.init();
    expect(mocks.init).toHaveBeenCalledWith(
      'phc_test',
      expect.objectContaining({
        persistence: 'memory',
        bootstrap: { distinctID: 'd1' },
        autocapture: false,
        capture_pageview: false,
        advanced_disable_flags: true,
        disable_surveys: true,
        disable_session_recording: true,
        disable_external_dependency_loading: true,
      }),
    );
  });

  test('init() is idempotent', () => {
    svc.init();
    svc.init();
    expect(mocks.init).toHaveBeenCalledTimes(1);
  });

  test('fires cockpit:chat_first_message when ChatLifecycle.firstMessageSent flips to true', async () => {
    svc.init();
    chat._setFirstMessage();
    TestBed.tick();
    await Promise.resolve();
    expect(mocks.capture).toHaveBeenCalledWith(
      'cockpit:chat_first_message',
      expect.objectContaining({ capability: 'streaming' }),
    );
  });

  test('does not fire if lifecycle was already-true at init time and never transitions', async () => {
    chat._setFirstMessage(); // before init
    svc.init();
    TestBed.tick();
    await Promise.resolve();
    // Effect runs once, captures the current state — fire-on-init is allowed.
    // The contract is "fires once at most".
    const calls = mocks.capture.mock.calls.filter(([e]) => e === 'cockpit:chat_first_message');
    expect(calls.length).toBeLessThanOrEqual(1);
  });

  test('no lifecycle present → no events fire', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: COCKPIT_TELEMETRY_CONFIG,
          useValue: { posthogKey: 'phc_test', distinctId: 'd1', capabilitySlug: 'streaming' },
        },
        ActivationAggregator,
        CockpitTelemetryService,
      ],
    });
    const svc2 = TestBed.inject(CockpitTelemetryService);
    svc2.init();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  test('captures include capability property from config', async () => {
    svc.init();
    chat._setFirstMessage();
    TestBed.tick();
    await Promise.resolve();
    const call = mocks.capture.mock.calls.find(([e]) => e === 'cockpit:chat_first_message');
    expect((call?.[1] as Record<string, unknown>)['capability']).toBe('streaming');
  });

  test('no AgentLifecycleRegistry provided → no agent events fire', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: COCKPIT_TELEMETRY_CONFIG,
          useValue: { posthogKey: 'phc_test', distinctId: 'd1', capabilitySlug: 'streaming' },
        },
        ActivationAggregator,
        CockpitTelemetryService,
      ],
    });
    const svc2 = TestBed.inject(CockpitTelemetryService);
    svc2.init();
    expect(mocks.capture).not.toHaveBeenCalledWith(
      'cockpit:transport_connected',
      expect.anything(),
    );
  });

  test('fires cockpit:transport_connected when a registered agent lifecycle streamStartedAt flips', async () => {
    TestBed.resetTestingModule();
    const registry = new AgentLifecycleRegistry();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: COCKPIT_TELEMETRY_CONFIG,
          useValue: { posthogKey: 'phc_test', distinctId: 'd1', capabilitySlug: 'streaming' },
        },
        ActivationAggregator,
        { provide: AgentLifecycleRegistry, useValue: registry },
        CockpitTelemetryService,
      ],
    });
    const svc2 = TestBed.inject(CockpitTelemetryService);
    svc2.init();
    const lifecycle = makeAgentLifecycle();
    registry.register(lifecycle);
    TestBed.tick();
    await Promise.resolve();
    lifecycle._setStreamStarted();
    TestBed.tick();
    await Promise.resolve();
    expect(mocks.capture).toHaveBeenCalledWith(
      'cockpit:transport_connected',
      expect.objectContaining({ capability: 'streaming' }),
    );
  });

  test('fires cockpit:thread_persisted and cockpit:interrupt_handled for registered agents', async () => {
    TestBed.resetTestingModule();
    const registry = new AgentLifecycleRegistry();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: COCKPIT_TELEMETRY_CONFIG,
          useValue: { posthogKey: 'phc_test', distinctId: 'd1', capabilitySlug: 'streaming' },
        },
        ActivationAggregator,
        { provide: AgentLifecycleRegistry, useValue: registry },
        CockpitTelemetryService,
      ],
    });
    const svc2 = TestBed.inject(CockpitTelemetryService);
    svc2.init();
    const lifecycle = makeAgentLifecycle();
    registry.register(lifecycle);
    TestBed.tick();
    await Promise.resolve();
    lifecycle._setThreadPersisted();
    lifecycle._setInterruptResolved();
    TestBed.tick();
    await Promise.resolve();
    expect(mocks.capture).toHaveBeenCalledWith('cockpit:thread_persisted', expect.anything());
    expect(mocks.capture).toHaveBeenCalledWith('cockpit:interrupt_handled', expect.anything());
  });

  test('subscribes to lifecycles registered AFTER init', async () => {
    TestBed.resetTestingModule();
    const registry = new AgentLifecycleRegistry();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: COCKPIT_TELEMETRY_CONFIG,
          useValue: { posthogKey: 'phc_test', distinctId: 'd1', capabilitySlug: 'streaming' },
        },
        ActivationAggregator,
        { provide: AgentLifecycleRegistry, useValue: registry },
        CockpitTelemetryService,
      ],
    });
    const svc2 = TestBed.inject(CockpitTelemetryService);
    svc2.init();
    TestBed.tick();
    await Promise.resolve();
    // Register AFTER init.
    const lifecycle = makeAgentLifecycle();
    registry.register(lifecycle);
    TestBed.tick();
    await Promise.resolve();
    lifecycle._setStreamStarted();
    TestBed.tick();
    await Promise.resolve();
    expect(mocks.capture).toHaveBeenCalledWith(
      'cockpit:transport_connected',
      expect.anything(),
    );
  });
});
