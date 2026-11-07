import { describe, expect, it, vi } from 'vitest';
import {
  createInspectionRecorder,
  INSPECTION_LIMITS,
  parseInspectionFrame,
  parseRuntimeInspectionMessage,
  type InspectionFrame,
} from './inspection';

const frame = (): InspectionFrame => ({
  sequence: 1,
  elapsedMs: 0,
  framework: 'angular',
  messages: [],
  state: null,
  busy: false,
  calls: [],
  event: { type: 'snapshot', payload: null },
  limited: false,
});
const envelope = () => ({
  type: 'tplane:runtime-inspection',
  version: 1,
  nonce: 'nonce-1',
  generation: 2,
  frame: frame(),
});

describe('inspection decoding', () => {
  it('returns detached immutable exact-schema frames and envelopes', () => {
    const input = {
      ...envelope(),
      frame: { ...frame(), event: { type: 'snapshot', payload: null } },
    };
    const result = parseRuntimeInspectionMessage(input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(Object.isFrozen(result?.frame.messages)).toBe(true);
    input.frame.event.type = 'changed';
    expect(result?.frame.event.type).toBe('snapshot');
  });

  it('rejects accessors without invoking them, including array elements', () => {
    const getter = vi.fn(() => 'secret');
    const value = frame();
    Object.defineProperty(value, 'state', { get: getter });
    expect(parseInspectionFrame(value)).toBeNull();
    const messages = new Array(1);
    Object.defineProperty(messages, '0', { get: getter });
    expect(parseInspectionFrame({ ...frame(), messages })).toBeNull();
    expect(getter).not.toHaveBeenCalled();
  });

  it.each([
    { ...envelope(), apiKey: 'secret' },
    { ...envelope(), version: 2 },
    { ...envelope(), generation: -1 },
    { ...envelope(), nonce: '' },
    { ...envelope(), frame: { ...frame(), state: { nested: {} } } },
    { ...envelope(), frame: { ...frame(), sequence: NaN } },
    {
      ...envelope(),
      frame: {
        ...frame(),
        messages: Array(100).fill({ id: '1', role: 'user', text: 'hi' }),
      },
    },
    {
      ...envelope(),
      frame: {
        ...frame(),
        event: { type: 'error', payload: { error: 'secret' } },
      },
    },
  ])('rejects malformed or non-allowlisted input %#', (value) => {
    expect(parseRuntimeInspectionMessage(value)).toBeNull();
  });

  it('rejects individually bounded fields whose combined encoding exceeds the frame budget', () => {
    const text = '\u0000'.repeat(INSPECTION_LIMITS.textLength);
    const messages = Array.from(
      { length: INSPECTION_LIMITS.messages },
      (_, id) => ({ id: `${id}`, role: 'user', text })
    );
    expect(parseInspectionFrame({ ...frame(), messages })).toBeNull();
  });
});

describe('inspection recorder', () => {
  it('detaches observed data and records actual call inputs and settlements', () => {
    const frames: InspectionFrame[] = [];
    const recorder = createInspectionRecorder('react', (value) =>
      frames.push(value)
    );
    const snapshot = {
      messages: [{ id: 'a', role: 'user', text: 'hello' }],
      state: { count: 1 },
      busy: true,
    };
    recorder.observe(snapshot);
    snapshot.messages[0].text = 'changed';
    snapshot.state.count = 2;
    const id = recorder.startCall('hello');
    expect(frames[0].messages[0].text).toBe('hello');
    expect(frames[0].state).toEqual({ count: 1 });
    expect(frames.at(-1)?.calls).toEqual([
      { id, name: 'submit', input: { message: 'hello' }, status: 'pending' },
    ]);
    recorder.settleCall(id, 'settled');
    expect(frames.at(-1)?.calls[0].status).toBe('settled');
  });

  it('clears a conversation, preserves sequence/time, and ignores stale settlements', () => {
    const frames: InspectionFrame[] = [];
    const recorder = createInspectionRecorder('angular', (value) =>
      frames.push(value)
    );
    recorder.observe({ messages: [], state: { count: 2 }, busy: true });
    const stale = recorder.startCall('old');
    recorder.reset();
    const reset = frames[frames.length - 1];
    expect(reset).toMatchObject({
      messages: [],
      state: null,
      calls: [],
      busy: false,
      event: { type: 'reset' },
    });
    expect(reset.sequence).toBeGreaterThan(frames[0].sequence);
    expect(reset.elapsedMs).toBeGreaterThanOrEqual(frames[0].elapsedMs);
    const length = frames.length;
    recorder.settleCall(stale, 'rejected');
    expect(frames).toHaveLength(length);
    const next = recorder.startCall('new');
    expect(next).not.toBe(stale);
    recorder.dispose();
    recorder.observe({ messages: [], state: null, busy: false });
    recorder.settleCall(next, 'settled');
    recorder.reset();
    expect(recorder.startCall('ignored')).toBeNull();
    expect(frames).toHaveLength(length + 1);
  });

  it('bounds output and strips nested, configuration and error fields without reading getters', () => {
    const frames: InspectionFrame[] = [];
    const recorder = createInspectionRecorder('react', (value) =>
      frames.push(value)
    );
    const getter = vi.fn(() => 'secret');
    const state = {
      count: 1,
      nested: {},
      apiKey: 'secret',
      error: 'secret',
      headers: 'secret',
    };
    Object.defineProperty(state, 'accessor', { get: getter, enumerable: true });
    recorder.observe({
      messages: Array.from({ length: 100 }, (_, id) => ({
        id: `${id}`,
        role: 'user',
        text: '\u0000'.repeat(5000),
      })),
      state,
      busy: false,
    });
    for (let i = 0; i < 100; i++) recorder.startCall('x'.repeat(5000));
    const latest = frames[frames.length - 1];
    expect(latest.limited).toBe(true);
    expect(latest.messages.length).toBeLessThanOrEqual(
      INSPECTION_LIMITS.messages
    );
    expect(latest.calls.length).toBeLessThanOrEqual(INSPECTION_LIMITS.calls);
    expect(
      new TextEncoder().encode(JSON.stringify(latest)).length
    ).toBeLessThanOrEqual(INSPECTION_LIMITS.encodedBytes);
    expect(latest.state).toEqual({ count: 1 });
    expect(getter).not.toHaveBeenCalled();
    expect(parseInspectionFrame(latest)).not.toBeNull();
  });

  it('isolates publisher exceptions and hostile snapshot objects', () => {
    const recorder = createInspectionRecorder('angular', () => {
      throw new Error('observer');
    });
    const ownKeys = vi.fn(() => {
      throw new Error('hostile');
    });
    expect(() =>
      recorder.observe({
        messages: [],
        state: new Proxy({}, { ownKeys }),
        busy: false,
      })
    ).not.toThrow();
    expect(ownKeys).toHaveBeenCalledOnce();
    expect(() => recorder.startCall('hello')).not.toThrow();
    expect(() => recorder.reset()).not.toThrow();
  });
});
