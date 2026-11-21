import { describe, it, expect } from 'vitest';
import { mockAgent } from '../../testing/mock-agent';
import { staticDelivery, type Message, type ToolCall } from '../../agent';
import { resolveMessageToolCalls } from './resolve-message-tool-calls';

describe('resolveMessageToolCalls', () => {
  const calls: ToolCall[] = [
    { id: 'a', name: 'get_weather', args: { city: 'NYC' }, status: 'complete', result: 'sunny' },
    { id: 'b', name: 'search', args: {}, status: 'running' },
  ];

  it('returns the global list when no message is provided', () => {
    const agent = mockAgent({ toolCalls: calls });
    expect(resolveMessageToolCalls(agent, undefined)).toHaveLength(2);
  });

  it('returns the global list for a user message (non-assistant falls through)', () => {
    const agent = mockAgent({ toolCalls: calls });
    const msg: Message = { id: '1', role: 'user', content: 'hello', delivery: staticDelivery('1') };
    expect(resolveMessageToolCalls(agent, msg)).toHaveLength(2);
  });

  it('scopes by toolCallIds on an assistant message', () => {
    const agent = mockAgent({ toolCalls: calls });
    const msg: Message = { id: '2', role: 'assistant', content: '', toolCallIds: ['b'], delivery: staticDelivery('2') };
    const out = resolveMessageToolCalls(agent, msg);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('b');
  });

  it('scopes by tool_use content blocks on an assistant message', () => {
    const agent = mockAgent({ toolCalls: calls });
    const msg: Message = {
      id: '3', role: 'assistant', delivery: staticDelivery('3'),
      content: '',
      blocks: [
        { type: 'text', text: 'Checking.' },
        { type: 'tool_use', id: 'a', name: 'get_weather', args: { city: 'NYC' } },
      ],
    };
    const out = resolveMessageToolCalls(agent, msg);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('a');
  });

  it('returns the agent\'s own calls by identity, in toolCallIds order', () => {
    const agent = mockAgent({ toolCalls: calls });
    const msg: Message = { id: '5', role: 'assistant', content: '', toolCallIds: ['b', 'missing', 'a'], delivery: staticDelivery('5') };
    const out = resolveMessageToolCalls(agent, msg);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(agent.toolCalls()[1]);
    expect(out[1]).toBe(agent.toolCalls()[0]);
  });

  it('includes a call the model is still writing as a running call with the arguments read so far', () => {
    const agent = mockAgent({
      toolCalls: calls,
      streamingToolCalls: [{ id: 'c', name: 'book', argsText: '{"seat":"1', args: { seat: '1' } }],
    });
    const all = resolveMessageToolCalls(agent, undefined);
    expect(all.map((call) => call.id)).toEqual(['a', 'b', 'c']);
    expect(all[2]).toEqual({ id: 'c', name: 'book', args: { seat: '1' }, status: 'running' });
    // Stable while neither source changes.
    expect(resolveMessageToolCalls(agent, undefined)).toBe(all);

    const msg: Message = { id: '6', role: 'assistant', content: '', toolCallIds: ['c'], delivery: staticDelivery('6') };
    expect(resolveMessageToolCalls(agent, msg)).toEqual([{ id: 'c', name: 'book', args: { seat: '1' }, status: 'running' }]);
  });

  it('shows a streaming call with no parsed arguments as running with empty arguments', () => {
    const agent = mockAgent({ streamingToolCalls: [{ id: 'c', name: 'book', argsText: '{"se' }] });
    expect(resolveMessageToolCalls(agent, undefined)).toEqual([{ id: 'c', name: 'book', args: {}, status: 'running' }]);
  });

  it('prefers the finished call once it arrives under the streaming call\'s id', () => {
    const agent = mockAgent({
      toolCalls: [{ id: 'c', name: 'book', args: { seat: '12A' }, status: 'pending' }],
      streamingToolCalls: [{ id: 'c', name: 'book', argsText: '{"seat":"12A"}', args: { seat: '12A' } }],
    });
    const all = resolveMessageToolCalls(agent, undefined);
    expect(all).toHaveLength(1);
    expect(all[0]).toBe(agent.toolCalls()[0]);
  });

  it('returns [] for an assistant message with no tool-call linkage', () => {
    const agent = mockAgent({ toolCalls: calls });
    const msg: Message = { id: '4', role: 'assistant', content: 'just text, no tools', delivery: staticDelivery('4') };
    expect(resolveMessageToolCalls(agent, msg)).toEqual([]);
  });
});
