'use client';

import { useEffect } from 'react';
import type { AgentStatus } from '@threadplane/core';
import {
  devtoolsAvailable,
  dispatchDevtoolsReport,
  newAgentId,
  now,
  optedOut,
  type DevtoolsAdapter,
} from '../devtools/protocol.js';

declare const process: { readonly env: { readonly NODE_ENV?: string } };

/** What the reporter reads from a session: the core snapshot fields both adapters share. */
export interface AgentDevtoolsSource {
  getSnapshot(): {
    readonly status: AgentStatus;
    readonly messages: readonly unknown[];
    readonly toolCalls: readonly unknown[];
    readonly error?: unknown;
  };
  subscribe(notify: () => void): () => void;
}

/** Which adapter's signal vocabulary the reports use. */
export interface AgentDevtoolsOptions {
  readonly adapter: DevtoolsAdapter;
}

type Snapshot = ReturnType<AgentDevtoolsSource['getSnapshot']>;

/**
 * The snapshot fields that map onto a signal both the LangGraph and the AG-UI
 * vocabularies name, in report order. `plan` has no signal in either.
 */
const SIGNALS = ['status', 'messages', 'toolCalls', 'error'] as const;

/**
 * The signals one snapshot change wrote: the fields whose value is not the
 * one the previous snapshot held. Sessions keep unchanged fields identical
 * between snapshots, so identity is the change.
 *
 * @internal Exported for tests.
 */
export function changedSignals(previous: Snapshot, next: Snapshot): string[] {
  return SIGNALS.filter((name) => !Object.is(previous[name], next[name]));
}

/**
 * The label for a change no protocol event is visible for: the core snapshot
 * hides the adapter's events, so a change is named by the run edge it crosses.
 *
 * @internal Exported for tests.
 */
export function snapshotEventType(previous: Snapshot, next: Snapshot): string {
  if (previous.status !== 'running' && next.status === 'running')
    return 'run:start';
  if (previous.status === 'running' && next.status !== 'running')
    return 'run:end';
  return 'snapshot';
}

function useDevelopmentAgentDevtools(
  session: AgentDevtoolsSource | null | undefined,
  options: AgentDevtoolsOptions
): void {
  const adapter = options.adapter;
  useEffect(() => {
    if (!session || !devtoolsAvailable()) return;
    if (adapter !== 'langgraph' && adapter !== 'ag-ui') return;
    const agent = newAgentId();
    let seq = 0;
    let previous = session.getSnapshot();
    return session.subscribe(() => {
      let next: Snapshot;
      try {
        next = session.getSnapshot();
      } catch {
        return;
      }
      const wrote = changedSignals(previous, next);
      const eventType = snapshotEventType(previous, next);
      previous = next;
      // A change that wrote no reported signal is not worth a report.
      if (wrote.length === 0 || optedOut()) return;
      seq += 1;
      dispatchDevtoolsReport({
        v: 1,
        agent,
        adapter,
        seq,
        eventType,
        wrote,
        tMs: now(),
      });
    });
  }, [session, adapter]);
}

function useProductionAgentDevtools(): void {
  // Production builds report nothing.
}

/**
 * Reports a session's snapshot changes to the Threadplane DevTools extension
 * in development, as the Angular adapters do: each change dispatches a
 * `threadplane:devtools` `CustomEvent` on `window` whose detail is
 * `{ v, agent, adapter, seq, eventType, wrote, tMs }`, naming which of
 * `status`, `messages`, `toolCalls` and `error` changed, never their values.
 * `eventType` is `run:start`, `run:end` or `snapshot`.
 *
 * Production builds (`process.env.NODE_ENV === 'production'`) replace it with
 * a no-op. Setting `window.__THREADPLANE_DEVTOOLS_DISABLED__ = true` turns
 * reporting off in development.
 */
export const useAgentDevtools: (
  session: AgentDevtoolsSource | null | undefined,
  options: AgentDevtoolsOptions
) => void =
  process.env.NODE_ENV !== 'production'
    ? useDevelopmentAgentDevtools
    : useProductionAgentDevtools;
