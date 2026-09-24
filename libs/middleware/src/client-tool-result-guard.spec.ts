import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { describe, expect, it, vi } from 'vitest';
import { createInMemoryClientToolExecutionStore } from './langgraph/client-tool-execution-store';
import type { ClientToolExecutionRecord, ClientToolExecutionStore } from './langgraph/client-tool-execution-store';
import {
  extractClientToolResultMessages,
  filterDuplicateClientToolResultMessages,
  lookupClientToolExecutions,
  recordClientToolResults,
} from './langgraph/client-tool-result-guard';

describe('extractClientToolResultMessages', () => {
  it('extracts tool_call_id from a LangChain ToolMessage', () => {
    const [entry] = extractClientToolResultMessages([
      new ToolMessage({ content: '{"temp":72}', tool_call_id: 'call-1' }),
    ]);

    expect(entry).toEqual({
      toolCallId: 'call-1',
      result: { ok: true, value: { temp: 72 } },
    });
  });

  it('converts error content to an error result', () => {
    const [entry] = extractClientToolResultMessages([
      new ToolMessage({ content: 'Error: boom', tool_call_id: 'call-err' }),
    ]);

    expect(entry.result).toEqual({ ok: false, error: 'boom' });
  });

  it('converts plain text content to an ok string result', () => {
    const [entry] = extractClientToolResultMessages([
      new ToolMessage({ content: 'plain text', tool_call_id: 'call-text' }),
    ]);

    expect(entry.result).toEqual({ ok: true, value: 'plain text' });
  });

  it('ignores non-tool messages and tool messages without an id', () => {
    expect(extractClientToolResultMessages([
      new HumanMessage('hi'),
      new AIMessage('hello'),
      new ToolMessage({ content: 'x', tool_call_id: '' }),
    ])).toEqual([]);
  });
});

