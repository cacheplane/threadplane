import { describe, expect, it } from 'vitest';
import { InterruptSession } from './interrupt-session';

const batch = [{ id: 'one', reason: 'approval', value: { question: 'Proceed?' } }, { id: 'two', reason: 'input' }];
function pending(entries: unknown[] = batch) {
  const session = new InterruptSession();
  session.observeNative(entries, 'original');
  session.ready();
  return session;
}
const input = { resume: [{ id: 'one', payload: true }, { interruptId: 'two', status: 'cancelled' }] };

describe('InterruptSession', () => {
  it('starts a new batch for the resume run when the original run id was unknown', () => {
    const s = new InterruptSession();
    s.observeNative([{ id: 'old', reason: '' }]);
    s.ready();
    s.claim({ resume: true }, 'attempt', 'resume-run');
    s.dispatched('attempt');
    s.observeNative([{ id: 'new', reason: '' }], 'resume-run');
    s.complete('attempt');
    expect(s.snapshot.generation).toBe(2);
    expect(s.snapshot.phase).toBe('collecting');
    expect(s.snapshot.interrupts.map(entry => entry.id)).toEqual(['new']);
  });
  it('rejects an empty native outcome', () => {
    expect(() => new InterruptSession().observeNative([], 'original')).toThrow();
  });

  it('does not mutate a claimed batch on late same-run observations', () => {
    const s = pending();
    s.claim(input, 'a', 'next');
    const before = s.snapshot;
    s.observeNative([{ id: 'extra', reason: '' }], 'original');
    s.observeLegacy({ toolCallId: 'late' }, 'original');
    expect(s.snapshot).toEqual(before);
  });
  it.each([true, false])('aggregates native and legacy observations in either order (%s)', (nativeFirst) => {
    const s = new InterruptSession();
    const native = () => s.observeNative(batch, 'original');
    const legacy = () => s.observeLegacy({ toolCallId: 'tool', value: 1 }, 'original');
    if (nativeFirst) { native(); legacy(); } else { legacy(); native(); }
    expect(s.snapshot.interrupts).toEqual(batch);
    expect(s.snapshot.phase).toBe('collecting');
    expect(() => s.claim(input, 'a', 'next')).toThrow();
    s.ready();
    expect(s.claim(input, 'a', 'next').parameters.resume).toEqual([
      { interruptId: 'one', status: 'resolved', payload: true }, { interruptId: 'two', status: 'cancelled' },
    ]);
    expect(() => s.claim(input, 'b', 'next')).toThrow();
  });

  it.each([
    true, [], [{ id: 'one' }], [{ id: 'one' }, { id: 'one' }],
    [{ id: 'one' }, { id: 'other' }],
    [{ id: 'one', status: 'bogus' }, { id: 'two' }],
    [{ id: 'one', status: 'cancelled', payload: true }, { id: 'two' }],
  ].map(resume => ({ resume })))('rejects invalid or incomplete batch responses $resume', ({ resume }) => {
    const s = pending();
    expect(() => s.claim({ resume }, 'a', 'next')).toThrow();
    expect(s.snapshot.phase).toBe('pending');
  });

  it.each(['2000-01-01T00:00:00Z', 'not-a-date'])('rejects expired/invalid expiry %s', (expiresAt) => {
    const s = pending([{ id: 'one', reason: '', expiresAt }]);
    expect(() => s.claim({ resume: true }, 'a', 'next')).toThrow();
  });

  it('allows a scalar only for one native interrupt and forbids a bare resume', () => {
    expect(() => new InterruptSession().claim({ resume: true }, 'a', 'next')).toThrow();
    expect(pending([batch[0]]).claim({ resume: true }, 'a', 'next').parameters.resume)
      .toEqual([{ interruptId: 'one', status: 'resolved', payload: true }]);
  });

  // AG-UI 1.0: a whole-optional null is absent on the wire, so a null payload never produces a `payload` key.
  it('accepts a cancelled response with a null payload and records it without a payload key', () => {
    const s = pending([batch[0]]);
    const attempt = s.claim({ resume: [{ id: 'one', status: 'cancelled', payload: null }] }, 'a', 'next');
    expect(attempt.parameters.resume).toEqual([{ interruptId: 'one', status: 'cancelled' }]);
    expect(s.snapshot.phase).not.toBe('pending');
  });

  it('omits a null payload from a resolved response', () => {
    const attempt = pending([batch[0]]).claim({ resume: [{ id: 'one', status: 'resolved', payload: null }] }, 'a', 'next');
    expect(attempt.parameters.resume).toEqual([{ interruptId: 'one', status: 'resolved' }]);
  });

  it('a bare null resume value produces an entry with no payload', () => {
    const attempt = pending([batch[0]]).claim({ resume: null }, 'a', 'next');
    expect(attempt.parameters.resume).toEqual([{ interruptId: 'one', status: 'resolved' }]);
  });

  it('copies inbound fields, snapshots, and claimed input deeply', () => {
    const entries = structuredClone(batch);
    const s = pending(entries);
    entries[0].value!.question = 'changed';
    s.snapshot.interrupts.splice(0);
    expect(s.snapshot.interrupts).toEqual(batch);
    const submit = { resume: { answer: true }, state: { nested: { x: 1 } } };
    const single = pending([batch[0]]);
    const attempt = single.claim(submit, 'a', 'next');
    submit.resume.answer = false;
    submit.state.nested.x = 2;
    expect(attempt.input).toEqual({ resume: { answer: true }, state: { nested: { x: 1 } } });
    expect(Object.isFrozen(attempt.input.state)).toBe(true);
  });

  it.each(['legacy-command', 'mastra-command'] as const)('uses explicit %s even with native data', (profile) => {
    const s = new InterruptSession(profile);
    s.observeLegacy({ toolCallId: 'tool', runId: 'original' }, 'original');
    s.observeNative(batch, 'original');
    s.ready();
    const command = { resume: true, ...(profile === 'mastra-command' ? { interruptEvent: { toolCallId: 'tool', runId: 'original' } } : {}) };
    expect(s.claim({ resume: true }, 'a', 'next').parameters).toEqual({ forwardedProps: { command } });
  });

  it('retries the same retained attempt only when dispatch is known not to have happened', () => {
    const s = pending();
    const first = s.claim(input, 'a', 'next');
    s.fail('a', true);
    expect(s.snapshot.phase).toBe('pending');
    expect(s.retry()).toEqual(first);
    expect(s.snapshot.phase).toBe('claimed');
    expect(() => s.retry()).toThrow();
    s.dispatched('a');
    s.fail('a', false);
    expect(s.snapshot.phase).toBe('uncertain');
    expect(() => s.retry()).toThrow();
  });

  it('requires recovery after an acknowledged resume fails', () => {
    const s = pending();
    s.claim(input, 'a', 'next');
    s.dispatched('a');
    s.acknowledge('a');
    s.fail('a', true);
    expect(s.snapshot.phase).toBe('recovery-required');
    expect(() => s.retry()).toThrow();
  });

  it('accepts positive proof of nondispatch after dispatch intent', () => {
    const s = pending();
    const attempt = s.claim(input, 'a', 'next');
    s.dispatched('a');
    s.fail('a', true);
    expect(s.snapshot.phase).toBe('pending');
    expect(s.retry()).toEqual(attempt);
  });

  it('requires retry to preserve the retained decision after known nondispatch', () => {
    const s = pending();
    const original = s.claim(input, 'a', 'next');
    s.fail('a', true);
    expect(() => s.claim({ resume: [{ id: 'one', payload: false }, { id: 'two' }] }, 'b', 'different')).toThrow();
    expect(s.snapshot.phase).toBe('pending');
    expect(s.retry()).toEqual(original);
  });

  it('correlates transitions and preserves reinterruptions against old terminal callbacks', () => {
    const s = pending();
    s.claim(input, 'a', 'next');
    s.acknowledge('wrong');
    expect(s.snapshot.phase).toBe('claimed');
    s.dispatched('a');
    s.observeNative([{ id: 'three', reason: '' }], 'next');
    s.observeLegacy({ toolCallId: 'new-tool' }, 'next');
    s.complete('a');
    s.fail('a', false);
    s.ready();
    expect(s.snapshot.phase).toBe('pending');
    expect(s.snapshot.generation).toBe(2);
    expect(s.snapshot.interrupts.map(i => i.id)).toEqual(['three']);
  });

  it('restores a defensive snapshot and clears a matching completed attempt', () => {
    const s = pending();
    s.claim(input, 'a', 'next');
    s.fail('a', true);
    const snapshot = s.snapshot;
    const restored = new InterruptSession();
    restored.restore(snapshot);
    snapshot.interrupts.length = 0;
    expect(restored.retry().id).toBe('a');
    restored.complete('a');
    expect(restored.snapshot.phase).toBe('none');
  });
});
