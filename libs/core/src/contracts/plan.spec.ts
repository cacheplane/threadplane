import { describe, expect, it } from 'vitest';
import { agentPlanFromState } from './plan.js';

describe('agentPlanFromState', () => {
  it('reads the todos list a to-do tool writes and skips malformed entries', () => {
    expect(
      agentPlanFromState({
        todos: [
          { content: ' Read ', status: 'completed' },
          { content: '', status: 'pending' },
          { content: 'Ship', status: 'blocked' },
          null,
          { content: 'Write', status: 'pending' },
        ],
      })
    ).toEqual([
      { label: 'Read', status: 'completed' },
      { label: 'Write', status: 'pending' },
    ]);
  });
  it.each([undefined, null, 'x', {}, { todos: 'no' }])('is undefined without a todos list (%s)', (state) => {
    expect(agentPlanFromState(state)).toBeUndefined();
  });
});
