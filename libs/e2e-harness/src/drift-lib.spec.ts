import { test } from 'vitest';
import assert from 'node:assert/strict';
import { summarizeEntry, diffFixtures, type FixtureEntry } from './drift-lib';

const text = (msg: string, content: string): FixtureEntry => ({
  match: { userMessage: msg },
  response: { content },
});
const tool = (msg: string, names: string[]): FixtureEntry => ({
  match: { userMessage: msg },
  response: { toolCalls: names.map((name) => ({ name, arguments: {} })) },
});

test('summarizeEntry: text response', () => {
  const s = summarizeEntry(text('hi', 'hello there'));
  assert.equal(s.kind, 'text');
  assert.deepEqual(s.toolNames, []);
  assert.equal(typeof s.lengthBucket, 'number');
});

test('summarizeEntry: toolCalls response', () => {
  const s = summarizeEntry(tool('plan', ['research', 'book']));
  assert.equal(s.kind, 'toolCalls');
  assert.deepEqual(s.toolNames, ['book', 'research']); // sorted
});

test('diffFixtures: identical pair reports no differences', () => {
  const d = diffFixtures([text('hi', 'hello')], [text('hi', 'hello world')]);
  assert.equal(d.changed.length, 0); // same kind, same tools, same bucket
});

test('diffFixtures: tool set change is reported', () => {
  const d = diffFixtures([tool('plan', ['research'])], [tool('plan', ['book'])]);
  assert.equal(d.changed.length, 1);
  assert.match(d.changed[0].reason, /toolNames/);
});

test('diffFixtures: kind change is reported', () => {
  const d = diffFixtures([tool('plan', ['research'])], [text('plan', 'sure!')]);
  assert.equal(d.changed.length, 1);
  assert.match(d.changed[0].reason, /kind/);
});

test('diffFixtures: incomplete recording is reported separately, not as drift', () => {
  // The aimock recorder emits { content: "" } when it cannot parse tool-call
  // deltas from a stream; that is a recorder artifact, not model drift.
  const d = diffFixtures([tool('plan', ['research'])], [text('plan', '')]);
  assert.equal(d.changed.length, 0);
  assert.deepEqual(d.incompleteRecordings, ['plan||']);
});

test('diffFixtures: unpairable entries are listed, not errored', () => {
  const d = diffFixtures([text('only-committed', 'x')], [text('only-recorded', 'y')]);
  assert.deepEqual(d.unmatchedCommitted, ['only-committed||']);
  assert.deepEqual(d.unmatchedRecorded, ['only-recorded||']);
});

const withMeta = (e: FixtureEntry, metadata: Record<string, string>): FixtureEntry => ({ ...e, metadata });

test('diffFixtures: matching metadata hashes report no prompt change', () => {
  const meta = { systemHash: 'aaaa1111', toolsHash: 'bbbb2222' };
  const d = diffFixtures([withMeta(text('hi', 'hello'), meta)], [withMeta(text('hi', 'hello world'), meta)]);
  assert.equal(d.promptChanged.length, 0);
  assert.equal(d.changed.length, 0);
});

test('diffFixtures: changed systemHash is bucketed as promptChanged, not changed', () => {
  const d = diffFixtures(
    [withMeta(text('hi', 'hello'), { systemHash: 'aaaa1111', toolsHash: 'bbbb2222' })],
    [withMeta(text('hi', 'hello there'), { systemHash: 'cccc3333', toolsHash: 'bbbb2222' })]
  );
  assert.equal(d.promptChanged.length, 1);
  assert.match(d.promptChanged[0].reason, /systemHash: aaaa1111 -> cccc3333/);
  assert.doesNotMatch(d.promptChanged[0].reason, /toolsHash/);
  assert.equal(d.changed.length, 0);
});

test('diffFixtures: changed toolsHash only is reported as promptChanged', () => {
  const d = diffFixtures(
    [withMeta(tool('plan', ['research']), { systemHash: 'aaaa1111', toolsHash: 'bbbb2222' })],
    [withMeta(tool('plan', ['research']), { systemHash: 'aaaa1111', toolsHash: 'dddd4444' })]
  );
  assert.equal(d.promptChanged.length, 1);
  assert.match(d.promptChanged[0].reason, /toolsHash: bbbb2222 -> dddd4444/);
  assert.doesNotMatch(d.promptChanged[0].reason, /systemHash/);
});

test('diffFixtures: absent metadata on either side is never a prompt change', () => {
  // committed has metadata, recorded does not — and vice versa — and neither has any
  const d = diffFixtures(
    [
      withMeta(text('a', 'x'), { systemHash: 'aaaa1111' }),
      text('b', 'x'),
      text('c', 'x'),
    ],
    [
      text('a', 'x'),
      withMeta(text('b', 'x'), { systemHash: 'eeee5555' }),
      text('c', 'x'),
    ]
  );
  assert.equal(d.promptChanged.length, 0);
});

test('diffFixtures: structural drift and prompt change are reported independently', () => {
  const d = diffFixtures(
    [withMeta(tool('plan', ['research']), { systemHash: 'aaaa1111' })],
    [withMeta(tool('plan', ['book']), { systemHash: 'cccc3333' })]
  );
  assert.equal(d.changed.length, 1);
  assert.equal(d.promptChanged.length, 1);
});

test('summarizeEntry: recorder-only fields do not move the length bucket', () => {
  const committed = text('say hi briefly', 'Hi! How can I help?');
  const recorded: FixtureEntry = {
    match: { userMessage: 'say hi briefly' },
    response: { content: 'Hi!', reasoning: 'x'.repeat(500), recordedTimings: { ttftMs: 393 } },
  };
  assert.equal(diffFixtures([committed], [recorded]).changed.length, 0);
  const longer: FixtureEntry = { ...recorded, response: { content: 'x'.repeat(500) } };
  assert.equal(diffFixtures([committed], [longer]).changed.length, 1, 'a longer answer still drifts');
});
