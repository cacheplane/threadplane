import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createMarkdown,
  type MarkdownDocument,
} from '@threadplane/content/markdown';
import type { Message } from '@threadplane/core';
import { createMessageContent } from './message-content.js';
import type { ApplicationToolCall } from './trip-summary.js';

function countedMarkdown() {
  const created: MarkdownDocument[] = [];
  const updated: MarkdownDocument[] = [];
  let disposed = 0;
  const factory: typeof createMarkdown = (document, options) => {
    assert.deepEqual(options, { violationPolicy: 'rebuild' });
    created.push(document);
    const owner = createMarkdown(document, options);
    return {
      ...owner,
      update(next) {
        updated.push(next);
        owner.update(next);
      },
      dispose() {
        disposed++;
        owner.dispose();
      },
    };
  };
  return {
    factory,
    created,
    updated,
    get disposed() {
      return disposed;
    },
  };
}
function message(
  content: string,
  phase: 'streaming' | 'complete' = 'streaming',
  generation = 'exact-runtime-generation',
  id = 'answer'
): Message {
  return Object.freeze({
    id,
    role: 'assistant',
    content,
    delivery: Object.freeze(
      phase === 'complete'
        ? { generation, phase, outcome: 'success' }
        : { generation, phase }
    ),
  });
}
function frozen(value: unknown) {
  if (!value || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) frozen(child);
}

test('message content creates real Markdown with exact delivery, appends, and finishes without changing text', () => {
  const work = countedMarkdown();
  const content = createMessageContent(work.factory);
  assert.deepEqual(work.created, []);
  content.update([message('Hello **world')], []);
  assert.equal(work.created.length, 1);
  const partial = content.getSnapshot();
  const retained = JSON.stringify(partial);
  assert.deepEqual(partial[0].markdown.document, {
    generation: 'exact-runtime-generation',
    phase: 'streaming',
    content: 'Hello **world',
  });
  assert.ok(partial[0].markdown.root);
  content.update([message('Hello **world**')], []);
  const appended = content.getSnapshot()[0].markdown;
  content.update([message('Hello **world**', 'complete')], []);
  assert.equal(work.updated.length, 2);
  const complete = content.getSnapshot()[0];
  assert.equal(complete.markdown.document.phase, 'complete');
  assert.notStrictEqual(complete.markdown, appended);
  assert.match(JSON.stringify(complete.markdown.root), /strong/);
  assert.equal(JSON.stringify(partial), retained);
  frozen(partial);
  frozen(content.getSnapshot());
  content.dispose();
  assert.equal(work.disposed, 1);
  assert.equal(JSON.stringify(partial), retained);
});

test('message content skips equal document values and updates tool observations without parser work', () => {
  const work = countedMarkdown();
  const content = createMessageContent(work.factory);
  const input: Message = Object.freeze({
    ...message('Searching', 'complete'),
    toolCallIds: Object.freeze(['call']),
  });
  const pending: ApplicationToolCall = Object.freeze({
    id: 'call',
    name: 'show_trip_summary',
    args: Object.freeze({ title: 'Found', days: Object.freeze([]) }),
    status: 'pending',
  });
  content.update([input], [pending]);
  const initial = content.getSnapshot();
  assert.equal(initial.length, 1);
  assert.deepEqual(initial[0].tripSummaries, []);
  for (let i = 0; i < 3; i++)
    content.update([{ ...input, delivery: { ...input.delivery } }], [pending]);
  assert.strictEqual(content.getSnapshot()[0].markdown, initial[0].markdown);
  assert.deepEqual(work.updated, []);
  const complete: ApplicationToolCall = Object.freeze({
    ...pending,
    status: 'complete',
    result: 'Found',
  });
  content.update([input], [complete]);
  const next = content.getSnapshot();
  assert.strictEqual(next[0].markdown, initial[0].markdown);
  assert.deepEqual(next[0].toolCalls, [complete]);
  assert.deepEqual(initial[0].toolCalls, [pending]);
  assert.equal(next[0].tripSummaries[0].text, 'Found');
  assert.deepEqual(work.updated, []);
  assert.equal('update' in next[0], false);
  assert.equal('dispose' in next[0], false);
  assert.strictEqual(next[0].message, input);
  content.update([input], [{ ...pending, status: 'error', error: 'Failed' }]);
  assert.deepEqual(content.getSnapshot()[0].tripSummaries, []);
  assert.equal(next[0].tripSummaries[0].text, 'Found');
  content.dispose();
});

