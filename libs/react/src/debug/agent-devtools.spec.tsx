import { cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDevtoolsOptions, AgentDevtoolsSource } from './index';
import { useAgentDevtools } from './index';

type Snapshot = ReturnType<AgentDevtoolsSource['getSnapshot']>;
type Window = typeof window & { __THREADPLANE_DEVTOOLS_DISABLED__?: unknown };

const LANGGRAPH = new Set([
  'status', 'values', 'messages', 'error', 'interrupt', 'interrupts', 'branch', 'history',
  'isThreadLoading', 'toolProgress', 'toolCalls', 'messageMetadata', 'subagents', 'queue', 'custom',
]);
const AG_UI = new Set([
  'messages', 'status', 'isLoading', 'error', 'toolCalls', 'state', 'interrupt',
  'customEvents', 'activities', 'interruptSession',
]);

/** The extension's signals-report grammar: exact keys and the adapter's vocabulary. */
function isSignalsReport(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const keys = ['v', 'agent', 'adapter', 'seq', 'eventType', 'wrote', 'tMs'];
  if (Reflect.ownKeys(value).length !== keys.length) return false;
  if (!keys.every((key) => Object.hasOwn(value, key))) return false;
  const report = value as Record<string, unknown>;
  const vocabulary = report['adapter'] === 'langgraph' ? LANGGRAPH : report['adapter'] === 'ag-ui' ? AG_UI : null;
  const wrote = report['wrote'] as unknown[];
  return (
    report['v'] === 1 &&
    vocabulary !== null &&
    typeof report['agent'] === 'string' &&
    (report['agent'] as string).length >= 1 &&
    (report['agent'] as string).length <= 64 &&
    Number.isSafeInteger(report['seq']) &&
    (report['seq'] as number) >= 1 &&
    typeof report['eventType'] === 'string' &&
    (report['eventType'] as string).length >= 1 &&
    (report['eventType'] as string).length <= 128 &&
    typeof report['tMs'] === 'number' &&
    (report['tMs'] as number) >= 0 &&
    Array.isArray(wrote) &&
    wrote.length >= 1 &&
    wrote.length <= 32 &&
    new Set(wrote).size === wrote.length &&
    wrote.every((name) => typeof name === 'string' && vocabulary.has(name))
  );
}

function fakeSession() {
  let snapshot: Snapshot = { status: 'idle', messages: [], toolCalls: [] };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    listeners,
    set(next: Partial<Snapshot>) {
      snapshot = { ...snapshot, ...next };
      for (const notify of [...listeners]) notify();
    },
  };
}

function Probe({ session, options }: { session: AgentDevtoolsSource | null; options: AgentDevtoolsOptions }) {
  useAgentDevtools(session, options);
  return null;
}

let reports: Record<string, unknown>[] = [];
const listen = (event: Event) => reports.push((event as CustomEvent<Record<string, unknown>>).detail);
beforeEach(() => {
  reports = [];
  window.addEventListener('threadplane:devtools', listen);
});
afterEach(() => {
  cleanup();
  window.removeEventListener('threadplane:devtools', listen);
  delete (window as Window).__THREADPLANE_DEVTOOLS_DISABLED__;
});

describe('useAgentDevtools', () => {
  it('reports which shared signals each snapshot change wrote, never their values', () => {
    const session = fakeSession();
    render(<Probe session={session} options={{ adapter: 'langgraph' }} />);
    expect(reports).toHaveLength(0);
    session.set({ status: 'running', messages: [{ secret: 'hello' }] });
    session.set({ toolCalls: [{ id: 'a' }] });
    session.set({ status: 'error', error: { message: 'boom' } });
    session.set({ plan: [] } as Partial<Snapshot>);
    expect(reports).toHaveLength(3);
    expect(reports.every(isSignalsReport)).toBe(true);
    expect(reports.map(({ eventType, wrote, seq }) => ({ eventType, wrote, seq }))).toEqual([
      { eventType: 'run:start', wrote: ['status', 'messages'], seq: 1 },
      { eventType: 'snapshot', wrote: ['toolCalls'], seq: 2 },
      { eventType: 'run:end', wrote: ['status', 'error'], seq: 3 },
    ]);
    expect(new Set(reports.map(({ agent }) => agent)).size).toBe(1);
    expect(JSON.stringify(reports)).not.toContain('hello');
    expect(JSON.stringify(reports)).not.toContain('boom');
  });

  it('uses the AG-UI vocabulary, a fresh agent per session, and unsubscribes on unmount', () => {
    const first = fakeSession();
    const second = fakeSession();
    const view = render(
      <StrictMode>
        <Probe session={first} options={{ adapter: 'ag-ui' }} />
        <Probe session={second} options={{ adapter: 'ag-ui' }} />
      </StrictMode>
    );
    first.set({ status: 'running' });
    second.set({ status: 'running' });
    expect(reports).toHaveLength(2);
    expect(reports.every(isSignalsReport)).toBe(true);
    expect(reports[0]['adapter']).toBe('ag-ui');
    expect(reports[0]['agent']).not.toBe(reports[1]['agent']);
    view.unmount();
    expect(first.listeners.size).toBe(0);
    first.set({ status: 'idle' });
    expect(reports).toHaveLength(2);
  });

  it('accepts no session and honours the opt-out at dispatch time', () => {
    render(<Probe session={null} options={{ adapter: 'langgraph' }} />);
    const session = fakeSession();
    render(<Probe session={session} options={{ adapter: 'langgraph' }} />);
    (window as Window).__THREADPLANE_DEVTOOLS_DISABLED__ = true;
    session.set({ status: 'running' });
    expect(reports).toHaveLength(0);
    delete (window as Window).__THREADPLANE_DEVTOOLS_DISABLED__;
    session.set({ status: 'idle' });
    expect(reports).toHaveLength(1);
  });
});

describe('useAgentDevtools in production', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  it('does not subscribe or report', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const production = await import('./agent-devtools');
    const session = fakeSession();
    function ProductionProbe() {
      production.useAgentDevtools(session, { adapter: 'langgraph' });
      return null;
    }
    render(<ProductionProbe />);
    expect(session.listeners.size).toBe(0);
    session.set({ status: 'running' });
    expect(reports).toHaveLength(0);
  });
});
