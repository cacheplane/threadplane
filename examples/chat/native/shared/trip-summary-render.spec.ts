import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatTripSummary, type ApplicationToolCall } from './trip-summary.js';
import { prepareTripSummaryRender } from './trip-summary-render.js';
import { createMessageContent } from './message-content.js';
import type { Message } from '@threadplane/core';

test('trip render preparation owns a frozen tree with literal data and absolute place repeats', () => {
  const card = Object.freeze({
    callId: 'call',
    ...formatTripSummary({
      title: ' <b>City</b> ',
      days: [
        { day: 2, places: [' Museum ', ' Park '] },
        { day: 3, places: [] },
      ],
      note: ' Walk ',
    }),
  });
  const before = JSON.stringify(card);
  const prepared = prepareTripSummaryRender(card);
  assert.equal(prepared.callId, 'call');
  assert.equal(prepared.state.title, '<b>City</b>');
  assert.equal(prepared.state.counts, '2 days · 2 stops');
  assert.equal(prepared.state.note, 'Walk');
  assert.equal(prepared.state.hasNote, true);
  assert.deepEqual(prepared.state.places, [['Museum', 'Park'], []]);
  assert.equal(
    prepared.spec.elements['places-0'].repeat?.statePath,
    '/places/0'
  );
  assert.equal(
    prepared.spec.elements['places-1'].repeat?.statePath,
    '/places/1'
  );
  assert.equal(prepared.spec.elements['day-0'].props['label'], 'Day 2');
  assert.equal(Object.isFrozen(prepared), true);
  assert.equal(Object.isFrozen(prepared.spec.elements['day-0'].props), true);
  assert.equal(Object.isFrozen(prepared.state.places[0]), true);
  assert.equal(JSON.stringify(card), before);
});
test('trip render preparation distinguishes empty days, stops and an explicitly empty note', () => {
  const noNote = prepareTripSummaryRender({
    callId: 'none',
    ...formatTripSummary({ title: 'Empty', days: [] }),
  });
  assert.equal(noNote.state.emptyDays, true);
  assert.equal(noNote.state.counts, '0 days · 0 stops');
  assert.equal(noNote.state.hasNote, false);
  const emptyNote = prepareTripSummaryRender({
    callId: 'one',
    ...formatTripSummary({
      title: 'One',
      days: [{ day: 1, places: [] }],
      note: '',
    }),
  });
  assert.equal(emptyNote.state.counts, '1 day · 0 stops');
  assert.equal(emptyNote.state.hasNote, true);
  assert.equal(emptyNote.state.note, '');
  assert.equal(emptyNote.spec.elements['day-0'].props['empty'], true);
});
test('application message preparation caches render entries without changing cards or owner lifetimes', () => {
  const content = createMessageContent();
  const args = Object.freeze({
    title: 'Trip',
    days: Object.freeze([{ day: 1, places: Object.freeze(['Museum']) }]),
  });
  const calls: readonly ApplicationToolCall[] = Object.freeze([
    {
      id: 'call',
      name: 'show_trip_summary',
      args,
      status: 'complete',
      result: 'Trip\nDay 1: Museum',
    },
  ]);
  const messages: readonly Message[] = Object.freeze([
    {
      id: 'message',
      role: 'assistant',
      content: 'Result',
      delivery: { generation: 'saved', phase: 'complete', outcome: 'success' },
      toolCallIds: Object.freeze(['call']),
    },
  ]);
  content.update(messages, calls);
  const original = content.getSnapshot()[0];
  const prepared = original.tripSummaryRenders[0];
  const card = original.tripSummaries[0];
  assert.equal(prepared.callId, card.callId);
  assert.equal(Object.hasOwn(card, 'spec'), false);
  content.update(messages, calls);
  assert.strictEqual(content.getSnapshot()[0], original);
  content.update([{ ...messages[0], content: 'Changed' }], calls);
  const changed = content.getSnapshot()[0];
  assert.notStrictEqual(changed, original);
  assert.strictEqual(changed.tripSummaries[0], card);
  assert.strictEqual(changed.tripSummaryRenders[0], prepared);
  content.update([], []);
  content.dispose();
  assert.equal(prepared.state.title, 'Trip');
  assert.equal(original.tripSummaryRenders[0].state.places[0][0], 'Museum');
});