test('message content rebuilds canonical corrections and replaces history generations through the real owner', () => {
  const work = countedMarkdown();
  const content = createMessageContent(work.factory);
  content.update([message('## Original', 'complete')], []);
  const old = content.getSnapshot();
  assert.equal(old.length, 1);
  const retained = JSON.stringify(old);
  content.update([message('# Canonical correction', 'complete')], []);
  assert.equal(work.created.length, 1);
  assert.equal(work.updated.length, 1);
  assert.match(
    JSON.stringify(content.getSnapshot()[0].markdown.root),
    /Canonical correction/
  );
  content.update(
    [message('> Replaced history', 'complete', 'history-generation')],
    []
  );
  assert.equal(work.updated.length, 2);
  assert.equal(
    content.getSnapshot()[0].markdown.document.generation,
    'history-generation'
  );
  assert.match(
    JSON.stringify(content.getSnapshot()[0].markdown.root),
    /blockquote/
  );
  assert.equal(JSON.stringify(old), retained);
  content.dispose();
});

test('message content removal disposes once and reused IDs and generations get new owners', () => {
  const work = countedMarkdown();
  const content = createMessageContent(work.factory);
  content.update(
    [message('First'), message('Second', 'complete', 'other', 'second')],
    []
  );
  assert.equal(work.created.length, 2);
  const first = content.getSnapshot()[0].markdown;
  content.update([message('Second', 'complete', 'other', 'second')], []);
  assert.equal(work.disposed, 1);
  content.update(
    [message('First'), message('Second', 'complete', 'other', 'second')],
    []
  );
  assert.equal(work.created.length, 3);
  assert.notStrictEqual(content.getSnapshot()[0].markdown, first);
  const last = content.getSnapshot();
  content.dispose();
  content.dispose();
  assert.equal(work.disposed, 3);
  assert.strictEqual(content.getSnapshot(), last);
  const replacement = createMessageContent(work.factory);
  replacement.update([message('First')], []);
  assert.notStrictEqual(replacement.getSnapshot()[0].markdown, first);
  assert.notStrictEqual(
    replacement.getSnapshot()[0].markdown,
    last[0].markdown
  );
  replacement.dispose();
});

test('summary cards belong only to assistant calls and cache complete object identity across publications', () => {
  const work = countedMarkdown();
  const content = createMessageContent(work.factory);
  const input = Object.freeze({
    ...message('Summary', 'complete'),
    toolCallIds: Object.freeze(['one', 'two']),
  });
  const tool: Message = Object.freeze({
    ...message('Readable result', 'complete', 'tool-generation', 'result'),
    role: 'tool',
    toolCallId: 'one',
  });
  const call: ApplicationToolCall = Object.freeze({
    id: 'one',
    name: 'show_trip_summary',
    args: Object.freeze({ title: ' First ', days: Object.freeze([]) }),
    status: 'complete',
    result: 'First',
  });
  const second: ApplicationToolCall = Object.freeze({ ...call, id: 'two' });
  content.update([input, tool], [call, second]);
  const initial = content.getSnapshot();
  assert.ok(
    'tripSummaries' in initial[0],
    'Assistant row exposes authored summaries'
  );
  assert.ok('tripSummaries' in initial[1]);
  assert.deepEqual(initial[1].tripSummaries, []);
  assert.equal(initial[0].tripSummaries.length, 2);
  content.update([input, tool], [call, second]);
  assert.strictEqual(content.getSnapshot(), initial);
  content.update([{ ...input }, tool], [call, second]);
  assert.strictEqual(
    content.getSnapshot()[0].tripSummaries[0],
    initial[0].tripSummaries[0]
  );
  const replacement: ApplicationToolCall = Object.freeze({
    ...call,
    args: Object.freeze({ title: 'Replacement', days: Object.freeze([]) }),
    result: 'Replacement',
  });
  content.update([input, tool], [replacement, second]);
  const replaced = content.getSnapshot()[0];
  assert.ok('tripSummaries' in replaced);
  assert.notStrictEqual(replaced.tripSummaries[0], initial[0].tripSummaries[0]);
  assert.strictEqual(replaced.markdown, initial[0].markdown);
  const retained = JSON.stringify(initial);
  content.update([], []);
  assert.equal(work.disposed, 2);
  assert.equal(JSON.stringify(initial), retained);
  frozen(initial);
  content.dispose();
});
