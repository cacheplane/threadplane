import { describe, it, expect } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { agentPlan, agentPlanFromState } from './agent-plan';

describe('agentPlanFromState', () => {
  it('reads the todos list a to-do tool writes', () => {
    expect(
      agentPlanFromState({
        todos: [
          { content: 'Read both drafts', status: 'completed' },
          { content: 'Compare them', status: 'in_progress' },
          { content: ' Write the note ', status: 'pending' },
        ],
      }),
    ).toEqual([
      { label: 'Read both drafts', status: 'completed' },
      { label: 'Compare them', status: 'in_progress' },
      { label: 'Write the note', status: 'pending' },
    ]);
  });

  it.each([undefined, null, 'text', {}, { todos: 'not a list' }])('is undefined without a todos list (%s)', (state) => {
    expect(agentPlanFromState(state)).toBeUndefined();
  });

  it('skips entries without text or with an unknown status', () => {
    expect(
      agentPlanFromState({
        todos: [null, { content: '' , status: 'pending' }, { content: 'Ship', status: 'blocked' }, { status: 'pending' }, { content: 'Keep', status: 'pending' }],
      }),
    ).toEqual([{ label: 'Keep', status: 'pending' }]);
  });
});

describe('agentPlan', () => {
  it('changes only when a step changes', () => {
    const state = signal<unknown>({ todos: [{ content: 'Compare', status: 'pending' }], other: 1 });
    const plan = TestBed.runInInjectionContext(() => agentPlan(state));
    const first = plan();
    state.set({ todos: [{ content: 'Compare', status: 'pending' }], other: 2 });
    expect(plan()).toBe(first);
    state.set({ todos: [{ content: 'Compare', status: 'completed' }], other: 2 });
    expect(plan()).not.toBe(first);
    expect(plan()).toEqual([{ label: 'Compare', status: 'completed' }]);
  });
});
