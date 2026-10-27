import { expect, it } from 'vitest';
import {
  beginCheckpointEffect,
  readyCheckpoint,
  uncertainCheckpoint,
} from './checkpoint-state';
it('invalidates old authority during every effect and never restores it after uncertainty', () => {
  const position = {
    thread_id: 'thread',
    checkpoint_ns: '' as const,
    checkpoint_id: 'a',
    checkpoint_map: {},
  };
  const confirmed = {
    position,
    state: {
      checkpoint: position,
      values: {},
      next: [],
      tasks: [],
      created_at: '',
      parent_checkpoint: null,
      metadata: {},
    },
    paused: false,
  };
  const ready = { kind: 'ready' as const, confirmed };
  expect(readyCheckpoint(ready).position.checkpoint_id).toBe('a');
  const inflight = beginCheckpointEffect(ready, 'run');
  expect(() => readyCheckpoint(inflight)).toThrow();
  const uncertain = uncertainCheckpoint(inflight);
  expect(() => readyCheckpoint(uncertain)).toThrow();
  expect(uncertainCheckpoint(uncertain)).toBe(uncertain);
});
