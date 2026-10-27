import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSession } from './create-session';
import type { AgentTransport, StreamEvent } from './transport.types';
import { controlledSession } from './testing/controlled-session';
import { saved } from './testing/checkpoint-fixture';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});
const mixed = (text: string) => [
  text.slice(0, 1),
  { type: 'output_text', text: text.slice(1, 3) },
  { text: text.slice(3) },
  { type: 'reasoning', text: 'Hidden' },
  { type: 'tool_use', id: 'fake', name: 'work', text: 'Hidden', input: {} },
];
const ai = (content: unknown) => ({
  type: 'ai',
  id: 'answer',
  content,
  reasoning: 'Separate',
});
const frame = (content: unknown): StreamEvent => ({
  type: 'values',
  data: { messages: [ai(content)] },
});
const delta = (content: unknown): StreamEvent => ({
  type: 'messages',
  messageMetadata: {},
  messages: [{ ...ai(content), type: 'AIMessageChunk' }],
});

describe('visible text through actual session ownership', () => {
  it('captures an accepted text getter once through terminal session publication', async () => {
    const f = controlledSession();
    cleanups.push(() => f.session.dispose());
    const run = f.session.submit('Go');
    await f.started();
    let reads = 0;
    await f.emit(
      frame([
        {
          type: 'output_text',
          get text() {
            if (++reads > 1) throw new Error('terminal text reread');
            return 'Captured';
          },
        },
      ])
    );
    f.streams[0].finish();
    expect(await run).toBe('success');
    expect(f.session.getSnapshot().messages.at(-1)).toMatchObject({
      content: 'Captured',
      delivery: { phase: 'complete', outcome: 'success' },
    });
    expect(reads).toBe(1);
    expect(f.stream).toHaveBeenCalledOnce();
    expect(f.getHistory).not.toHaveBeenCalled();
  });

  it.each(['Short', ''])(
    'preserves repeated deltas and answer prefix snapshots before canonical %j publication',
    async (finalText) => {
      const f = controlledSession();
      cleanups.push(() => f.session.dispose());
      const run = f.session.submit('Go');
      await f.started();
      await f.emit(delta(mixed('A')));
      await f.emit(delta(mixed('A')));
      await f.emit(delta(mixed('AA')));
      expect(f.session.getSnapshot().messages.at(-1)?.content).toBe('AAAA');
      await f.emit(frame(mixed('A')));
      expect(f.session.getSnapshot().messages.at(-1)?.content).toBe('AAAA');
      await f.emit(frame(mixed('')));
      expect(f.session.getSnapshot().messages.at(-1)?.content).toBe('AAAA');
      const raw = { type: 'output_text', text: finalText };
      await f.emit(frame([raw]));
      raw.text = 'Mutated after ingress';
      f.streams[0].finish();
      expect(await run).toBe('success');
      const final = f.session.getSnapshot();
      expect(final.messages.at(-1)).toMatchObject({
        id: 'answer',
        content: finalText,
        delivery: { phase: 'complete', outcome: 'success' },
      });
      f.streams[0].release(delta(mixed('Late')));
      await Promise.resolve();
      expect(f.session.getSnapshot()).toBe(final);
      expect(f.stream).toHaveBeenCalledOnce();
      expect(f.getHistory).not.toHaveBeenCalled();
    }
  );

  it.each(['plain', 'mixed'] as const)(
    'keeps %s baseline echoes inert and settles real tool receipts by role and ID',
    async (shape) => {
      const content = shape === 'plain' ? (text: string) => text : mixed;
      const echoed = shape === 'plain' ? mixed : (text: string) => text;
      const historic = {
        ...ai(content('Saved')),
        tool_calls: [{ id: 'old', name: 'work', args: {} }],
      };
      const receipt = {
        type: 'ToolMessage',
        id: 'receipt',
        tool_call_id: 'old',
        content: content('Received'),
        reasoning: 'Separate',
      };
      const handler = vi.fn(() => 'must not execute');
      const getHistory = vi.fn(async () => [
        saved('history', [historic, receipt]),
      ]);
      const stream = vi.fn<AgentTransport['stream']>(async function* (
        _a,
        _t,
        input
      ) {
        yield {
          type: 'values',
          data: {
            messages: [
              { ...historic, content: echoed('Saved') },
              { ...receipt, content: echoed('Received') },
              ...(input as { messages: unknown[] }).messages,
              { ...ai(echoed('Fresh')), id: 'fresh' },
            ],
          },
        };
      });
      const session = createSession({
        assistantId: 'agent',
        threadId: 'thread',
        transport: { stream, getHistory },
        tools: { work: { description: 'Work', handler } },
      });
      cleanups.push(() => session.dispose());
      await session.load!();
      const before = session.getSnapshot();
      expect(before.messages.map((m) => [m.id, m.content])).toEqual([
        ['answer', 'Saved'],
        ['receipt', 'Received'],
      ]);
      // Registered catalogs expose pending calls, never adopt historical string results.
      expect(before.toolCalls).toEqual([]);
      expect(await session.submit('Go')).toBe('success');
      const after = session.getSnapshot();
      expect(after.messages[0]).toBe(before.messages[0]);
      expect(after.messages[1]).toBe(before.messages[1]);
      expect(after.messages.at(-1)).toMatchObject({
        id: 'fresh',
        content: 'Fresh',
        delivery: { phase: 'complete', outcome: 'success' },
      });
      expect(after.toolCalls).toEqual([]);
      expect(handler).not.toHaveBeenCalled();
      expect(stream).toHaveBeenCalledOnce();
      expect(getHistory).toHaveBeenCalledOnce();
    }
  );

  it.each(['plain', 'mixed'] as const)(
    'keeps %s resumed pending-call admission and follow-up counts unchanged',
    async (shape) => {
      const content = shape === 'plain' ? (text: string) => text : mixed;
      const echoed = shape === 'plain' ? mixed : (text: string) => text;
      const pending = {
        ...ai(content('Waiting')),
        tool_calls: [{ id: 'pending', name: 'work', args: { amount: 2 } }],
      };
      const handler = vi.fn(() => 'Result');
      const getHistory = vi.fn(async () => [
        saved(
          'paused',
          [{ type: 'human', id: 'user', content: 'Question' }, pending],
          {
            next: ['approval'],
            tasks: [
              {
                id: 'task',
                name: 'approval',
                interrupts: [{ id: 'approve', value: 'Continue?' }],
              },
            ],
          }
        ),
      ]);
      const stream = vi.fn<AgentTransport['stream']>(async function* (
        _a,
        _t,
        input
      ) {
        yield input === null
          ? {
              type: 'values',
              data: { messages: [{ ...pending, content: echoed('Waiting') }] },
            }
          : frame(echoed('Done'));
      });
      const session = createSession({
        assistantId: 'agent',
        threadId: 'thread',
        transport: { stream, getHistory },
        tools: { work: { description: 'Work', handler } },
      });
      cleanups.push(() => session.dispose());
      await session.load!();
      const paused = session.getSnapshot();
      expect(paused.messages.at(-1)?.content).toBe('Waiting');
      expect(await session.resume(true)).toBe('success');
      expect(
        session.getSnapshot().messages.filter((m) => m.role === 'assistant')
      ).toMatchObject([
        {
          id: 'answer',
          content: 'Done',
          delivery: { phase: 'complete', outcome: 'success' },
        },
      ]);
      expect(
        session.getSnapshot().messages.at(-1)?.delivery.generation
      ).not.toBe(paused.messages.at(-1)?.delivery.generation);
      expect(
        session.getSnapshot().toolCalls.map((c) => [c.id, c.status])
      ).toEqual([['pending', 'complete']]);
      expect(handler).toHaveBeenCalledExactlyOnceWith(
        { amount: 2 },
        expect.anything()
      );
      expect(stream).toHaveBeenCalledTimes(2);
      expect(stream.mock.calls[0][2]).toBeNull();
      expect(stream.mock.calls[0][4]).toMatchObject({
        command: { resume: true },
      });
      expect(stream.mock.calls[1][2]).toMatchObject({
        messages: [
          { type: 'tool', tool_call_id: 'pending', content: 'Result' },
        ],
      });
      expect(getHistory).toHaveBeenCalledOnce();
    }
  );
});
