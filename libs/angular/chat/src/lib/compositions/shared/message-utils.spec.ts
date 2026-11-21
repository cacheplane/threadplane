// libs/angular/chat/src/lib/compositions/shared/message-utils.spec.ts
//
// WHAT THIS PINS. `messageContent()` was typed against LangChain's
// `BaseMessage`, but every caller in this library holds the runtime-neutral
// `Message` from `agent.messages()`. The two shapes are interchangeable for
// this function — it only reads `.content` — so callers were forced to cast,
// and consumers writing a `chatMessageTemplate` were told in the docs to pass
// something other than the message they actually have. The parameter is now
// structural, so a `Message` type-checks directly.
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @nx/enforce-module-boundaries -- proves a LangChain BaseMessage is accepted
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { Message } from '../../agent/message';
import { staticDelivery } from '../../agent';
import { messageContent } from './message-utils';

describe('messageContent()', () => {
  it('accepts the library Message shape without a cast', () => {
    const message: Message = {
      id: 'm1',
      role: 'assistant',
      content: 'hello world',
      delivery: staticDelivery('m1'),
    };

    expect(messageContent(message)).toBe('hello world');
  });

  it('extracts visible text from a library Message with complex content', () => {
    const message: Message = {
      id: 'm2',
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'thinking' },
        { type: 'text', text: 'Hello' },
        { type: 'text', text: ' world' },
      ] as unknown as Message['content'],
      delivery: staticDelivery('m2'),
    };

    expect(messageContent(message)).toBe('Hello world');
  });

  it('still accepts a LangChain BaseMessage', () => {
    expect(messageContent(new HumanMessage('typed prompt'))).toBe(
      'typed prompt'
    );
    expect(
      messageContent(new AIMessage({ content: [{ type: 'text', text: 'hi' }] }))
    ).toBe('hi');
  });

  it('returns an empty string for content it cannot render', () => {
    expect(messageContent({ content: 42 })).toBe('');
    expect(messageContent({ content: null })).toBe('');
  });
});
