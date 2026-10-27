import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from '@threadplane/core';
import type { A2uiMessage } from '@threadplane/a2ui';
import { createA2uiSurfaces } from '@threadplane/content/a2ui';
import { createMarkdown } from '@threadplane/content/markdown';
import { createMessageContent } from '../../shared/message-content.js';
import type { ApplicationToolCall } from '../../shared/trip-summary.js';
import { projectTripSurface } from './a2ui-trip-catalog.js';
import { createA2uiMessageContent } from './a2ui-message-content.js';

function message(
  id = 'answer',
  generation = 'generation',
  ids = ['a', 'b']
): Message {
  return Object.freeze({
    id,
    role: 'assistant',
    content: 'Hello **world**',
    reasoning: 'Some *reasoning*',
    toolCallIds: Object.freeze(ids),
    delivery: Object.freeze({
      generation,
      phase: 'complete',
      outcome: 'success',
    }),
  });
}
function call(
  id = 'a',
  title = 'Trip',
  places = ['A', 'B']
): ApplicationToolCall {
  return Object.freeze({
    id,
    name: 'show_trip_summary',
    status: 'complete',
    result: title,
    args: Object.freeze({
      title,
      days: Object.freeze([
        Object.freeze({ day: 1, places: Object.freeze(places) }),
      ]),
    }),
  });
}
function work() {
  const owners: {
    raw: ReturnType<typeof createA2uiSurfaces>;
    applied: A2uiMessage[];
    disposed: number;
  }[] = [];
  let failAt = Infinity,
    applications = 0;
  return {
    owners,
    get applications() {
      return applications;
    },
    failAfter(count: number) {
      failAt = applications + count;
    },
    recover() {
      failAt = Infinity;
    },
    factory() {
      const entry = {
        raw: createA2uiSurfaces(),
        applied: [] as A2uiMessage[],
        disposed: 0,
      };
      owners.push(entry);
      return {
        getSnapshot: entry.raw.getSnapshot,
        apply(envelope: A2uiMessage) {
          applications++;
          if (applications === failAt)
            throw new Error('injected apply failure');
          entry.applied.push(envelope);
          entry.raw.apply(envelope);
        },
        dispose() {
          entry.disposed++;
          entry.raw.dispose();
        },
      };
    },
  };
}

test('A2UI message content default composition produces literal prepared output through the installed owner', () => {
  const content = createA2uiMessageContent();
  content.update([message()], [call('a', '<b>literal</b>')]);
  const prepared = content.getSnapshot()[0].a2uiTripSummaryRenders[0];
  assert.equal(prepared.spec.elements['root'].props['title'], '<b>literal</b>');
  assert.deepEqual(Object.keys(prepared), ['callId', 'spec', 'state']);
  assert.ok(Object.isFrozen(content.getSnapshot()));
  assert.ok(Object.isFrozen(content.getSnapshot()[0].a2uiTripSummaryRenders));
  content.dispose();
});

// All owner seams wrap the actual installed raw accumulator and expose no subscription.
test('A2UI message content delegates Markdown/reasoning and reuses cards without raw work', () => {
  const w = work();
  let markdownCreated = 0,
    markdownDisposed = 0;
  const content = createA2uiMessageContent({
    ownerFactory: w.factory,
    markdownFactory: (document, options) => {
      markdownCreated++;
      const markdown = createMarkdown(document, options);
      return {
        ...markdown,
        dispose() {
          markdownDisposed++;
          markdown.dispose();
        },
      };
    },
  });
  const m = message(),
    a = call();
  content.update([m], [a]);
  const first = content.getSnapshot();
  assert.equal(first[0].markdown.document.content, m.content);
  assert.equal(first[0].reasoning?.document.content, m.reasoning);
  assert.equal(first[0].tripSummaries[0].text, 'Trip\nDay 1: A → B');
  const prepared = first[0].a2uiTripSummaryRenders[0];
  assert.equal(prepared.spec.elements['place-0-1'].props['text'], 'B');
  assert.equal(w.owners.length, 1);
  assert.equal(w.applications, 2);
  content.update([m], [a]);
  assert.strictEqual(content.getSnapshot(), first);
  content.update(
    [
      m,
      Object.freeze({ ...message('user'), role: 'user', content: 'Unrelated' }),
    ],
    [a]
  );
  assert.strictEqual(content.getSnapshot()[0], first[0]);
  assert.strictEqual(
    content.getSnapshot()[0].a2uiTripSummaryRenders[0],
    prepared
  );
  assert.equal(w.applications, 2);
  assert.ok(Object.isFrozen(prepared.spec.elements['root'].props));
  assert.ok(markdownCreated >= 2);
  const retained = content.getSnapshot();
  content.dispose();
  content.dispose();
  content.update([], []);
  assert.equal(w.owners[0].disposed, 1);
  assert.equal(markdownDisposed, markdownCreated);
  assert.strictEqual(content.getSnapshot(), retained);
  assert.equal(prepared.spec.elements['place-0-1'].props['text'], 'B');
});

