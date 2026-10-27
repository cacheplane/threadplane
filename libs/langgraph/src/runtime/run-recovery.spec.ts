import { describe, expect, it } from 'vitest';
import { completeDelivery } from '@threadplane/core';
import {
  captureRun,
  advanceCursor,
  rebaseRun,
  type RunEvidence,
} from './run-recovery';
import { initialMessageState, reduceMessages } from './message-reducer';
import type { StreamProjection } from './stream-projection';

const frame = (sseId?: string, data: unknown = { count: 1 }) => ({
  type: 'values' as const,
  sseId,
  data,
});
describe('owned physical run evidence', () => {
  it('accepts only a route-safe identity for the fixed thread and permanently rejects conflicting identity', () => {
    const first = captureRun({}, { run_id: 'run-1', thread_id: 't' }, 't');
    expect(first.runId).toBe('run-1');
    expect(captureRun({}, { run_id: 'run-only' }, 't').runId).toBe('run-only');
    expect(captureRun(first, { run_id: 'run-1', thread_id: 't' }, 't')).toEqual(
      first
    );
    expect(
      captureRun(first, { run_id: 'run-2', thread_id: 't' }, 't').unsafe
    ).toBe(true);
    for (const run_id of [
      '',
      '../other',
      'a/b',
      'a?b',
      '%2f',
      '.',
      '..',
      'white space',
    ])
      expect(captureRun({}, { run_id, thread_id: 't' }, 't').unsafe).toBe(true);
    expect(
      captureRun({}, { run_id: 'r', thread_id: 'foreign' }, 't').unsafe
    ).toBe(true);
    expect(
      captureRun({ unsafe: true }, { run_id: 'r', thread_id: 't' }, 't').unsafe
    ).toBe(true);
  });

  it('loses the cursor on repeated/idless meaningful frames until a fresh opaque ID', () => {
    let evidence: RunEvidence = { runId: 'r' };
    evidence = advanceCursor(evidence, frame('opaque-1')).evidence;
    expect(evidence.cursor).toBe('opaque-1');
    evidence = advanceCursor(
      evidence,
      frame('opaque-1', { count: 2 })
    ).evidence;
    expect(evidence.cursor).toBeUndefined();
    evidence = advanceCursor(evidence, frame()).evidence;
    expect(evidence.cursor).toBeUndefined();
    evidence = advanceCursor(evidence, frame('opaque-1')).evidence;
    expect(evidence.cursor).toBeUndefined();
    evidence = advanceCursor(evidence, frame('opaque/2')).evidence;
    expect(evidence.cursor).toBe('opaque/2');
    expect(
      advanceCursor(evidence, { type: 'metadata', data: '' }).evidence
    ).toBe(evidence);
  });

  it('rejects an inclusive joined replay before applying its payload', () => {
    expect(
      advanceCursor(
        { runId: 'r', cursor: 'c1', lastId: 'c1' },
        frame('c1'),
        'c1'
      )
    ).toMatchObject({ replay: true, evidence: { cursor: undefined } });
  });

  it('rebases interrupted current assistant text/candidates but keeps completed earlier steps and canonical locks', () => {
    let state = initialMessageState();
    for (const [id, outcome] of [
      ['earlier', 'success'],
      ['current', 'interrupted'],
    ] as const) {
      state = reduceMessages(state, {
        type: 'message',
        mode: 'canonical',
        message: {
          id,
          role: 'assistant',
          content: id,
          delivery: completeDelivery('old', outcome),
        },
      });
    }
    const projection: StreamProjection = {
      generation: 'old',
      userId: 'user',
      baselineIds: [],
      currentAssistantId: 'current',
      sawAssistant: true,
      terminal: true,
      paused: false,
      canonical: [
        { type: 'message', mode: 'canonical', message: state.messages[1] },
      ],
      resume: { turnIds: ['current'], turnEnded: true },
    };
    state = {
      ...state,
      canonical: [...state.canonical, { id: 'current', generation: 'earlier' }],
      aliases: [
        { from: 'wire', to: 'current', generation: 'earlier' },
        { from: 'temporary', to: 'current', generation: 'old' },
      ],
    };
    const next = rebaseRun(state, projection, 'new');
    expect(next.state.messages[0]).toBe(state.messages[0]);
    expect(next.state.messages[1]).toMatchObject({
      content: 'current',
      delivery: { phase: 'streaming', generation: 'new' },
    });
    expect(next.state.canonical).toEqual([
      { id: 'earlier', generation: 'old' },
      { id: 'current', generation: 'earlier' },
    ]);
    expect(next.state.aliases).toEqual([
      { from: 'wire', to: 'current', generation: 'earlier' },
    ]);
    expect(next.projection.canonical[0].message.delivery.generation).toBe(
      'new'
    );
    expect(next.projection.resume).toBe(projection.resume);
  });
});
