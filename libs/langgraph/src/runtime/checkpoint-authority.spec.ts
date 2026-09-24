import { describe, expect, it } from 'vitest';
import {
  captureCheckpoint,
  captureCompletedCheckpoint,
  captureCheckpointEvent,
  confirmCheckpoint,
  assertResumeCheckpoint,
} from './checkpoint-authority';

const checkpoint = {
  thread_id: 'thread',
  checkpoint_ns: '' as const,
  checkpoint_id: 'a',
  checkpoint_map: { '': 'a' },
};
const saved = (changes: Record<string, unknown> = {}) => ({
  checkpoint,
  values: { messages: [] },
  next: [],
  tasks: [],
  metadata: { run_id: 'run' },
  ...changes,
});
const call = {
  type: 'ai',
  id: 'assistant',
  tool_calls: [{ id: 'old', name: 'unknown', args: { x: 1 } }],
};

describe('checkpoint authority capture', () => {
  it.each([{}, false, 0, null, '', [{ id: 'interrupt', value: 'pending' }]])(
    'rejects completed source root interrupts %j',
    (interrupts) => {
      expect(() =>
        captureCompletedCheckpoint(saved({ interrupts }), checkpoint)
      ).toThrow();
    }
  );
  it.each([undefined, []])(
    'accepts optional empty completed source root interrupts %j',
    (interrupts) => {
      expect(() =>
        captureCompletedCheckpoint(saved({ interrupts }), checkpoint)
      ).not.toThrow();
    }
  );
  it('owns only routing fields and deep freezes maps', () => {
    const input = {
      ...checkpoint,
      checkpoint_map: { '': 'a' },
      secret: 'omit',
    };
    const captured = captureCheckpoint(input, 'thread');
    input.checkpoint_map[''] = 'changed';
    expect(captured).toEqual(checkpoint);
    expect(Object.isFrozen(captured.checkpoint_map)).toBe(true);
  });
  it.each([
    { thread_id: 'other' },
    { checkpoint_ns: 'child' },
    { checkpoint_id: undefined },
    { checkpoint_id: '' },
    { checkpoint_map: { '': 3 } },
    { checkpoint_map: null },
  ])('rejects unsupported routing %j', (change) => {
    expect(() =>
      captureCheckpoint({ ...checkpoint, ...change }, 'thread')
    ).toThrow();
  });
  it.each([
    { next: ['work'] },
    { tasks: [{}] },
    { values: { __interrupt__: [], messages: [] } },
    { values: { messages: [call] } },
  ])('rejects incomplete or hidden calls %j', (change) => {
    expect(() =>
      captureCompletedCheckpoint(saved(change), checkpoint)
    ).toThrow();
  });
  it('accepts authoritative historical tool results without reconstructing typed provenance', () => {
    const source = captureCompletedCheckpoint(
      saved({
        values: {
          messages: [
            call,
            { type: 'tool', tool_call_id: 'old', content: '{"x":1}' },
          ],
        },
      }),
      checkpoint
    );
    expect(source.calls.map((entry) => entry.id)).toEqual(['old']);
    expect(source.state.values).toEqual({
      messages: [
        call,
        { type: 'tool', tool_call_id: 'old', content: '{"x":1}' },
      ],
    });
  });
});

describe('final checkpoint evidence', () => {
  const event = (changes: Record<string, unknown> = {}) => ({
    type: 'checkpoints' as const,
    data: {
      config: { configurable: { ...checkpoint, run_id: 'run' } },
      values: { messages: [] },
      next: [],
      tasks: [],
      ...changes,
    },
  });
  it.each([{}, false, 0, null, '', [{ id: 'interrupt', value: 'pending' }]])(
    'rejects completed confirmation root interrupts %j',
    (interrupts) => {
      const candidate = captureCheckpointEvent(event(), 'thread');
      expect(() =>
        confirmCheckpoint(candidate, saved({ interrupts }), 'run')
      ).toThrow();
    }
  );
  it.each([undefined, []])(
    'accepts optional empty completed confirmation root interrupts %j',
    (interrupts) => {
      const candidate = captureCheckpointEvent(event(), 'thread');
      expect(
        confirmCheckpoint(candidate, saved({ interrupts }), 'run').paused
      ).toBe(false);
    }
  );
  it('requires matching saved root identity, physical run, and final state', () => {
    const candidate = captureCheckpointEvent(event(), 'thread');
    expect(confirmCheckpoint(candidate, saved(), 'run').position).toEqual(
      checkpoint
    );
    for (const change of [
      { checkpoint: { ...checkpoint, checkpoint_id: 'other' } },
      { metadata: { run_id: 'other' } },
      { values: { messages: ['other'] } },
      { next: ['work'] },
    ])
      expect(() =>
        confirmCheckpoint(candidate, saved(change), 'run')
      ).toThrow();
    expect(() => confirmCheckpoint(undefined, saved(), 'run')).toThrow();
    expect(
      captureCheckpointEvent({ ...event(), namespace: ['child'] }, 'thread')
    ).toBeUndefined();
  });
  it('supports only unconsumed dynamic root tasks and detects consumption before resume', () => {
    const tasks = [
      {
        id: 'task',
        name: 'approval',
        error: null,
        result: null,
        interrupts: [{ id: 'interrupt', value: { amount: 10 } }],
      },
    ];
    const pause = saved({ next: ['approval'], tasks });
    const candidate = captureCheckpointEvent(
      event({ next: ['approval'], tasks: [{ id: 'task', name: 'approval' }] }),
      'thread'
    );
    const confirmed = confirmCheckpoint(candidate, pause, 'run');
    expect(confirmed.paused).toBe(true);
    expect(() => assertResumeCheckpoint(confirmed, pause)).not.toThrow();
    expect(() =>
      assertResumeCheckpoint(confirmed, {
        ...pause,
        values: { messages: [], amount: 99 },
      })
    ).toThrow();
    expect(() =>
      assertResumeCheckpoint(
        confirmed,
        saved({
          next: ['approval'],
          tasks: [{ ...tasks[0], result: { decision: true } }],
        })
      )
    ).toThrow();
    expect(() =>
      assertResumeCheckpoint(
        confirmed,
        saved({
          next: ['approval'],
          tasks: [
            {
              ...tasks[0],
              interrupts: [{ id: 'different', value: { amount: 10 } }],
            },
          ],
        })
      )
    ).toThrow();
  });
});
