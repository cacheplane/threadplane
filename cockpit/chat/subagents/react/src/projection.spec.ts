import { describe, expect, it } from 'vitest';
import type { Message, ToolCall } from '@threadplane/core';
import { projectToolObservations } from './projection';
const delivery = { generation: 'run', phase: 'streaming' as const };
const calls: ToolCall[] = ['LAX', 'JFK'].map((id) => ({
  id,
  name: 'task',
  args: { subagent_type: 'research', task_description: id },
  status: 'pending',
}));
const owner: Message = {
  id: 'assistant',
  role: 'assistant',
  content: '',
  toolCallIds: ['LAX', 'JFK'],
  delivery,
};
const result = (id: string, content: string): Message => ({
  id: `result-${id}`,
  role: 'tool',
  name: 'task',
  toolCallId: id,
  content,
  delivery,
});
describe('per-assistant literal tool observations', () => {
  it('shows finalized pending arguments once on the requesting assistant', () => {
    const cards = projectToolObservations([owner], calls);
    expect([...cards.keys()]).toEqual(['assistant']);
    expect(cards.get('assistant')).toEqual(
      calls.map((tool) => ({
        id: tool.id,
        name: tool.name,
        role: 'research',
        argumentsText: JSON.stringify(tool.args, null, 2),
      }))
    );
  });
  it('joins same-name reversed results by ID without duplicating tool rows', () => {
    const tools = calls.map((tool) => ({
      ...tool,
      status: 'complete' as const,
      result: `<b>${tool.id}</b>`,
    }));
    const cards = projectToolObservations(
      [owner, result('JFK', '<b>JFK</b>'), result('LAX', '<b>LAX</b>')],
      tools
    );
    expect([...cards.keys()]).toEqual(['assistant']);
    expect(cards.get('assistant')?.map((card) => card.resultText)).toEqual([
      '<b>LAX</b>',
      '<b>JFK</b>',
    ]);
  });
  it('withholds incomplete and malformed finalized arguments without formatting them', () => {
    expect(projectToolObservations([owner], []).size).toBe(0);
    expect(
      projectToolObservations(
        [owner],
        calls.map((tool) => ({ ...tool, args: {} }))
      ).size
    ).toBe(0);
    const invalid: ToolCall = {
      id: 'lookup',
      name: 'lookup_flight',
      args: { flight_number: 123 },
      status: 'complete',
      result: 'Error invoking tool',
    };
    expect(
      projectToolObservations(
        [{ ...owner, toolCallIds: ['lookup'] }],
        [invalid]
      ).size
    ).toBe(0);
  });
  it.each([
    'duplicate-owner',
    'duplicate-call',
    'orphan-result',
    'wrong-name',
    'wrong-result',
    'duplicate-result',
    'result-before-owner',
  ])('withholds ambiguous association %s', (mode) => {
    let messages: Message[] = [
      { ...owner, toolCallIds: ['LAX'] },
      result('LAX', 'observed'),
    ];
    const tools: ToolCall[] = [
      { ...calls[0], status: 'complete', result: 'observed' },
    ];
    if (mode === 'duplicate-owner')
      messages.push({ ...messages[0], id: 'other' });
    if (mode === 'duplicate-call') tools.push(tools[0]);
    if (mode === 'orphan-result') messages = [messages[1]];
    if (mode === 'wrong-name')
      messages[1] = { ...messages[1], name: 'lookup_flight' };
    if (mode === 'wrong-result')
      messages[1] = { ...messages[1], content: 'changed' };
    if (mode === 'duplicate-result')
      messages.push({ ...messages[1], id: 'duplicate' });
    if (mode === 'result-before-owner') messages.reverse();
    expect(projectToolObservations(messages, tools).size).toBe(0);
  });
  it('keeps sequential assistant observations separate and handles text-only rows', () => {
    const messages: Message[] = [
      { ...owner, toolCallIds: ['LAX'] },
      result('LAX', 'LAX'),
      { ...owner, id: 'second', toolCallIds: ['JFK'] },
      result('JFK', 'JFK'),
    ];
    const tools = calls.map((tool) => ({
      ...tool,
      status: 'complete' as const,
      result: tool.id,
    }));
    const cards = projectToolObservations(messages, tools);
    expect(cards.get('assistant')?.map((card) => card.id)).toEqual(['LAX']);
    expect(cards.get('second')?.map((card) => card.id)).toEqual(['JFK']);
    expect(
      projectToolObservations([{ ...owner, toolCallIds: [] }], []).size
    ).toBe(0);
  });
  it('never invokes accessors or toJSON when formatting unsafe observations', () => {
    let reads = 0;
    const args = Object.defineProperty({}, 'airport_code', {
      get() {
        reads++;
        return 'LAX';
      },
    });
    expect(projectToolObservations([owner], [{ ...calls[0], args }]).size).toBe(
      0
    );
    expect(
      projectToolObservations(
        [owner],
        [
          {
            ...calls[0],
            args: {
              airport_code: 'LAX',
              toJSON() {
                reads++;
                return {};
              },
            } as never,
          },
        ]
      ).size
    ).toBe(0);
    expect(reads).toBe(0);
  });
});
