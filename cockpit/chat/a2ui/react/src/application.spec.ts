import { describe, expect, it, vi } from 'vitest';
import { createA2uiApplication } from './application';
const wire = [
  '---a2ui_JSON---\n{"version": "v0.9", "createSurface": {"surfaceId": "booking", "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}\n{"version": "v0.9", "updateComponents": {"surfaceId": "booking", "components": [{"id": "root", "component": "Column", "children": ["card"]}, {"id": "card", "component": "Card", "child": "card_col"}, {"id": "card_col", "component": "Column", "children": ["title", "origin", "dest", "date", "passengers", "fare", "submit"]}, {"id": "title", "component": "Text", "text": "Book a flight", "variant": "h2"}, {"id": "origin", "component": "ChoicePicker", "label": "Origin", "options": [{"label": "LAX", "value": "LAX"}, {"label": "JFK", "value": "JFK"}, {"label": "SFO", "value": "SFO"}, {"label": "ORD", "value": "ORD"}, {"label": "BOS", "value": "BOS"}, {"label": "ATL", "value": "ATL"}, {"label": "DFW", "value": "DFW"}, {"label": "SEA", "value": "SEA"}, {"label": "MIA", "value": "MIA"}, {"label": "DEN", "value": "DEN"}], "value": {"path": "/origin"}, "variant": "mutuallyExclusive"}, {"id": "dest", "component": "ChoicePicker", "label": "Destination", "options": [{"label": "LAX", "value": "LAX"}, {"label": "JFK", "value": "JFK"}, {"label": "SFO", "value": "SFO"}, {"label": "ORD", "value": "ORD"}, {"label": "BOS", "value": "BOS"}, {"label": "ATL", "value": "ATL"}, {"label": "DFW", "value": "DFW"}, {"label": "SEA", "value": "SEA"}, {"label": "MIA", "value": "MIA"}, {"label": "DEN", "value": "DEN"}], "value": {"path": "/dest"}, "variant": "mutuallyExclusive"}, {"id": "fare", "component": "ChoicePicker", "label": "Fare class", "options": [{"label": "Economy", "value": "Economy"}, {"label": "Premium", "value": "Premium"}, {"label": "Business", "value": "Business"}, {"label": "First", "value": "First"}], "value": {"path": "/fare_class"}, "variant": "mutuallyExclusive"}, {"id": "date", "component": "DateTimeInput", "label": "Departure date (YYYY-MM-DD)", "value": {"path": "/date"}, "enableDate": true}, {"id": "passengers", "component": "TextField", "label": "Passengers", "value": {"path": "/passengers"}, "variant": "number"}, {"id": "submit", "component": "Button", "child": "submit_label", "variant": "primary", "action": {"event": {"name": "bookingSubmit", "context": {"formId": "booking", "origin": {"path": "/origin"}, "dest": {"path": "/dest"}, "date": {"path": "/date"}, "passengers": {"path": "/passengers"}, "fare_class": {"path": "/fare_class"}}}}}, {"id": "submit_label", "component": "Text", "text": "Search flights"}]}}\n{"version": "v0.9", "updateDataModel": {"surfaceId": "booking", "path": "/", "value": {"origin": ["LAX"], "dest": ["JFK"], "date": "", "passengers": 1, "fare_class": ["Economy"]}}}\n',
  '---a2ui_JSON---\n{"version": "v0.9", "createSurface": {"surfaceId": "results", "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}\n{"version": "v0.9", "updateComponents": {"surfaceId": "results", "components": [{"id": "root", "component": "Column", "children": ["card_0"]}, {"id": "card_0", "component": "Card", "child": "col_0"}, {"id": "col_0", "component": "Column", "children": ["title_0", "route_0", "time_0", "btn_0"]}, {"id": "title_0", "component": "Text", "text": "UA flight UA123", "variant": "h3"}, {"id": "route_0", "component": "Text", "text": "LAX \\u2192 JFK  \\u2022  330 min  \\u2022  Boeing 787", "variant": "body"}, {"id": "time_0", "component": "Text", "text": "Depart 08:00  \\u2022  Arrive 16:30  \\u2022  Gate B14", "variant": "caption"}, {"id": "btn_0", "component": "Button", "child": "btn_label_0", "variant": "primary", "action": {"event": {"name": "flightSelect", "context": {"flightId": "UA123"}}}}, {"id": "btn_label_0", "component": "Text", "text": "Select"}]}}\n',
  '---a2ui_JSON---\n{"version": "v0.9", "createSurface": {"surfaceId": "confirmation", "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}\n{"version": "v0.9", "updateComponents": {"surfaceId": "confirmation", "components": [{"id": "root", "component": "Column", "children": ["card"]}, {"id": "card", "component": "Card", "child": "card_col"}, {"id": "card_col", "component": "Column", "children": ["title", "party_text", "modify"]}, {"id": "title", "component": "Text", "text": "UA flight UA123", "variant": "h2"}, {"id": "party_text", "component": "Text", "text": "2 passengers  \\u2022  Business", "variant": "body"}, {"id": "modify", "component": "Button", "child": "modify_label", "variant": "primary", "action": {"event": {"name": "modifySearch", "context": {"formId": "booking"}}}}, {"id": "modify_label", "component": "Text", "text": "Modify search"}]}}\n',
  '---a2ui_JSON---\n{"version": "v0.9", "createSurface": {"surfaceId": "booking", "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}\n{"version": "v0.9", "updateComponents": {"surfaceId": "booking", "components": [{"id": "root", "component": "Column", "children": ["card"]}, {"id": "card", "component": "Card", "child": "card_col"}, {"id": "card_col", "component": "Column", "children": ["title", "origin", "dest", "date", "passengers", "fare", "submit"]}, {"id": "title", "component": "Text", "text": "Book a flight", "variant": "h2"}, {"id": "origin", "component": "ChoicePicker", "label": "Origin", "options": [{"label": "LAX", "value": "LAX"}, {"label": "JFK", "value": "JFK"}, {"label": "SFO", "value": "SFO"}, {"label": "ORD", "value": "ORD"}, {"label": "BOS", "value": "BOS"}, {"label": "ATL", "value": "ATL"}, {"label": "DFW", "value": "DFW"}, {"label": "SEA", "value": "SEA"}, {"label": "MIA", "value": "MIA"}, {"label": "DEN", "value": "DEN"}], "value": {"path": "/origin"}, "variant": "mutuallyExclusive"}, {"id": "dest", "component": "ChoicePicker", "label": "Destination", "options": [{"label": "LAX", "value": "LAX"}, {"label": "JFK", "value": "JFK"}, {"label": "SFO", "value": "SFO"}, {"label": "ORD", "value": "ORD"}, {"label": "BOS", "value": "BOS"}, {"label": "ATL", "value": "ATL"}, {"label": "DFW", "value": "DFW"}, {"label": "SEA", "value": "SEA"}, {"label": "MIA", "value": "MIA"}, {"label": "DEN", "value": "DEN"}], "value": {"path": "/dest"}, "variant": "mutuallyExclusive"}, {"id": "fare", "component": "ChoicePicker", "label": "Fare class", "options": [{"label": "Economy", "value": "Economy"}, {"label": "Premium", "value": "Premium"}, {"label": "Business", "value": "Business"}, {"label": "First", "value": "First"}], "value": {"path": "/fare_class"}, "variant": "mutuallyExclusive"}, {"id": "date", "component": "DateTimeInput", "label": "Departure date (YYYY-MM-DD)", "value": {"path": "/date"}, "enableDate": true}, {"id": "passengers", "component": "TextField", "label": "Passengers", "value": {"path": "/passengers"}, "variant": "number"}, {"id": "submit", "component": "Button", "child": "submit_label", "variant": "primary", "action": {"event": {"name": "bookingSubmit", "context": {"formId": "booking", "origin": {"path": "/origin"}, "dest": {"path": "/dest"}, "date": {"path": "/date"}, "passengers": {"path": "/passengers"}, "fare_class": {"path": "/fare_class"}}}}}, {"id": "submit_label", "component": "Text", "text": "Search flights"}]}}\n{"version": "v0.9", "updateDataModel": {"surfaceId": "booking", "path": "/", "value": {"origin": ["LAX"], "dest": ["JFK"], "date": "2026-11-03", "passengers": 2, "fare_class": ["Business"]}}}\n',
];
const row = (id: string, role: string, content: string, generation = id) => ({
  id,
  role,
  content,
  delivery: { generation, phase: 'complete', outcome: 'success' },
});
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function fixture() {
  let state: any = {
    status: 'idle',
    messages: [],
    toolCalls: [],
    interrupts: [],
    subgraphs: [],
  };
  const listeners = new Set<() => void>();
  const inputs: string[] = [];
  let index = 0,
    previous: any[] = [],
    observed = true,
    outcome = 'success',
    readFailure = false;
  let submitHold: ReturnType<typeof deferred<void>> | undefined;
  let createHold: ReturnType<typeof deferred<string>> | undefined;
  let disposeHold: ReturnType<typeof deferred<void>> | undefined;
  let saved: any, response: string | undefined;
  let readHold: ReturnType<typeof deferred<void>> | undefined;
  const emit = () => {
    for (const f of [...listeners]) f();
  };
  const checkpoint = () => ({
    thread_id: 'thread',
    checkpoint_ns: '',
    checkpoint_id: 'cp-' + index,
    checkpoint_map: { '': 'cp-' + index },
  });
  const session = {
    getSnapshot: () => state,
    subscribe: vi.fn((f: () => void) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    }),
    submit: vi.fn(async (text: string) => {
      inputs.push(text);
      index++;
      const human = row('u' + index, 'user', text, 'run-' + index);
      state = {
        ...state,
        status: 'running',
        messages: [
          ...previous,
          human,
          row('fake', 'assistant', wire[1], 'run-' + index),
        ],
      };
      if (observed) emit();
      if (submitHold) await submitHold.promise;
      state = { ...state, status: 'idle' };
      if (observed) emit();
      saved = {
        ...state,
        messages: [
          ...previous,
          row(human.id, 'user', text),
          row('a' + index, 'assistant', response ?? wire[(index - 1) % 4]),
        ],
        history: [{ checkpoint: checkpoint(), next: [] }],
      };
      return outcome;
    }),
    load: vi.fn(async () => {
      state = saved;
      previous = saved.messages;
      emit();
    }),
    stop: vi.fn(async () => undefined),
    dispose: vi.fn(async () => {
      if (disposeHold) await disposeHold.promise;
    }),
  };
  const createThread = vi.fn(async () =>
    createHold ? await createHold.promise : 'thread'
  );
  const readCheckpoint = vi.fn(async (cp: unknown) => {
    if (readFailure) throw Error('read failed');
    if (readHold) await readHold.promise;
    return {
      checkpoint: cp,
      next: [],
      tasks: [],
      values: {
        messages: saved.messages.map((m: any) => ({
          id: m.id,
          type: m.role === 'user' ? 'human' : 'ai',
          content: m.content,
          name: null,
          additional_kwargs: {},
        })),
      },
    };
  });
  const sessionFactory = vi.fn(() => session);
  const app = createA2uiApplication({
    createThread,
    sessionFactory: sessionFactory as never,
    readCheckpoint,
  });
  return {
    app,
    session,
    createThread,
    sessionFactory,
    readCheckpoint,
    inputs,
    listeners,
    set observed(v: boolean) {
      observed = v;
    },
    set outcome(v: string) {
      outcome = v;
    },
    set readFailure(v: boolean) {
      readFailure = v;
    },
    holdRead() {
      return (readHold = deferred<void>());
    },
    holdSubmit() {
      return (submitHold = deferred<void>());
    },
    holdCreate() {
      return (createHold = deferred<string>());
    },
    holdDispose() {
      return (disposeHold = deferred<void>());
    },
    set answer(content: string) {
      response = content;
    },
  };
}
describe('application owned canonical booking turns', () => {
  it.each([
    ['origin', 'LAX'],
    ['dest', 'JFK'],
    ['fare', 'Economy'],
  ])('makes a booking with an unrepresented %s selection unavailable before Search can dispatch', async (picker, selected) => {
    const f = fixture();
    const lines = wire[0].split('\n'),
      update = JSON.parse(lines[2]),
      model = JSON.parse(lines[3]);
    const control = update.updateComponents.components.find(
      (c: any) => c.id === picker
    );
    control.options = control.options.filter((o: any) => o.value !== selected);
    model.updateDataModel.value.date = '2026-12-24';
    lines[2] = JSON.stringify(update);
    lines[3] = JSON.stringify(model);
    f.answer = 'Saved explanation\n' + lines.join('\n');
    expect(await f.app.submit('request')).toBe(false);
    expect(f.app.getSnapshot()).toMatchObject({
      surfaces: [],
      activeSurface: null,
      canSubmit: false,
    });
    expect(f.app.getSnapshot().messages.at(-1)?.content).toContain(
      'Saved explanation'
    );
    expect(await f.app.submit('Search flights')).toBe(false);
    expect(f.inputs).toEqual(['request']);
    expect(f.session.submit).toHaveBeenCalledTimes(1);
    await f.app.dispose();
  });
  it('is inert until first Send and publishes saved transcript and surface together', async () => {
    const f = fixture();
    expect(f.createThread).not.toHaveBeenCalled();
    await f.app.newConversation();
    expect(f.createThread).not.toHaveBeenCalled();
    const seen: any[] = [];
    f.app.subscribe(() => seen.push(f.app.getSnapshot()));
    expect(await f.app.submit('Book LAX to JFK')).toBe(true);
    expect(f.inputs).toEqual(['Book LAX to JFK']);
    expect(f.app.getSnapshot().messages.map((m: any) => m.id)).toEqual([
      'u1',
      'a1',
    ]);
    expect(f.app.getSnapshot().surfaces).toHaveLength(1);
    expect(f.app.getSnapshot().surfaces[0].kind).toBe('booking');
    expect(
      seen
        .filter((s) => s.busy)
        .every((s) => s.messages.length === 0 && s.surfaces.length === 0)
    ).toBe(true);
    expect(f.readCheckpoint).toHaveBeenCalledTimes(1);
    await f.app.dispose();
    expect(f.listeners.size).toBe(0);
  });
  it.each(['error', 'aborted', 'paused'])(
    'cannot rescue %s with plausible fake history',
    async (outcome) => {
      const f = fixture();
      f.outcome = outcome;
      expect(await f.app.submit('request')).toBe(false);
      expect(f.app.getSnapshot()).toMatchObject({
        canSubmit: false,
        surfaces: [],
        messages: [],
      });
      expect(f.session.load).not.toHaveBeenCalled();
      expect(f.readCheckpoint).not.toHaveBeenCalled();
      await f.app.dispose();
    }
  );
  it('requires human identity observed during this run', async () => {
    const f = fixture();
    f.observed = false;
    expect(await f.app.submit('request')).toBe(false);
    expect(f.session.load).not.toHaveBeenCalled();
    await f.app.dispose();
  });
  it('rejects an exact read error without replacing the confirmed cards', async () => {
    const f = fixture();
    await f.app.submit('request');
    const before = f.app.getSnapshot();
    f.readFailure = true;
    expect(await f.app.submit('another request')).toBe(false);
    expect(f.app.getSnapshot().messages).toBe(before.messages);
    expect(f.app.getSnapshot().surfaces).toBe(before.surfaces);
    expect(f.app.getSnapshot().activeSurface).toBeNull();
    expect(await f.app.submit('retry')).toBe(false);
    await f.app.dispose();
  });
  it('captures latest edits once, closes admission synchronously, preserves disabled historical lexical values', async () => {
    const f = fixture();
    await f.app.submit('request');
    const card = f.app.getSnapshot().surfaces[0];
    const click = card.actions.submit;
    card.edits.origin('SFO');
    card.edits.dest('SEA');
    card.edits.date('2026-12-24');
    card.edits.passengers('003');
    card.edits.fare('Business');
    const hold = f.holdSubmit();
    let reentered = false;
    f.app.subscribe(() => {
      if (!reentered && f.app.getSnapshot().busy) {
        reentered = true;
        click();
        void f.app.submit('reentrant');
      }
    });
    expect(click()).toBe(true);
    expect(f.app.getSnapshot().busy).toBe(true);
    expect(click()).toBe(false);
    expect(f.inputs).toHaveLength(2);
    expect(JSON.parse(f.inputs[1]).action.context).toEqual({
      formId: 'booking',
      origin: ['SFO'],
      dest: ['SEA'],
      date: '2026-12-24',
      passengers: 3,
      fare_class: ['Business'],
    });
    expect(card.form!.getSnapshot().drafts.passengers).toBe('003');
    card.edits.passengers('9');
    expect(card.form!.getSnapshot().drafts.passengers).toBe('003');
    hold.resolve();
    await vi.waitFor(() => expect(f.app.getSnapshot().busy).toBe(false));
    expect(f.app.getSnapshot().surfaces).toHaveLength(2);
    expect(f.app.getSnapshot().surfaces[1].kind).toBe('results');
    expect(f.app.getSnapshot().activeSurface).toBe(
      f.app.getSnapshot().surfaces[1].id
    );
    expect(click()).toBe(false);
    await f.app.dispose();
  });
  it('direct action gate rejects invalid lexical draft with previous valid typed value', async () => {
    const f = fixture();
    await f.app.submit('request');
    const card = f.app.getSnapshot().surfaces[0];
    card.edits.date('2026-12-24');
    card.edits.passengers('');
    expect(card.form!.getSnapshot().model.passengers).toBe(1);
    expect(card.actions.submit()).toBe(false);
    expect(f.inputs).toHaveLength(1);
    await f.app.dispose();
  });
  it('Stop retains cards, blocks continuation, and late run cannot restore authority', async () => {
    const f = fixture();
    await f.app.submit('request');
    const before = f.app.getSnapshot();
    const hold = f.holdSubmit();
    const pending = f.app.submit('next');
    await f.app.stop();
    hold.resolve();
    await pending;
    expect(f.app.getSnapshot()).toMatchObject({
      canSubmit: false,
      busy: false,
      activeSurface: null,
    });
    expect(f.app.getSnapshot().surfaces).toBe(before.surfaces);
    expect(f.app.getSnapshot().messages).toBe(before.messages);
    expect(f.session.stop).toHaveBeenCalledTimes(1);
    await f.app.dispose();
  });
  it('New fences late create and resets generation before awaited cleanup', async () => {
    const f = fixture();
    const hold = f.holdCreate();
    const pending = f.app.submit('request');
    const reset = f.app.newConversation();
    hold.resolve('thread');
    await reset;
    await pending;
    expect(f.sessionFactory).not.toHaveBeenCalled();
    expect(f.app.getSnapshot()).toMatchObject({
      threadId: null,
      messages: [],
      surfaces: [],
      canSubmit: true,
      viewGeneration: 1,
    });
    await f.app.dispose();
  });
  it('New retires old same-ID callbacks and late cleanup does not increment view generation', async () => {
    const f = fixture();
    await f.app.submit('request');
    const old = f.app.getSnapshot().surfaces[0];
    const hold = f.holdDispose();
    const reset = f.app.newConversation();
    const generation = f.app.getSnapshot().viewGeneration;
    expect(old.actions.submit()).toBe(false);
    expect(f.app.getSnapshot().surfaces).toEqual([]);
    hold.resolve();
    await reset;
    expect(f.app.getSnapshot().viewGeneration).toBe(generation);
    await f.app.dispose();
    await f.app.dispose();
    expect(f.session.dispose).toHaveBeenCalledTimes(1);
  });
});

