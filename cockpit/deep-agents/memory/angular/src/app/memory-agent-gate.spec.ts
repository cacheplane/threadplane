import { TestBed } from '@angular/core/testing';
import { mockAgent, submitMessage } from '@threadplane/chat';
import { it, expect, vi } from 'vitest';
import { MemoryScope, SCOPE_KEY } from './memory-scope';
import { guardMemoryAgent } from './memory-agent-gate';
const scope = '12345678-1234-4234-8234-123456789abc';
it('preserves runtime fields and merges original blocking while using the real composer helper', async () => {
  localStorage.setItem(SCOPE_KEY, scope);
  const controller = TestBed.inject(MemoryScope);
  const original = mockAgent();
  const submit = vi.spyOn(original, 'submit');
  const guarded = guardMemoryAgent(original, controller);
  expect(guarded.customEvents).toBe(original.customEvents);
  expect(guarded.stop).toBe(original.stop);
  expect(guarded.state).toBe(original.state);
  const runtimeBlock = { reason: 'unsettled-tools' };
  original.inputBlocked.set(runtimeBlock);
  expect(guarded.inputBlocked()).toEqual(runtimeBlock);
  expect(submitMessage(guarded, 'blocked by runtime')).toBeNull();
  original.inputBlocked.set(undefined);
  expect(guarded.inputBlocked()).toBeUndefined();
  submitMessage(guarded, ' admitted ');
  await Promise.resolve();
  expect(submit).toHaveBeenCalledWith({ message: 'admitted' }, undefined);
  submit.mockClear();
  localStorage.removeItem(SCOPE_KEY);
  // A denied submission settles as an unsent one does: 'aborted', never a rejection.
  await expect(guarded.submit({ message: 'denied' })).resolves.toBe('aborted');
  expect(guarded.inputBlocked()).toMatchObject({ reason: 'memory-scope' });
  expect(submitMessage(guarded, 'blocked by scope')).toBeNull();
  expect(submit).not.toHaveBeenCalled();
  localStorage.setItem(SCOPE_KEY, scope);
  await guarded.submit({ message: 'still denied' });
  expect(submit).not.toHaveBeenCalled();
});
it('follows a field the agent only publishes later, which a spread copy would miss', () => {
  localStorage.setItem(SCOPE_KEY, scope);
  // Stands in for the injected agent, which answers each read from its current
  // session: `error` does not exist until the session publishes one.
  const members: Record<string, unknown> = { ...mockAgent() };
  delete members['error'];
  const late = mockAgent().error;
  const guarded = guardMemoryAgent(
    members as unknown as ReturnType<typeof mockAgent>,
    TestBed.inject(MemoryScope)
  );
  expect(guarded.error).toBeUndefined();
  members['error'] = late;
  expect(guarded.error).toBe(late);
});
