import { EventType as E } from '@ag-ui/client';
import type { DeepReadonly } from '@threadplane/core';
import { describe, expect, it, vi } from 'vitest';
import { copyData } from '../lib/internal/copy-data';
import {
  assertResumeEligible,
  captureResponses,
  claimDecision,
  observeDecision,
  settleDecision,
  type NativeDecision,
  type NativeResponse,
  type PauseId,
} from './decision';

const first = '00000000-0000-4000-8000-000000000001' as PauseId;
const second = '00000000-0000-4000-8000-000000000002' as PauseId;
const pause = () => {
  const event = {
    type: E.RUN_FINISHED as const,
    threadId: 'thread',
    runId: 'source',
    outcome: {
      type: 'interrupt' as const,
      interrupts: [
        { id: 'a', reason: 'Approve', responseSchema: { opaque: true } },
        { id: 'b', reason: 'Choose' },
      ],
    },
  };
  return copyData(event, true) as DeepReadonly<typeof event>;
};
const decision = (): NativeDecision =>
  Object.freeze({
    kind: 'native',
    id: first,
    sourceRunId: 'source',
    interrupts: pause().outcome.interrupts,
  });
const responses = () =>
  captureResponses([
    { interruptId: 'a', status: 'resolved', payload: null },
    { interruptId: 'b', status: 'cancelled' },
  ]);

describe('captured native response ownership', () => {
  it('reads only selected fields once, preserves null, and owns nested data without freezing callers', () => {
    const graph = { values: [1] };
    const reads = {
      id: vi.fn(() => 'a'),
      status: vi.fn(() => 'resolved' as const),
      payload: vi.fn(() => graph),
      metadata: vi.fn(() => ({ m: graph })),
    };
    const ignored = vi.fn((): never => {
      throw new Error('unused');
    });
    const input = [
      {
        get interruptId() {
          return reads.id();
        },
        get status() {
          return reads.status();
        },
        get payload() {
          return reads.payload();
        },
        get metadata() {
          return reads.metadata();
        },
        get state() {
          return ignored();
        },
      },
    ];
    const captured = captureResponses(input);
    graph.values.push(2);
    expect(captured).toEqual([
      {
        interruptId: 'a',
        status: 'resolved',
        payload: { values: [1] },
        metadata: { m: { values: [1] } },
      },
    ]);
    for (const read of Object.values(reads))
      expect(read).toHaveBeenCalledTimes(1);
    expect(ignored).not.toHaveBeenCalled();
    expect(Object.isFrozen(graph.values)).toBe(false);
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured[0].metadata?.['m'])).toBe(true);
    expect(responses()).toEqual([
      { interruptId: 'a', status: 'resolved', payload: null },
      { interruptId: 'b', status: 'cancelled' },
    ]);
    expect(
      captureResponses([
        { interruptId: 'a', status: 'resolved', payload: undefined },
      ])
    ).toEqual([{ interruptId: 'a', status: 'resolved' }]);
  });
  it.each([
    [{ interruptId: 'a' }],
    [{ id: 'a', status: 'resolved' }],
    [{ interruptId: 1, status: 'resolved' }],
    [{ interruptId: 'a', status: 'future' }],
    [{ interruptId: 'a', status: 'cancelled', payload: null }],
    [{ interruptId: 'a', status: 'resolved', payload: new Date() }],
    [{ interruptId: 'a', status: 'resolved', metadata: [] }],
    [{ interruptId: 'a', status: 'resolved', payload: () => true }],
  ])('rejects unsupported selected decision fields %j', (input) => {
    expect(() =>
      captureResponses(input as unknown as readonly NativeResponse[])
    ).toThrow();
  });
});

