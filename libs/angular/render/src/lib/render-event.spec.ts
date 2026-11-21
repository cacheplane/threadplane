import { describe, it, expect } from 'vitest';
import type {
  RenderEvent,
  RenderHandlerEvent,
  RenderStateChangeEvent,
  RenderLifecycleEvent,
  RenderResultEvent,
} from './render-event';

describe('RenderEvent types', () => {
  it('should create a handler event', () => {
    const event: RenderHandlerEvent = {
      type: 'handler',
      action: 'doSomething',
      params: { id: '123' },
    };
    expect(event.type).toBe('handler');
    expect(event.action).toBe('doSomething');
    expect(event.params).toEqual({ id: '123' });
    expect(event.result).toBeUndefined();
  });

  it('should create a handler event with result', () => {
    const event: RenderHandlerEvent = {
      type: 'handler',
      action: 'compute',
      params: { x: 1 },
      result: 42,
    };
    expect(event.result).toBe(42);
  });

  it('should create a state change event', () => {
    const event: RenderStateChangeEvent = {
      type: 'stateChange',
      path: '/user/name',
      value: 'Alice',
      snapshot: { user: { name: 'Alice' } },
    };
    expect(event.type).toBe('stateChange');
    expect(event.path).toBe('/user/name');
    expect(event.value).toBe('Alice');
  });

  it('should create a spec lifecycle event', () => {
    const event: RenderLifecycleEvent = {
      type: 'lifecycle',
      event: 'mounted',
      scope: 'spec',
    };
    expect(event.scope).toBe('spec');
    expect(event.elementKey).toBeUndefined();
  });

  it('should create an element lifecycle event', () => {
    const event: RenderLifecycleEvent = {
      type: 'lifecycle',
      event: 'destroyed',
      scope: 'element',
      elementKey: 'card_1',
      elementType: 'Card',
    };
    expect(event.scope).toBe('element');
    expect(event.elementKey).toBe('card_1');
    expect(event.elementType).toBe('Card');
  });

  it('should narrow RenderEvent by type discriminant', () => {
    const events: RenderEvent[] = [
      { type: 'handler', action: 'a', params: {} },
      { type: 'stateChange', path: '/x', value: 1, snapshot: { x: 1 } },
      { type: 'lifecycle', event: 'mounted', scope: 'spec' },
    ];
    const handlers = events.filter((e): e is RenderHandlerEvent => e.type === 'handler');
    expect(handlers).toHaveLength(1);
    expect(handlers[0].action).toBe('a');
  });
});

it('RenderResultEvent is assignable to RenderEvent', () => {
  const ev: RenderResultEvent = { type: 'result', value: { ok: true }, elementKey: 'btn1' };
  const wide: RenderEvent = ev;
  expect(wide.type).toBe('result');
  if (wide.type === 'result') {
    expect(wide.value).toEqual({ ok: true });
    expect(wide.elementKey).toBe('btn1');
  }
});
