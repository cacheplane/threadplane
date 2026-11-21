import { isUserMessage, isAssistantMessage, type Message } from './message';
import {
  completeDelivery,
  staticDelivery,
  streamingDelivery,
} from '@threadplane/core';

describe('MessageDelivery', () => {
  it('creates streaming delivery state', () => {
    expect(streamingDelivery('generation-1')).toEqual({
      generation: 'generation-1',
      phase: 'streaming',
    });
  });

  it('creates complete delivery state with its outcome', () => {
    expect(completeDelivery('generation-2', 'interrupted')).toEqual({
      generation: 'generation-2',
      phase: 'complete',
      outcome: 'interrupted',
    });
  });

  it('creates successful complete delivery state for static messages', () => {
    expect(staticDelivery('message-1')).toEqual({
      generation: 'message-1',
      phase: 'complete',
      outcome: 'success',
    });
  });
});

describe('Message', () => {
  it('isUserMessage narrows role', () => {
    const msg: Message = {
      id: '1',
      delivery: staticDelivery('1'),
      role: 'user',
      content: 'hi',
    };
    expect(isUserMessage(msg)).toBe(true);
    expect(isAssistantMessage(msg)).toBe(false);
  });

  it('isAssistantMessage narrows role', () => {
    const msg: Message = {
      id: '2',
      delivery: staticDelivery('2'),
      role: 'assistant',
      content: 'hello',
    };
    expect(isAssistantMessage(msg)).toBe(true);
    expect(isUserMessage(msg)).toBe(false);
  });
});

describe('Message — reasoning fields', () => {
  it('accepts an optional reasoning string', () => {
    const m: Message = {
      id: 'a',
      delivery: staticDelivery('a'),
      role: 'assistant',
      content: 'hello',
      reasoning: 'first I thought about it',
    };
    expect(m.reasoning).toBe('first I thought about it');
  });

  it('accepts an optional reasoningDurationMs number', () => {
    const m: Message = {
      id: 'a',
      delivery: staticDelivery('a'),
      role: 'assistant',
      content: 'hello',
      reasoning: 'first I thought about it',
      reasoningDurationMs: 1234,
    };
    expect(m.reasoningDurationMs).toBe(1234);
  });

  it('treats both reasoning fields as optional', () => {
    const m: Message = {
      id: 'a',
      delivery: staticDelivery('a'),
      role: 'assistant',
      content: 'hello',
    };
    expect(m.reasoning).toBeUndefined();
    expect(m.reasoningDurationMs).toBeUndefined();
  });
});