describe('pure decision correlation and settlement', () => {
  it('shares accepted owned batches and replaces repeated backend IDs with fresh generations', () => {
    const event = pause();
    const next = observeDecision(undefined, 'source', event, first);
    expect(next).toEqual(decision());
    if (next?.kind !== 'native') throw new Error('Missing native decision');
    expect(next.interrupts).toBe(event.outcome.interrupts);
    const repeated = observeDecision(next, 'source', event, second);
    expect(repeated).toMatchObject({ kind: 'native', id: second });
    expect(next.id).toBe(first);
    expect(Object.isFrozen(next)).toBe(true);
  });
  it('retains unsupported notice/duplicate evidence, without replacing a claimed native decision with a notice', () => {
    const notice = {
      type: E.CUSTOM as const,
      name: 'on_interrupt',
      value: '{literal}',
    };
    expect(observeDecision(undefined, 'source', notice)).toEqual({
      kind: 'unsupported',
      sourceRunId: 'source',
    });
    const current = claimDecision(decision(), responses(), 'resume');
    expect(observeDecision(current, 'resume', notice)).toBe(current);
    const event = pause();
    for (const interrupts of [
      [],
      [event.outcome.interrupts[0], event.outcome.interrupts[0]],
    ]) {
      // Empty arrays are synthetic defenses; the SDK rejects them on the wire.
      expect(
        observeDecision(
          undefined,
          'source',
          { ...event, outcome: { type: 'interrupt', interrupts } },
          first
        )
      ).toEqual({ kind: 'unsupported', sourceRunId: 'source' });
    }
  });
  it('requires current generation and local settlement, then exactly one response per observed ID', () => {
    const current = decision();
    expect(() =>
      assertResumeEligible(current, { id: 'source' }, first, 1)
    ).toThrow();
    expect(() =>
      assertResumeEligible(
        current,
        { id: 'source', outcome: 'paused' },
        second,
        1
      )
    ).toThrow();
    expect(
      assertResumeEligible(
        current,
        { id: 'source', outcome: 'aborted' },
        first,
        1
      )
    ).toBe(current);
    for (const input of [
      [],
      [{ interruptId: 'a', status: 'resolved' as const }],
      [
        { interruptId: 'a', status: 'resolved' as const },
        { interruptId: 'a', status: 'cancelled' as const },
      ],
      [
        { interruptId: 'a', status: 'resolved' as const },
        { interruptId: 'unknown', status: 'cancelled' as const },
      ],
    ])
      expect(() =>
        claimDecision(current, captureResponses(input), 'resume')
      ).toThrow();
    const captured = responses();
    const claimed = claimDecision(current, captured, 'resume');
    expect(claimed.attempt).toEqual({ runId: 'resume', responses: captured });
    expect(claimed.attempt?.responses).toBe(captured);
    expect(claimed.interrupts).toBe(current.interrupts);
    expect(() =>
      assertResumeEligible(
        claimed,
        { id: 'resume', outcome: 'aborted' },
        first,
        1
      )
    ).toThrow();
  });
  it.each(['invalid', '2020-01-01T00:00:00Z', '2019-01-01T00:00:00Z'])(
    'fails closed on expired/invalid date %s',
    (expiresAt) => {
      const current = {
        ...decision(),
        interrupts: [{ id: 'a', reason: 'Approve', expiresAt }],
      };
      expect(() =>
        assertResumeEligible(
          current,
          { id: 'source', outcome: 'paused' },
          first,
          Date.parse('2020-01-01T00:00:00Z')
        )
      ).toThrow();
    }
  );
  it('permits unexpired decisions and releases only a known pre-fetch claim, even with a different settled run ID', () => {
    const current = {
      ...decision(),
      interrupts: [
        { id: 'a', reason: 'Approve', expiresAt: '2021-01-01T00:00:00Z' },
      ],
    };
    expect(
      assertResumeEligible(
        current,
        { id: 'source', outcome: 'paused' },
        first,
        Date.parse('2020-01-01T00:00:00Z')
      )
    ).toBe(current);
    const original = decision();
    const claimed = claimDecision(original, responses(), 'resume');
    const released = settleDecision(
      claimed,
      { id: 'resume', outcome: 'aborted' },
      false
    );
    expect(released).toEqual(original);
    expect(
      assertResumeEligible(
        released,
        { id: 'resume', outcome: 'aborted' },
        first,
        1
      )
    ).toBe(released);
    expect(
      settleDecision(claimed, { id: 'resume', outcome: 'aborted' }, true)
    ).toBe(claimed);
    expect(
      settleDecision(claimed, { id: 'older', outcome: 'error' }, false)
    ).toBe(claimed);
  });
  it('clears on accepted success despite local abort, while preserving new pauses against old finalizers', () => {
    const claimed = claimDecision(decision(), responses(), 'resume');
    const terminal = {
      type: E.RUN_FINISHED as const,
      threadId: 'thread',
      runId: 'resume',
      outcome: { type: 'success' as const },
    };
    expect(
      settleDecision(
        claimed,
        { id: 'resume', outcome: 'aborted', terminal },
        true
      )
    ).toBeUndefined();
    const next = observeDecision(
      claimed,
      'resume',
      { ...pause(), runId: 'resume' },
      second
    );
    expect(
      settleDecision(
        next,
        {
          id: 'resume',
          outcome: 'paused',
          terminal: { ...pause(), runId: 'resume' },
        },
        true
      )
    ).toBe(next);
    expect(
      settleDecision(next, { id: 'older', outcome: 'success', terminal }, true)
    ).toBe(next);
  });
});