describe('recordClientToolResults', () => {
  it.each<ClientToolExecutionRecord>([
    { status: 'executing' },
    { status: 'failed' },
    { status: 'failed', result: { ok: false, error: 'original failure' } },
  ])('does not settle an observed $status record or process later receipts', async (prior) => {
    const store: ClientToolExecutionStore = {
      claim: vi.fn(async () => prior),
      record: vi.fn(async () => undefined),
      lookup: vi.fn(async () => ({})),
    };
    await expect(recordClientToolResults({
      threadId: 'thread-1', store,
      messages: [
        new ToolMessage({ content: 'foreign receipt', tool_call_id: 'owned-call' }),
        new ToolMessage({ content: 'later receipt', tool_call_id: 'later-call' }),
      ],
    })).rejects.toThrow('Client tool result cannot settle an unowned execution: owned-call');
    expect(store.claim).toHaveBeenCalledExactlyOnceWith({ threadId: 'thread-1', toolCallId: 'owned-call' });
    expect(store.record).not.toHaveBeenCalled();
    expect(store.lookup).not.toHaveBeenCalled();
  });

  it('preserves earlier receipts when a later receipt has no settlement authority', async () => {
    const store = createInMemoryClientToolExecutionStore();
    await store.claim({ threadId: 'thread-1', toolCallId: 'owned-call' });
    await expect(recordClientToolResults({
      threadId: 'thread-1', store,
      messages: [
        new ToolMessage({ content: 'first receipt', tool_call_id: 'fresh-call' }),
        new ToolMessage({ content: 'foreign receipt', tool_call_id: 'owned-call' }),
        new ToolMessage({ content: 'later receipt', tool_call_id: 'later-call' }),
      ],
    })).rejects.toThrow('Client tool result cannot settle an unowned execution: owned-call');
    expect(await store.lookup('thread-1', ['fresh-call', 'owned-call', 'later-call'])).toEqual({
      'fresh-call': { status: 'done', result: { ok: true, value: 'first receipt' } },
      'owned-call': { status: 'executing' },
    });
  });

  it('propagates claim failures without recording or consulting lookup', async () => {
    const failure = new Error('claim unavailable');
    const store: ClientToolExecutionStore = {
      claim: vi.fn(async () => { throw failure; }),
      record: vi.fn(async () => undefined),
      lookup: vi.fn(async () => ({})),
    };
    await expect(recordClientToolResults({
      threadId: 'thread-1', store,
      messages: [new ToolMessage({ content: 'receipt', tool_call_id: 'call-1' })],
    })).rejects.toBe(failure);
    expect(store.record).not.toHaveBeenCalled();
    expect(store.lookup).not.toHaveBeenCalled();
  });

  it.each([false, true])('does not convert rejected record acknowledgement to success (accepted: %s)', async (accepted) => {
    const backing = createInMemoryClientToolExecutionStore();
    const failure = new Error('record acknowledgement unavailable');
    const record = vi.fn<ClientToolExecutionStore['record']>(async (key, result) => {
      if (accepted) await backing.record(key, result);
      throw failure;
    });
    await expect(recordClientToolResults({
      threadId: 'thread-1', store: { ...backing, record },
      messages: [
        new ToolMessage({ content: 'receipt', tool_call_id: 'call-1' }),
        new ToolMessage({ content: 'later receipt', tool_call_id: 'later-call' }),
      ],
    })).rejects.toBe(failure);
    expect(record).toHaveBeenCalledTimes(1);
    expect(await backing.lookup('thread-1', ['call-1', 'later-call'])).toEqual({
      'call-1': accepted
        ? { status: 'done', result: { ok: true, value: 'receipt' } }
        : { status: 'executing' },
    });
  });

  it('claims and records first-seen result ids', async () => {
    const store = createInMemoryClientToolExecutionStore();
    const messages = [new ToolMessage({ content: '{"ok":true}', tool_call_id: 'call-1' })];

    await expect(recordClientToolResults({
      threadId: 'thread-1',
      messages,
      store,
    })).resolves.toEqual({
      recordedToolCallIds: ['call-1'],
      duplicateToolCallIds: [],
    });

    await expect(store.lookup('thread-1', ['call-1'])).resolves.toEqual({
      'call-1': { status: 'done', result: { ok: true, value: { ok: true } } },
    });
  });

  it('reports duplicate done ids without overwriting the first result', async () => {
    const store = createInMemoryClientToolExecutionStore();
    const first = [new ToolMessage({ content: '{"first":true}', tool_call_id: 'call-1' })];
    const second = [new ToolMessage({ content: '{"second":true}', tool_call_id: 'call-1' })];

    await recordClientToolResults({ threadId: 'thread-1', messages: first, store });

    await expect(recordClientToolResults({
      threadId: 'thread-1',
      messages: second,
      store,
    })).resolves.toEqual({
      recordedToolCallIds: [],
      duplicateToolCallIds: ['call-1'],
    });

    await expect(store.lookup('thread-1', ['call-1'])).resolves.toEqual({
      'call-1': { status: 'done', result: { ok: true, value: { first: true } } },
    });
  });
});

describe('filterDuplicateClientToolResultMessages', () => {
  it('removes only duplicate tool-result messages and keeps order for the rest', () => {
    const human = new HumanMessage('hi');
    const duplicate = new ToolMessage({ content: 'dup', tool_call_id: 'call-1' });
    const fresh = new ToolMessage({ content: 'fresh', tool_call_id: 'call-2' });

    expect(filterDuplicateClientToolResultMessages({
      messages: [human, duplicate, fresh],
      duplicateToolCallIds: new Set(['call-1']),
    })).toEqual([human, fresh]);
  });
});

describe('lookupClientToolExecutions', () => {
  it('delegates reload reconciliation to the store lookup', async () => {
    const store = createInMemoryClientToolExecutionStore();
    await recordClientToolResults({
      threadId: 'thread-1',
      messages: [new ToolMessage({ content: '{"done":true}', tool_call_id: 'call-1' })],
      store,
    });

    await expect(lookupClientToolExecutions({
      threadId: 'thread-1',
      toolCallIds: ['call-1', 'missing'],
      store,
    })).resolves.toEqual({
      'call-1': { status: 'done', result: { ok: true, value: { done: true } } },
    });
  });
});
