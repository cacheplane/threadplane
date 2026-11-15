import { describe, expect, it } from 'vitest';
import {
  decisionState,
  type NativeDecision,
  type PauseId,
} from './decision';
import { bindingFixture } from './testing/binding-fixture';

const id = '00000000-0000-4000-8000-000000000001' as PauseId;
const interrupts = Object.freeze([
  Object.freeze({ id: 'approval', reason: 'Approve' }),
]);
const native: NativeDecision = Object.freeze({
  kind: 'native',
  id,
  sourceRunId: 'source',
  interrupts,
});
const claimed: NativeDecision = Object.freeze({
  ...native,
  attempt: Object.freeze({
    runId: 'answer',
    responses: Object.freeze([
      Object.freeze({ interruptId: 'approval', status: 'resolved' as const }),
    ]),
  }),
});

describe('decisionState', () => {
  it('is absent when nothing is waiting', () => {
    expect(decisionState({})).toBeUndefined();
    expect(decisionState({ run: { id: 'run', outcome: 'success' } })).toBeUndefined();
  });

  it('reads a pause this owner cannot answer as unsupported', () => {
    const state = decisionState({
      decision: { kind: 'unsupported', sourceRunId: 'source' },
      run: { id: 'source', outcome: 'paused' },
    });
    expect(state).toEqual({ kind: 'unsupported' });
    expect(Object.isFrozen(state)).toBe(true);
  });

  it.each([
    ['observing', native, { id: 'source' }],
    ['ready', native, { id: 'source', outcome: 'paused' as const }],
    ['answering', claimed, { id: 'answer' }],
    ['uncertain', claimed, { id: 'answer', outcome: 'interrupted' as const }],
    ['uncertain', claimed, { id: 'answer', outcome: 'aborted' as const }],
  ])('reads %s from the decision and its run', (phase, decision, run) => {
    const state = decisionState({ decision, run });
    expect(state).toEqual({ kind: 'native', id, interrupts, phase });
    expect(Object.isFrozen(state)).toBe(true);
    expect(state?.kind === 'native' && state.interrupts).toBe(interrupts);
    expect(decisionState({ decision, run: { ...run } })).toBe(state);
  });

  it('follows a real pause through an answer that succeeds', async () => {
    const fixture = bindingFixture();
    const state = () => decisionState(fixture.session.getSnapshot());
    try {
      const paused = fixture.session.submit('Refund');
      const exchange = await fixture.started();
      expect(state()).toBeUndefined();
      exchange.emit({
        type: 'RUN_FINISHED',
        threadId: exchange.body.threadId,
        runId: exchange.body.runId,
        outcome: {
          type: 'interrupt',
          interrupts: [{ id: 'approval', reason: 'Approve the refund' }],
        },
      });
      expect(await paused).toBe('paused');
      const ready = state();
      expect(ready).toMatchObject({
        kind: 'native',
        phase: 'ready',
        interrupts: [{ id: 'approval', reason: 'Approve the refund' }],
      });
      if (ready?.kind !== 'native') throw new Error('Expected a native pause');
      expect(await fixture.session.submit('Ignored')).toBe('error');
      expect(fixture.exchanges).toHaveLength(1);

      const answered = fixture.session.resume(ready.id, [
        { interruptId: 'approval', status: 'resolved', payload: { approved: true } },
      ]);
      const next = await fixture.started(1);
      expect(state()).toMatchObject({ phase: 'answering', id: ready.id });
      expect((next.body as { resume?: unknown }).resume).toEqual([
        { interruptId: 'approval', status: 'resolved', payload: { approved: true } },
      ]);
      next.emit({
        type: 'RUN_FINISHED',
        threadId: next.body.threadId,
        runId: next.body.runId,
      });
      expect(await answered).toBe('success');
      expect(state()).toBeUndefined();
    } finally {
      await fixture.cleanup();
    }
  });

  it('reads an answer stopped after it was sent as uncertain', async () => {
    const fixture = bindingFixture();
    const state = () => decisionState(fixture.session.getSnapshot());
    try {
      const paused = fixture.session.submit('Refund');
      const exchange = await fixture.started();
      exchange.emit({
        type: 'RUN_FINISHED',
        threadId: exchange.body.threadId,
        runId: exchange.body.runId,
        outcome: { type: 'interrupt', interrupts: [{ id: 'approval', reason: 'Approve' }] },
      });
      await paused;
      const ready = state();
      if (ready?.kind !== 'native') throw new Error('Expected a native pause');
      const answered = fixture.session.resume(ready.id, [
        { interruptId: 'approval', status: 'cancelled' },
      ]);
      await fixture.started(1);
      await fixture.session.stop();
      expect(await answered).toBe('aborted');
      expect(state()).toMatchObject({ phase: 'uncertain', id: ready.id });
      expect(
        await fixture.session.resume(ready.id, [
          { interruptId: 'approval', status: 'cancelled' },
        ])
      ).toBe('error');
      expect(fixture.exchanges).toHaveLength(2);
    } finally {
      await fixture.cleanup();
    }
  });
});