it('maintains independent registrations for duplicate subscriber callbacks', async () => {
  const f = fixture(),
    listener = vi.fn();
  const a = f.app.subscribe(listener),
    b = f.app.subscribe(listener);
  a();
  await f.app.newConversation();
  expect(listener).toHaveBeenCalled();
  listener.mockClear();
  b();
  await f.app.newConversation();
  expect(listener).not.toHaveBeenCalled();
  await f.app.dispose();
});
it('disposes a session returned after reentrant New without installing stale ownership', async () => {
  const f = fixture();
  let resetting: Promise<void> | undefined;
  f.sessionFactory.mockImplementationOnce(() => {
    resetting = f.app.newConversation();
    return f.session;
  });
  expect(await f.app.submit('request')).toBe(false);
  await resetting;
  expect(f.session.submit).not.toHaveBeenCalled();
  expect(f.session.dispose).toHaveBeenCalledTimes(1);
  expect(f.listeners.size).toBe(0);
  expect(f.app.getSnapshot().threadId).toBeNull();
  await f.app.dispose();
});
it.each(['__proto__', 'constructor', 'prototype', 'unknown-type'])(
  'renders no executable partial surface for reserved/unknown %s',
  async (id) => {
    const f = fixture();
    const lines = wire[0].split('\n'),
      update = JSON.parse(lines[2]);
    for (const c of update.updateComponents.components) {
      if (c.id === 'title') {
        c.id = id;
        c.text = '<script>inert</script>';
        if (id === 'unknown-type') c.component = 'Video';
      }
      if (c.id === 'card_col')
        c.children = c.children.map((key: string) =>
          key === 'title' ? id : key
        );
    }
    lines[2] = JSON.stringify(update);
    f.answer = 'Saved explanation\n' + lines.join('\n');
    expect(await f.app.submit('request')).toBe(false);
    expect(f.app.getSnapshot()).toMatchObject({
      surfaces: [],
      activeSurface: null,
      canSubmit: false,
    });
    expect(f.app.getSnapshot().messages.at(-1)?.content).toContain(
      'Saved explanation'
    );
    await f.app.dispose();
  }
);

it('New during an exact checkpoint read keeps the new local conversation empty after the old read settles', async () => {
  const f = fixture();
  await f.app.submit('request');
  const hold = f.holdRead();
  const pending = f.app.submit('another');
  await vi.waitFor(() => expect(f.readCheckpoint).toHaveBeenCalledTimes(2));
  await f.app.newConversation();
  hold.resolve();
  await pending;
  expect(f.app.getSnapshot()).toMatchObject({
    messages: [],
    surfaces: [],
    activeSurface: null,
    canSubmit: true,
  });
  await f.app.dispose();
});
it('page teardown revokes captured callbacks before owned disposal without clearing historical data', async () => {
  const f = fixture();
  await f.app.submit('request');
  const card = f.app.getSnapshot().surfaces[0];
  f.app.revoke();
  expect(card.actions.submit()).toBe(false);
  card.edits.passengers('7');
  expect(card.form!.getSnapshot().model.passengers).toBe(1);
  expect(f.inputs).toHaveLength(1);
  await f.app.dispose();
  await f.app.dispose();
  expect(f.session.dispose).toHaveBeenCalledTimes(1);
  expect(f.listeners.size).toBe(0);
});