test('A2UI message content replaces a changed card with delete/create/full components and removes stale children', () => {
  const w = work(),
    content = createA2uiMessageContent({ ownerFactory: w.factory });
  const m = message();
  content.update([m], [call()]);
  const old = content.getSnapshot();
  content.update([m], [call('a', 'Short', [])]);
  assert.equal(w.owners.length, 1);
  assert.deepEqual(
    w.owners[0].applied
      .slice(2)
      .map((e) => Object.keys(e).find((k) => k !== 'version')),
    ['deleteSurface', 'createSurface', 'updateComponents']
  );
  assert.equal(
    w.owners[0].raw
      .getSnapshot()
      .surfaces[0].components.some((c) => c.id === 'place-0-1'),
    false
  );
  assert.equal(
    content.getSnapshot()[0].a2uiTripSummaryRenders[0].spec.elements[
      'place-0-1'
    ],
    undefined
  );
  assert.equal(
    old[0].a2uiTripSummaryRenders[0].spec.elements['place-0-1'].props['text'],
    'B'
  );
  content.dispose();
});

test('A2UI message content orders current cards and deletes omitted surfaces across multiple messages and calls', () => {
  const w = work(),
    content = createA2uiMessageContent({ ownerFactory: w.factory });
  const m = message(),
    other = message('other', 'generation', ['c']);
  const a = call(),
    b = call('b'),
    c = call('c');
  content.update([m, other], [a, b, c]);
  const aPrepared = content.getSnapshot()[0].a2uiTripSummaryRenders[0];
  content.update([m, other], [b, a, c]);
  assert.deepEqual(
    content.getSnapshot()[0].a2uiTripSummaryRenders.map((p) => p.callId),
    ['b', 'a']
  );
  assert.strictEqual(
    content.getSnapshot()[0].a2uiTripSummaryRenders[1],
    aPrepared
  );
  assert.deepEqual(
    w.owners[0].raw.getSnapshot().surfaces.map((s) => s.surfaceId),
    ['a', 'b']
  );
  content.update([m, other], [a, c]);
  assert.deepEqual(
    w.owners[0].raw.getSnapshot().surfaces.map((s) => s.surfaceId),
    ['a']
  );
  assert.equal(w.owners.length, 2);
  assert.equal(w.owners[1].disposed, 0);
  content.dispose();
  assert.deepEqual(
    w.owners.map((o) => o.disposed),
    [1, 1]
  );
});

for (const transition of [
  'missing',
  'role',
  'no-cards',
  'incomplete',
  'generation',
] as const) {
  test(`A2UI message content retires ${transition} before cached row reuse and recreates fresh owners`, () => {
    const w = work(),
      content = createA2uiMessageContent({ ownerFactory: w.factory });
    const m = message(),
      a = call();
    content.update([m], [a]);
    const first = content.getSnapshot()[0].a2uiTripSummaryRenders[0];
    content.update([message()], [a]); // Equal generation preserves the owner.
    assert.equal(w.owners.length, 1);
    assert.strictEqual(
      content.getSnapshot()[0].a2uiTripSummaryRenders[0],
      first
    );
    if (transition === 'missing') content.update([], [a]);
    if (transition === 'role') content.update([{ ...m, role: 'user' }], [a]);
    if (transition === 'no-cards') content.update([m], []);
    if (transition === 'incomplete')
      content.update([m], [{ ...a, status: 'running' } as ApplicationToolCall]);
    if (transition === 'generation')
      content.update([message('answer', 'replacement')], [a]);
    assert.equal(w.owners[0].disposed, 1);
    content.update([m], [a]);
    assert.notStrictEqual(
      content.getSnapshot()[0].a2uiTripSummaryRenders[0],
      first
    );
    assert.equal(w.owners.length, transition === 'generation' ? 3 : 2);
    content.dispose();
    assert.ok(w.owners.every((o) => o.disposed === 1));
  });
}

for (const failAfter of [1, 3, 4, 5]) {
  test(`A2UI message content discards the entire failed replacement transaction at write ${failAfter}`, () => {
    const w = work(),
      content = createA2uiMessageContent({ ownerFactory: w.factory });
    const m = message(),
      n = message('next', 'generation', ['c']);
    const a = call(),
      b = call('b'),
      c = call('c');
    content.update([m, n], [a, b, c]);
    const accepted = content.getSnapshot();
    const next = [call('a', 'New'), call('b', 'Second'), c];
    w.failAfter(failAfter);
    assert.throws(() => content.update([m, n], next), /injected apply failure/);
    assert.strictEqual(content.getSnapshot(), accepted);
    assert.deepEqual(
      w.owners.map((o) => o.disposed),
      [1, 1]
    );
    w.recover();
    content.update([m, n], next); // Identical accepted base rows/cards must rebuild.
    assert.equal(w.owners.length, 4);
    assert.equal(
      content.getSnapshot()[0].a2uiTripSummaryRenders[0].spec.elements['root']
        .props['title'],
      'New'
    );
    assert.notStrictEqual(content.getSnapshot()[1], accepted[1]);
    content.dispose();
    assert.ok(w.owners.every((o) => o.disposed === 1));
  });
}

