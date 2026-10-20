import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@threadplane/ag-ui';
import { createA2uiApplication, type A2uiSnapshot } from './application';
afterEach(() => vi.restoreAllMocks());
// Pure public-shaped fake transport controls; these are not native graph evidence.
const wire = [
  '---a2ui_JSON---\n{"version": "v0.9", "createSurface": {"surfaceId": "booking", "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}\n{"version": "v0.9", "updateComponents": {"surfaceId": "booking", "components": [{"id": "root", "component": "Column", "children": ["card"]}, {"id": "card", "component": "Card", "child": "card_col"}, {"id": "card_col", "component": "Column", "children": ["title", "origin", "dest", "date", "passengers", "fare", "submit"]}, {"id": "title", "component": "Text", "text": "Book a flight", "variant": "h2"}, {"id": "origin", "component": "ChoicePicker", "label": "Origin", "options": [{"label": "LAX", "value": "LAX"}, {"label": "JFK", "value": "JFK"}, {"label": "SFO", "value": "SFO"}, {"label": "ORD", "value": "ORD"}, {"label": "BOS", "value": "BOS"}, {"label": "ATL", "value": "ATL"}, {"label": "DFW", "value": "DFW"}, {"label": "SEA", "value": "SEA"}, {"label": "MIA", "value": "MIA"}, {"label": "DEN", "value": "DEN"}], "value": {"path": "/origin"}, "variant": "mutuallyExclusive"}, {"id": "dest", "component": "ChoicePicker", "label": "Destination", "options": [{"label": "LAX", "value": "LAX"}, {"label": "JFK", "value": "JFK"}, {"label": "SFO", "value": "SFO"}, {"label": "ORD", "value": "ORD"}, {"label": "BOS", "value": "BOS"}, {"label": "ATL", "value": "ATL"}, {"label": "DFW", "value": "DFW"}, {"label": "SEA", "value": "SEA"}, {"label": "MIA", "value": "MIA"}, {"label": "DEN", "value": "DEN"}], "value": {"path": "/dest"}, "variant": "mutuallyExclusive"}, {"id": "fare", "component": "ChoicePicker", "label": "Fare class", "options": [{"label": "Economy", "value": "Economy"}, {"label": "Premium", "value": "Premium"}, {"label": "Business", "value": "Business"}, {"label": "First", "value": "First"}], "value": {"path": "/fare_class"}, "variant": "mutuallyExclusive"}, {"id": "date", "component": "DateTimeInput", "label": "Departure date (YYYY-MM-DD)", "value": {"path": "/date"}, "enableDate": true}, {"id": "passengers", "component": "TextField", "label": "Passengers", "value": {"path": "/passengers"}, "variant": "number"}, {"id": "submit", "component": "Button", "child": "submit_label", "variant": "primary", "action": {"event": {"name": "bookingSubmit", "context": {"formId": "booking", "origin": {"path": "/origin"}, "dest": {"path": "/dest"}, "date": {"path": "/date"}, "passengers": {"path": "/passengers"}, "fare_class": {"path": "/fare_class"}}}}}, {"id": "submit_label", "component": "Text", "text": "Search flights"}]}}\n{"version": "v0.9", "updateDataModel": {"surfaceId": "booking", "path": "/", "value": {"origin": ["LAX"], "dest": ["JFK"], "date": "", "passengers": 1, "fare_class": ["Economy"]}}}\n',
  '---a2ui_JSON---\n{"version": "v0.9", "createSurface": {"surfaceId": "results", "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}\n{"version": "v0.9", "updateComponents": {"surfaceId": "results", "components": [{"id": "root", "component": "Column", "children": ["card_0"]}, {"id": "card_0", "component": "Card", "child": "col_0"}, {"id": "col_0", "component": "Column", "children": ["title_0", "route_0", "time_0", "btn_0"]}, {"id": "title_0", "component": "Text", "text": "UA flight UA123", "variant": "h3"}, {"id": "route_0", "component": "Text", "text": "LAX \\u2192 JFK  \\u2022  330 min  \\u2022  Boeing 787", "variant": "body"}, {"id": "time_0", "component": "Text", "text": "Depart 08:00  \\u2022  Arrive 16:30  \\u2022  Gate B14", "variant": "caption"}, {"id": "btn_0", "component": "Button", "child": "btn_label_0", "variant": "primary", "action": {"event": {"name": "flightSelect", "context": {"flightId": "UA123"}}}}, {"id": "btn_label_0", "component": "Text", "text": "Select"}]}}\n',
  '---a2ui_JSON---\n{"version": "v0.9", "createSurface": {"surfaceId": "confirmation", "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}\n{"version": "v0.9", "updateComponents": {"surfaceId": "confirmation", "components": [{"id": "root", "component": "Column", "children": ["card"]}, {"id": "card", "component": "Card", "child": "card_col"}, {"id": "card_col", "component": "Column", "children": ["title", "party_text", "modify"]}, {"id": "title", "component": "Text", "text": "UA flight UA123", "variant": "h2"}, {"id": "party_text", "component": "Text", "text": "2 passengers  \\u2022  Business", "variant": "body"}, {"id": "modify", "component": "Button", "child": "modify_label", "variant": "primary", "action": {"event": {"name": "modifySearch", "context": {"formId": "booking"}}}}, {"id": "modify_label", "component": "Text", "text": "Modify search"}]}}\n',
  '---a2ui_JSON---\n{"version": "v0.9", "createSurface": {"surfaceId": "booking", "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}\n{"version": "v0.9", "updateComponents": {"surfaceId": "booking", "components": [{"id": "root", "component": "Column", "children": ["card"]}, {"id": "card", "component": "Card", "child": "card_col"}, {"id": "card_col", "component": "Column", "children": ["title", "origin", "dest", "date", "passengers", "fare", "submit"]}, {"id": "title", "component": "Text", "text": "Book a flight", "variant": "h2"}, {"id": "origin", "component": "ChoicePicker", "label": "Origin", "options": [{"label": "LAX", "value": "LAX"}, {"label": "JFK", "value": "JFK"}, {"label": "SFO", "value": "SFO"}, {"label": "ORD", "value": "ORD"}, {"label": "BOS", "value": "BOS"}, {"label": "ATL", "value": "ATL"}, {"label": "DFW", "value": "DFW"}, {"label": "SEA", "value": "SEA"}, {"label": "MIA", "value": "MIA"}, {"label": "DEN", "value": "DEN"}], "value": {"path": "/origin"}, "variant": "mutuallyExclusive"}, {"id": "dest", "component": "ChoicePicker", "label": "Destination", "options": [{"label": "LAX", "value": "LAX"}, {"label": "JFK", "value": "JFK"}, {"label": "SFO", "value": "SFO"}, {"label": "ORD", "value": "ORD"}, {"label": "BOS", "value": "BOS"}, {"label": "ATL", "value": "ATL"}, {"label": "DFW", "value": "DFW"}, {"label": "SEA", "value": "SEA"}, {"label": "MIA", "value": "MIA"}, {"label": "DEN", "value": "DEN"}], "value": {"path": "/dest"}, "variant": "mutuallyExclusive"}, {"id": "fare", "component": "ChoicePicker", "label": "Fare class", "options": [{"label": "Economy", "value": "Economy"}, {"label": "Premium", "value": "Premium"}, {"label": "Business", "value": "Business"}, {"label": "First", "value": "First"}], "value": {"path": "/fare_class"}, "variant": "mutuallyExclusive"}, {"id": "date", "component": "DateTimeInput", "label": "Departure date (YYYY-MM-DD)", "value": {"path": "/date"}, "enableDate": true}, {"id": "passengers", "component": "TextField", "label": "Passengers", "value": {"path": "/passengers"}, "variant": "number"}, {"id": "submit", "component": "Button", "child": "submit_label", "variant": "primary", "action": {"event": {"name": "bookingSubmit", "context": {"formId": "booking", "origin": {"path": "/origin"}, "dest": {"path": "/dest"}, "date": {"path": "/date"}, "passengers": {"path": "/passengers"}, "fare_class": {"path": "/fare_class"}}}}}, {"id": "submit_label", "component": "Text", "text": "Search flights"}]}}\n{"version": "v0.9", "updateDataModel": {"surfaceId": "booking", "path": "/", "value": {"origin": ["LAX"], "dest": ["JFK"], "date": "2026-11-03", "passengers": 2, "fare_class": ["Business"]}}}\n',
];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function fakeSession(threadId: string) {
  let state: Record<string, unknown> & {
    status: string;
    transcript: Array<{ id: string; role: string; content: string }>;
  } = { status: 'idle', transcript: [], state: {}, subagents: [] };
  const listeners = new Set<() => void>();
  const settings = {
    emitInitial: true,
    emitFinal: true,
    outcome: 'success' as unknown,
    response: wire[3],
    hold: undefined as ReturnType<typeof deferred<void>> | undefined,
    finalChange: {} as Record<string, unknown>,
  };
  const inputs: string[] = [];
  const notify = () => {
    for (const f of [...listeners]) f();
  };
  const session = {
    getSnapshot: vi.fn(() => state),
    subscribe: vi.fn((f: () => void) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    }),
    submit: vi.fn(async (text: string) => {
      inputs.push(text);
      const n = inputs.length,
        human = { id: 'user-' + n, role: 'user', content: text },
        prior = state.transcript;
      state = {
        ...state,
        status: 'running',
        transcript: [...prior, human],
        run: { id: 'run-' + n },
      };
      if (settings.emitInitial) notify();
      if (settings.hold) await settings.hold.promise;
      state = {
        ...state,
        status: 'idle',
        transcript: [
          ...prior,
          human,
          { id: 'answer-' + n, role: 'assistant', content: settings.response },
        ],
        run: {
          id: 'run-' + n,
          outcome: 'success',
          terminal: { type: 'RUN_FINISHED', threadId, runId: 'run-' + n },
        },
        ...settings.finalChange,
      };
      if (settings.emitFinal) notify();
      return settings.outcome;
    }),
    stop: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
    resume: vi.fn(async () => 'success'),
  };
  return {
    session,
    settings,
    inputs,
    notify,
    get state() {
      return state;
    },
    set state(value) {
      state = value;
    },
    listeners,
  };
}
function fixture() {
  const sessions: ReturnType<typeof fakeSession>[] = [];
  const sessionFactory = vi.fn((threadId: string) => {
    const f = fakeSession(threadId);
    sessions.push(f);
    return f.session as unknown as Session;
  });
  const app = createA2uiApplication({ sessionFactory });
  return { app, sessionFactory, sessions };
}
describe('native application authority (fake transport controls)', () => {
  it('constructs without UUID or native session work', async () => {
    const uuid = vi.spyOn(crypto, 'randomUUID');
    const f = fixture();
    expect(uuid).not.toHaveBeenCalled();
    expect(f.sessionFactory).not.toHaveBeenCalled();
    expect(f.app.getSnapshot()).toMatchObject({
      threadId: null,
      busy: false,
      canSubmit: true,
      messages: [],
      surfaces: [],
    });
    await f.app.dispose();
  });
  it('subscribes before submit and admits transcript, view and authority atomically', async () => {
    const f = fixture();
    const observations: A2uiSnapshot[] = [];
    f.app.subscribe(() => observations.push(f.app.getSnapshot()));
    expect(await f.app.submit('flight please')).toBe(true);
    const native = f.sessions[0];
    expect(native.session.subscribe.mock.invocationCallOrder[0]).toBeLessThan(
      native.session.submit.mock.invocationCallOrder[0]
    );
    expect(f.app.getSnapshot()).toMatchObject({
      busy: false,
      canSubmit: true,
      outcome: 'success',
      messages: [{ id: 'user-1' }, { id: 'answer-1' }],
      surfaces: [{ kind: 'booking' }],
    });
    for (const s of observations)
      if (s.surfaces.length)
        expect(s).toMatchObject({
          messages: [{ id: 'user-1' }, { id: 'answer-1' }],
          activeSurface: s.surfaces[0].id,
          busy: false,
          canSubmit: true,
        });
    expect(Object.isFrozen(f.app.getSnapshot())).toBe(true);
    await f.app.dispose();
  });
  it('never admits from a terminal-only callback', async () => {
    const f = fixture();
    f.sessionFactory.mockImplementation((id) => {
      const native = fakeSession(id);
      native.settings.emitInitial = false;
      f.sessions.push(native);
      return native.session as unknown as Session;
    });
    expect(await f.app.submit('flight please')).toBe(false);
    expect(f.app.getSnapshot()).toMatchObject({
      surfaces: [],
      canSubmit: false,
    });
    await f.app.dispose();
  });
  it.each(['error', 'aborted', 'paused', 'interrupted', undefined])(
    'keeps native submit outcome %s separate from successful terminal',
    async (outcome) => {
      const f = fixture();
      f.sessionFactory.mockImplementation((id) => {
        const native = fakeSession(id);
        native.settings.outcome = outcome;
        f.sessions.push(native);
        return native.session as unknown as Session;
      });
      expect(await f.app.submit('flight please')).toBe(false);
      expect(f.app.getSnapshot()).toMatchObject({
        surfaces: [],
        canSubmit: false,
      });
      await f.app.dispose();
    }
  );
  it('preserves confirmed ordinary malformed surface text without interactive authority', async () => {
    const f = fixture();
    f.sessionFactory.mockImplementation((id) => {
      const native = fakeSession(id);
      native.settings.response = '---a2ui_JSON---\nunsupported';
      f.sessions.push(native);
      return native.session as unknown as Session;
    });
    expect(await f.app.submit('flight please')).toBe(false);
    expect(f.app.getSnapshot()).toMatchObject({
      messages: [{ id: 'user-1' }, { content: '---a2ui_JSON---\nunsupported' }],
      surfaces: [],
      canSubmit: false,
    });
    await f.app.dispose();
  });
  it('waits for original pending submit settlement after terminal notification', async () => {
    const f = fixture(),
      hold = deferred<void>();
    f.sessionFactory.mockImplementation((id) => {
      const native = fakeSession(id);
      native.settings.hold = hold;
      f.sessions.push(native);
      return native.session as unknown as Session;
    });
    const pending = f.app.submit('flight please');
    expect(f.sessionFactory).toHaveBeenCalledTimes(1);
    const native = f.sessions[0];
    native.state = {
      ...native.state,
      status: 'idle',
      transcript: [
        ...native.state.transcript,
        { id: 'answer-1', role: 'assistant', content: wire[3] },
      ],
      run: {
        id: 'run-1',
        outcome: 'success',
        terminal: {
          type: 'RUN_FINISHED',
          threadId: f.app.getSnapshot().threadId,
          runId: 'run-1',
        },
      },
    };
    native.notify();
    expect(f.app.getSnapshot()).toMatchObject({
      busy: true,
      surfaces: [],
      activeSurface: null,
    });
    hold.resolve();
    expect(await pending).toBe(true);
    await f.app.dispose();
  });
  it('admits one duplicate request while busy', async () => {
    const f = fixture(),
      hold = deferred<void>();
    f.sessionFactory.mockImplementation((id) => {
      const native = fakeSession(id);
      native.settings.hold = hold;
      f.sessions.push(native);
      return native.session as unknown as Session;
    });
    const pending = f.app.submit('flight please');
    expect(f.sessionFactory).toHaveBeenCalledTimes(1);
    expect(await f.app.submit('duplicate')).toBe(false);
    expect(f.sessions[0].inputs).toEqual(['flight please']);
    hold.resolve();
    await pending;
    await f.app.dispose();
  });
  it('stop quarantines synchronously, keeps void stop distinct, and ignores late submit result', async () => {
    const f = fixture(),
      hold = deferred<void>();
    f.sessionFactory.mockImplementation((id) => {
      const native = fakeSession(id);
      native.settings.hold = hold;
      f.sessions.push(native);
      return native.session as unknown as Session;
    });
    const pending = f.app.submit('flight please');
    expect(f.sessionFactory).toHaveBeenCalledTimes(1);
    const stopped = f.app.stop();
    expect(f.app.getSnapshot()).toMatchObject({
      busy: false,
      canSubmit: false,
      outcome: null,
      surfaces: [],
    });
    expect(f.sessions[0].session.stop).toHaveBeenCalledTimes(1);
    hold.resolve();
    expect(await pending).toBe(false);
    await stopped;
    expect(f.app.getSnapshot()).toMatchObject({
      canSubmit: false,
      outcome: null,
      surfaces: [],
    });
    await f.app.dispose();
  });
  it.each(['stop', 'newConversation', 'dispose'] as const)(
    'fences initial observer reentry through %s',
    async (action) => {
      const f = fixture();
      let fired = false;
      f.app.subscribe(() => {
        const s = f.app.getSnapshot();
        if (!fired && s.native?.status === 'running') {
          fired = true;
          void f.app[action]();
        }
      });
      expect(await f.app.submit('flight please')).toBe(false);
      expect(fired).toBe(true);
      expect(f.app.getSnapshot().surfaces).toEqual([]);
      await f.app.dispose();
    }
  );
  it.each(['stop', 'newConversation', 'dispose'] as const)(
    'fences final observer reentry through %s',
    async (action) => {
      const f = fixture();
      let fired = false;
      f.app.subscribe(() => {
        const s = f.app.getSnapshot();
        if (!fired && s.activeSurface) {
          fired = true;
          void f.app[action]();
        }
      });
      await f.app.submit('flight please');
      expect(fired).toBe(true);
      expect(f.app.getSnapshot().activeSurface).toBeNull();
      await f.app.dispose();
    }
  );
  it('makes captured actions and lexical edits inert after New', async () => {
    const f = fixture();
    expect(await f.app.submit('flight please')).toBe(true);
    const view = f.app.getSnapshot().surfaces[0];
    view.edits.passengers('003');
    const form = view.form;
    if (!form) throw Error('Expected booking form');
    const lexical = form.getSnapshot();
    await f.app.newConversation();
    view.edits.passengers('7');
    expect(form.getSnapshot()).toBe(lexical);
    expect(view.actions.submit()).toBe(false);
    expect(f.sessions[0].inputs).toHaveLength(1);
    expect(form.getSnapshot().drafts.passengers).toBe('003');
    await f.app.dispose();
  });
  it('rejects reused session objects after replacement', async () => {
    const f = fixture();
    expect(await f.app.submit('first')).toBe(true);
    const session = f.sessions[0].session;
    await f.app.newConversation();
    f.sessionFactory.mockReturnValue(session as unknown as Session);
    expect(await f.app.submit('second')).toBe(false);
    expect(session.submit).toHaveBeenCalledTimes(1);
    await f.app.dispose();
  });
  it('rejects reused thread IDs before constructing another owner', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      '11111111-1111-4111-8111-111111111111'
    );
    const f = fixture();
    await f.app.submit('first');
    await f.app.newConversation();
    expect(await f.app.submit('second')).toBe(false);
    expect(f.sessionFactory).toHaveBeenCalledTimes(1);
    await f.app.dispose();
  });
  it('cleans partial subscription failure and requires New', async () => {
    const f = fixture();
    f.sessionFactory.mockImplementation((id) => {
      const native = fakeSession(id);
      native.session.subscribe.mockImplementation(() => {
        throw Error('subscribe failed');
      });
      f.sessions.push(native);
      return native.session as unknown as Session;
    });
    expect(await f.app.submit('first')).toBe(false);
    expect(f.sessionFactory).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(f.sessions[0].session.dispose).toHaveBeenCalledTimes(1);
    expect(f.app.getSnapshot().canSubmit).toBe(false);
    await f.app.dispose();
  });
  it('does not keep UI authority waiting for rejected cleanup', async () => {
    const f = fixture();
    expect(await f.app.submit('first')).toBe(true);
    f.sessions[0].session.dispose.mockRejectedValue(Error('cleanup failed'));
    await f.app.newConversation();
    expect(f.app.getSnapshot()).toMatchObject({
      busy: false,
      canSubmit: true,
      threadId: null,
      surfaces: [],
    });
    expect(await f.app.submit('second')).toBe(true);
    await f.app.dispose();
  });
  it('requires New after factory failure and never retries automatically', async () => {
    const f = fixture();
    f.sessionFactory.mockImplementation(() => {
      throw Error('factory failed');
    });
    expect(await f.app.submit('first')).toBe(false);
    expect(f.app.getSnapshot()).toMatchObject({
      busy: false,
      canSubmit: false,
      surfaces: [],
    });
    expect(await f.app.submit('retry')).toBe(false);
    expect(f.sessionFactory).toHaveBeenCalledTimes(1);
    await f.app.newConversation();
    expect(f.app.getSnapshot().canSubmit).toBe(true);
    await f.app.dispose();
  });
  it.each(['stop', 'newConversation', 'dispose'] as const)(
    'cleans partial subscribe acquisition after %s reentry',
    async (action) => {
      const f = fixture();
      let released = false;
      f.sessionFactory.mockImplementation((id) => {
        const native = fakeSession(id);
        f.sessions.push(native);
        native.session.subscribe.mockImplementation(() => {
          void f.app[action]();
          return () => {
            released = true;
          };
        });
        return native.session as unknown as Session;
      });
      expect(await f.app.submit('first')).toBe(false);
      expect(f.sessions[0].session.submit).not.toHaveBeenCalled();
      expect(released).toBe(true);
      expect(f.sessions[0].session.dispose).toHaveBeenCalledTimes(1);
      await f.app.dispose();
    }
  );
  it('rechecks owner after a native snapshot getter replaces the conversation', async () => {
    const f = fixture();
    f.sessionFactory.mockImplementation((id) => {
      const native = fakeSession(id);
      f.sessions.push(native);
      native.session.getSnapshot.mockImplementation(() => {
        if (native.state.status === 'running') void f.app.newConversation();
        return native.state;
      });
      return native.session as unknown as Session;
    });
    expect(await f.app.submit('first')).toBe(false);
    expect(f.app.getSnapshot()).toMatchObject({
      threadId: null,
      messages: [],
      surfaces: [],
      canSubmit: true,
    });
    await f.app.dispose();
  });
  it('closes a session whose initial snapshot getter throws', async () => {
    const f = fixture();
    f.sessionFactory.mockImplementation((id) => {
      const native = fakeSession(id);
      f.sessions.push(native);
      native.session.getSnapshot.mockImplementation(() => {
        throw Error('snapshot failed');
      });
      return native.session as unknown as Session;
    });
    expect(await f.app.submit('first')).toBe(false);
    expect(f.sessions[0].session.dispose).toHaveBeenCalledTimes(1);
    expect(f.app.getSnapshot().canSubmit).toBe(false);
    await f.app.dispose();
  });
  it.each(['stop', 'newConversation', 'dispose'] as const)(
    'withholds a submit command acquired after %s getter reentry',
    async (action) => {
      const f = fixture();
      let reads = 0;
      let retired: A2uiSnapshot | undefined;
      const publications: A2uiSnapshot[] = [];
      let retiredPublications = 0;
      f.app.subscribe(() => publications.push(f.app.getSnapshot()));
      f.sessionFactory.mockImplementation((id) => {
        const native = fakeSession(id);
        f.sessions.push(native);
        const command = native.session.submit;
        Object.defineProperty(native.session, 'submit', {
          get() {
            if (++reads === 2) {
              void f.app[action]();
              retired = f.app.getSnapshot();
              retiredPublications = publications.length;
            }
            return command;
          },
        });
        return native.session as unknown as Session;
      });
      expect(await f.app.submit('first')).toBe(false);
      expect(f.sessionFactory).toHaveBeenCalledTimes(1);
      expect(reads).toBe(2);
      expect(retired).toBeDefined();
      expect(f.sessions[0].session.submit).not.toHaveBeenCalled();
      expect(f.sessions[0].inputs).toEqual([]);
      expect(f.sessions[0].listeners.size).toBe(0);
      expect(f.sessions[0].session.stop).toHaveBeenCalledTimes(1);
      expect(f.sessions[0].session.dispose).toHaveBeenCalledTimes(1);
      expect(f.app.getSnapshot()).toBe(retired);
      expect(publications).toHaveLength(retiredPublications);
      await f.app.dispose();
    }
  );
  it.each(['subscribe', 'getSnapshot'] as const)(
    'withholds the %s acquisition command after retirement from its getter',
    async (method) => {
      const f = fixture();
      let reads = 0;
      let retired: A2uiSnapshot | undefined;
      let command: ReturnType<typeof vi.fn> | undefined;
      f.sessionFactory.mockImplementation((id) => {
        const native = fakeSession(id);
        f.sessions.push(native);
        command = native.session[method];
        Object.defineProperty(native.session, method, {
          get() {
            if (++reads === 2) {
              void f.app.newConversation();
              retired = f.app.getSnapshot();
            }
            return command;
          },
        });
        return native.session as unknown as Session;
      });
      expect(await f.app.submit('first')).toBe(false);
      expect(f.sessionFactory).toHaveBeenCalledTimes(1);
      expect(reads).toBe(2);
      expect(retired).toBeDefined();
      expect(command).not.toHaveBeenCalled();
      expect(f.sessions[0].session.submit).not.toHaveBeenCalled();
      expect(f.sessions[0].listeners.size).toBe(0);
      expect(f.sessions[0].session.stop).toHaveBeenCalledTimes(1);
      expect(f.sessions[0].session.dispose).toHaveBeenCalledTimes(1);
      expect(f.app.getSnapshot()).toBe(retired);
      await f.app.dispose();
    }
  );
  it('withholds an observer snapshot command after its getter retires the owner', async () => {
    const f = fixture();
    let retired: A2uiSnapshot | undefined;
    let reads = 0;
    let command: ReturnType<typeof vi.fn> | undefined;
    f.sessionFactory.mockImplementation((id) => {
      const native = fakeSession(id);
      f.sessions.push(native);
      command = native.session.getSnapshot;
      Object.defineProperty(native.session, 'getSnapshot', {
        get() {
          if (++reads === 3) {
            void f.app.stop();
            retired = f.app.getSnapshot();
          }
          return command;
        },
      });
      return native.session as unknown as Session;
    });
    expect(await f.app.submit('first')).toBe(false);
    expect(f.sessionFactory).toHaveBeenCalledTimes(1);
    expect(reads).toBe(3);
    expect(retired).toBeDefined();
    expect(command).toHaveBeenCalledTimes(1);
    expect(f.sessions[0].session.submit).toHaveBeenCalledTimes(1);
    expect(f.sessions[0].listeners.size).toBe(0);
    expect(f.app.getSnapshot()).toBe(retired);
    await f.app.dispose();
  });
  it.each(['stop', 'newConversation', 'dispose'] as const)(
    'withholds the session factory after %s getter reentry',
    async (action) => {
      const factory = vi.fn(
        (id: string) => fakeSession(id).session as unknown as Session
      );
      let reads = 0;
      let retired: A2uiSnapshot | undefined;
      const options = {
        get sessionFactory() {
          reads++;
          void app[action]();
          retired = app.getSnapshot();
          return factory;
        },
      };
      const app = createA2uiApplication(options);
      expect(reads).toBe(0);
      expect(await app.submit('first')).toBe(false);
      expect(reads).toBe(1);
      expect(retired).toBeDefined();
      expect(factory).not.toHaveBeenCalled();
      expect(app.getSnapshot()).toBe(retired);
      await app.dispose();
    }
  );
  it('preserves receivers for acquired factory, subscribe, snapshot and submit commands', async () => {
    const options = {
      sessionFactory: vi.fn(function (this: unknown, id: string) {
        expect(this).toBe(options);
        const native = fakeSession(id);
        const read = native.session.getSnapshot;
        const subscribe = native.session.subscribe;
        const submit = native.session.submit;
        native.session.getSnapshot = vi.fn(function (this: unknown) {
          expect(this).toBe(native.session);
          return read();
        });
        native.session.subscribe = vi.fn(function (
          this: unknown,
          notify: () => void
        ) {
          expect(this).toBe(native.session);
          return subscribe(notify);
        });
        native.session.submit = vi.fn(function (this: unknown, text: string) {
          expect(this).toBe(native.session);
          return submit(text);
        });
        return native.session as unknown as Session;
      }),
    };
    const app = createA2uiApplication(options);
    expect(await app.submit('first')).toBe(true);
    expect(options.sessionFactory).toHaveBeenCalledTimes(1);
    await app.dispose();
  });
});