test('A2UI message content cleans provisional owners on initial apply failure and recovers identical input', () => {
  const w = work(),
    content = createA2uiMessageContent({ ownerFactory: w.factory });
  const m = message(),
    a = call();
  const empty = content.getSnapshot();
  w.failAfter(2);
  assert.throws(() => content.update([m], [a]), /injected/);
  assert.strictEqual(content.getSnapshot(), empty);
  assert.equal(w.owners[0].disposed, 1);
  w.recover();
  content.update([m], [a]);
  assert.equal(w.owners.length, 2);
  content.dispose();
  assert.ok(w.owners.every((o) => o.disposed === 1));
});

for (const failure of ['projection', 'base'] as const) {
  test(`A2UI message content retains accepted output on ${failure} failure and keeps shared content alive for recovery`, () => {
    const w = work();
    let fail = false,
      baseDisposed = 0;
    const base = createMessageContent();
    const content = createA2uiMessageContent({
      ownerFactory: w.factory,
      contentFactory: () => ({
        ...base,
        update(messages, calls) {
          base.update(messages, calls);
          if (fail && failure === 'base')
            throw new Error('injected base failure');
        },
        dispose() {
          baseDisposed++;
          base.dispose();
        },
      }),
      projectSurface(surface, callId) {
        if (fail && failure === 'projection')
          throw new Error('injected projection failure');
        return projectTripSurface(surface, callId);
      },
    });
    const m = message(),
      first = call();
    content.update([m], [first]);
    const accepted = content.getSnapshot();
    const replacement = call('a', 'Replacement');
    fail = true;
    assert.throws(() => content.update([m], [replacement]), /injected/);
    assert.strictEqual(content.getSnapshot(), accepted);
    assert.equal(w.owners[0].disposed, 1);
    assert.equal(baseDisposed, 0);
    fail = false;
    content.update([m], [replacement]);
    assert.equal(w.owners.length, 2);
    assert.equal(
      content.getSnapshot()[0].a2uiTripSummaryRenders[0].spec.elements['root']
        .props['title'],
      'Replacement'
    );
    content.dispose();
    content.dispose();
    assert.equal(baseDisposed, 1);
    assert.ok(w.owners.every((o) => o.disposed === 1));
  });
}

test('A2UI message content validates all authored cards before destructive writes', () => {
  const w = work(),
    base = createMessageContent();
  let invalid = false;
  const content = createA2uiMessageContent({
    ownerFactory: w.factory,
    contentFactory: () => ({
      ...base,
      getSnapshot() {
        return invalid
          ? base.getSnapshot().map((row) => ({
              ...row,
              tripSummaries: row.tripSummaries.map((card, index) =>
                index === 1 ? { ...card, title: 1 as unknown as string } : card
              ),
            }))
          : base.getSnapshot();
      },
    }),
  });
  const m = message();
  content.update([m], [call(), call('b')]);
  const accepted = content.getSnapshot(),
    applications = w.applications;
  invalid = true;
  assert.throws(
    () => content.update([m], [call('a', 'Changed'), call('b')]),
    TypeError
  );
  assert.equal(w.applications, applications);
  assert.equal(w.owners[0].disposed, 1);
  assert.strictEqual(content.getSnapshot(), accepted);
  invalid = false;
  content.update([m], [call(), call('b')]);
  assert.equal(w.owners.length, 2);
  content.dispose();
});

test('A2UI message content cleans every provisional message owner on initial projection failure', () => {
  const w = work();
  let fail = true;
  const content = createA2uiMessageContent({
    ownerFactory: w.factory,
    projectSurface(surface, callId) {
      if (fail && callId === 'b')
        throw new Error('injected second projection failure');
      return projectTripSurface(surface, callId);
    },
  });
  const messages = [
    message('one', 'generation', ['a']),
    message('two', 'generation', ['b']),
  ];
  const calls = [call(), call('b')];
  const empty = content.getSnapshot();
  assert.throws(() => content.update(messages, calls), /second projection/);
  assert.deepEqual(
    w.owners.map((o) => o.disposed),
    [1, 1]
  );
  assert.strictEqual(content.getSnapshot(), empty);
  fail = false;
  content.update(messages, calls);
  assert.equal(w.owners.length, 4);
  content.dispose();
  assert.ok(w.owners.every((o) => o.disposed === 1));
});
