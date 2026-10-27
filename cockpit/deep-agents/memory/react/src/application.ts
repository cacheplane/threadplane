import type {
  AgentSession,
  AgentStatus,
  CompleteOutcome,
  ToolCall,
} from '@threadplane/core';
import {
  createMessageContent,
  type MessageRow,
} from '@threadplane/content/messages';
import {
  captureAuthority,
  captureBaseline,
  captureTurn,
  copyData,
  record,
  sameData,
  LIMITS,
  type Authority,
  type Baseline,
  type Turn,
  type Checkpoint,
  type NativeSnapshot,
} from './authority';
import { projectMemory, type MemoryProjection } from './memory-projection';
import { createBrowserScope, type BrowserScope } from './browser-scope';
import type { LangGraphRunOptions } from '@threadplane/langgraph';
export interface MemorySession
  extends Omit<AgentSession, 'getSnapshot' | 'submit'> {
  getSnapshot(): NativeSnapshot;
  submit(
    input: string,
    options?: LangGraphRunOptions
  ): Promise<CompleteOutcome>;
  load(options?: { readonly signal?: AbortSignal }): Promise<void>;
}
export interface MemoryClient {
  observeMemory(id: string, listener: (event: unknown) => void): () => void;
  createThread(signal: AbortSignal): Promise<string>;
  sessionFactory(id: string): MemorySession;
  readCurrent(id: string, signal: AbortSignal): Promise<unknown>;
  readHistory(id: string, signal: AbortSignal): Promise<readonly unknown[]>;
  readCheckpoint(checkpoint: Checkpoint, signal: AbortSignal): Promise<unknown>;
}
export interface MemorySnapshot {
  readonly threadId: string | null;
  readonly rows: readonly MessageRow[];
  readonly toolCalls: readonly ToolCall[];
  readonly memory: MemoryProjection;
  readonly scopeWarning: string | null;
  readonly authority: Authority;
  readonly activity:
    | 'idle'
    | 'creating'
    | 'running'
    | 'confirming'
    | 'restoring';
  readonly busy: boolean;
  readonly canSubmit: boolean;
  readonly outcome: CompleteOutcome | null;
  readonly error: string | null;
  readonly viewGeneration: number;
  readonly history: readonly { id: string; label: string }[];
}
const initial = (
  viewGeneration = 0,
  history: MemorySnapshot['history'] = []
): MemorySnapshot => ({
  threadId: null,
  rows: [],
  toolCalls: [],
  memory: { kind: 'none' },
  scopeWarning: null,
  authority: { kind: 'unconfirmed' },
  activity: 'idle',
  busy: false,
  canSubmit: true,
  outcome: null,
  error: null,
  viewGeneration,
  history,
});
export function createMemoryApplication(
  client: MemoryClient,
  scope: BrowserScope = createBrowserScope({
    storage: () => window.localStorage,
    uuid: () => crypto.randomUUID(),
    events: window,
  })
) {
  type Terminal = Extract<Authority, { kind: 'terminal' }>;
  type Saved = { authority: Terminal; native: NativeSnapshot; label: string };
  type Owner = {
    id: string;
    key: string;
    generation: string;
    session: MemorySession;
    content: ReturnType<typeof createMessageContent>;
    baseline: Baseline;
    turn?: Turn;
    nativeGeneration?: string;
    expectedText?: string;
    confirmed?: NativeSnapshot;
    authority?: Terminal;
    release?: () => void;
    releaseMemory?: () => void;
    observation?: unknown;
    closed: boolean;
    unsafe: boolean;
    loading: boolean;
    resolved: Map<string, unknown>;
    completed: Map<string, unknown>;
  };
  let snapshot = initial(),
    owner: Owner | undefined,
    operation: AbortController | undefined,
    disposed = false,
    serial = 0,
    conversationSerial = 0,
    disposal: Promise<void> | undefined;
  const listeners = new Set<() => void>(),
    catalog = new Map<string, Saved>(),
    cleanups = new Set<Promise<void>>();
  const publish = (update: Partial<MemorySnapshot>) => {
    if (disposed) return;
    snapshot = Object.freeze({ ...snapshot, ...update });
    listeners.forEach((f) => f());
  };
  const scopeState = scope.getSnapshot();
  const memoryScope = scopeState.scope;
  const updateScope = () => {
    const state = scope.getSnapshot();
    publish({
      scopeWarning: state.status === 'blocked' ? state.warning : null,
      canSubmit:
        state.status === 'ready' &&
        !snapshot.busy &&
        !owner?.unsafe &&
        snapshot.outcome !== 'aborted' &&
        snapshot.outcome !== 'error',
    });
  };
  const releaseScope = scope.subscribe(updateScope);
  updateScope();
  const history = () => [...catalog].map(([id, s]) => ({ id, label: s.label }));
  function bounded(work: () => void | Promise<void>) {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
      Promise.resolve()
        .then(work)
        .catch(() => undefined),
      new Promise<void>((r) => {
        timer = setTimeout(r, 2000);
      }),
    ]).finally(() => clearTimeout(timer));
  }
  function close(o: Owner) {
    if (o.closed) return Promise.resolve();
    o.closed = true;
    // Each owned resource gets its release attempt even if another cleanup fails.
    try {
      o.release?.();
    } catch {
      /* Continue releasing the session. */
    }
    try {
      o.releaseMemory?.();
    } catch {
      /* Continue all cleanup attempts. */
    }
    try {
      o.content.dispose();
    } catch {
      /* Continue releasing the session. */
    }
    const p = bounded(() => o.session.dispose());
    cleanups.add(p);
    void p.finally(() => cleanups.delete(p));
    return p;
  }
  function detach() {
    const o = owner;
    owner = undefined;
    return o ? close(o) : Promise.resolve();
  }
  function block(o?: Owner) {
    if (o) {
      o.unsafe = true;
      catalog.delete(o.id);
    }
    publish({
      canSubmit: false,
      memory: { kind: 'unavailable' },
      authority: { kind: 'unconfirmed' },
      outcome: 'error',
      error:
        'This conversation could not be confirmed. Start a new conversation to continue.',
      history: history(),
    });
  }
  function install(
    o: Owner,
    s: NativeSnapshot,
    authority: Authority,
    source: 'observed-root' | 'checkpoint'
  ) {
    const memory = projectMemory({
      owner: o.key,
      generation: o.generation,
      currentOwner: o.key,
      currentGeneration: o.generation,
      scope: memoryScope,
      source:
        source === 'checkpoint'
          ? 'checkpoint'
          : o.observation
          ? 'custom'
          : 'none',
      event: o.observation,
      authority,
    });
    const rows = o.content.project({
      status: s.status as AgentStatus,
      messages: s.messages,
      toolCalls: s.toolCalls,
    });
    publish({
      rows,
      toolCalls: s.toolCalls,
      memory:
        source === 'checkpoint' || o.observation ? memory : { kind: 'none' },
      authority,
    });
  }
  function read(o: Owner, valid: () => boolean): NativeSnapshot | undefined {
    if (!valid() || o.loading || o.unsafe) return;
    try {
      const source = o.session.getSnapshot(),
        s = copyData(source) as NativeSnapshot;
      if (
        !record(s) ||
        ![s.messages, s.toolCalls, s.interrupts, s.subgraphs].every(
          Array.isArray
        )
      )
        throw Error('Malformed snapshot');
      if (s.subgraphs.length) throw Error('Unsupported child state');
      if (
        o.confirmed &&
        (s.messages.length < o.confirmed.messages.length ||
          o.confirmed.messages.some(
            (m, i) =>
              !sameData(
                { ...m, delivery: undefined },
                { ...s.messages[i], delivery: undefined }
              )
          ) ||
          o.confirmed.toolCalls.some(
            (t) =>
              !sameData(
                t,
                s.toolCalls.find((x) => x.id === t.id)
              )
          ))
      )
        throw Error('Changed prior baseline');
      if (
        o.expectedText !== undefined &&
        s.messages.length > o.baseline.messages.length
      ) {
        const h = s.messages[o.baseline.messages.length];
        if (
          h.role !== 'user' ||
          h.content !== o.expectedText ||
          !h.delivery?.generation ||
          s.messages
            .slice(o.baseline.messages.length + 1)
            .some((m) => m.role === 'user')
        )
          throw Error('Unowned human');
        if (!o.turn) {
          o.turn = captureTurn(o.baseline, {
            memoryScope: memoryScope!,
            owner: o.key,
            generation: o.generation,
            threadId: o.id,
            humanId: h.id,
            humanContent: o.expectedText,
          });
          o.nativeGeneration = h.delivery.generation;
          if (!o.turn) throw Error('Unavailable turn');
        }
        if (
          s.messages
            .slice(o.baseline.messages.length)
            .some((m) => m.delivery?.generation !== o.nativeGeneration)
        )
          throw Error('Foreign generation');
      }
      if (o.turn) {
        const h = s.messages[o.baseline.messages.length];
        if (
          !h ||
          h.id !== o.turn.humanId ||
          h.delivery.generation !== o.nativeGeneration
        )
          throw Error('Foreign generation');
      }
      for (const m of s.messages) {
        const semantic = { ...m, delivery: undefined };
        if (o.completed.has(m.id) && !sameData(o.completed.get(m.id), semantic))
          throw Error('Changed complete message');
        if (m.delivery?.phase === 'complete') o.completed.set(m.id, semantic);
      }
      for (const t of s.toolCalls) {
        if (o.resolved.has(t.id) && !sameData(o.resolved.get(t.id), t))
          throw Error('Changed resolved tool');
        if (t.status === 'complete' || t.status === 'error')
          o.resolved.set(t.id, t);
      }
      if (
        [...o.completed.keys()].some(
          (id) => !s.messages.some((m) => m.id === id)
        ) ||
        [...o.resolved.keys()].some(
          (id) => !s.toolCalls.some((t) => t.id === id)
        )
      )
        throw Error('Missing completed work');
      if (!valid()) return;
      if (o.session.getSnapshot() !== source) throw Error('Changed source');
      install(o, s, { kind: 'unconfirmed' }, 'observed-root');
      return s;
    } catch {
      if (valid()) block(o);
      return;
    }
  }
  function make(id: string): Owner {
    const o: Owner = {
      id,
      key: String(++serial),
      generation: String(++serial),
      session: client.sessionFactory(id),
      content: createMessageContent(),
      baseline: { messages: [] },
      closed: false,
      unsafe: false,
      loading: false,
      resolved: new Map(),
      completed: new Map(),
    };
    try {
      o.release = o.session.subscribe(() => {
        const active = operation;
        if (active && !o.loading)
          read(
            o,
            () =>
              !disposed &&
              operation === active &&
              !active.signal.aborted &&
              owner === o &&
              !o.closed
          );
      });
    } catch {
      void close(o);
      throw Error('Runtime subscription unavailable.');
    }
    return o;
  }
  async function confirm(
    o: Owner,
    controller: AbortController,
    live: NativeSnapshot,
    valid: () => boolean,
    retained?: Saved
  ) {
    const observedState = copyData(
      await client.readCurrent(o.id, controller.signal),
      false
    );
    if (!valid()) return;
    const h = copyData(
      await client.readHistory(o.id, controller.signal),
      false
    );
    if (!valid()) return;
    if (!Array.isArray(h) || !record(h[0])) throw Error('Missing history');
    const requested = copyData(h[0].checkpoint, false) as Checkpoint;
    const loadedCheckpoint = copyData(
      await client.readCheckpoint(requested, controller.signal),
      false
    );
    if (!valid()) return;
    o.loading = true;
    await o.session.load({ signal: controller.signal });
    if (!valid()) return;
    const source = o.session.getSnapshot(),
      loaded = copyData(source) as NativeSnapshot;
    if (!Array.isArray(loaded.subgraphs) || loaded.subgraphs.length)
      throw Error('Unsupported child state');
    const authority = captureAuthority({
      memoryScope,
      turn: o.turn,
      owner: o.key,
      generation: o.generation,
      threadId: o.id,
      outcome: 'success',
      observedState,
      history: h,
      loadedCheckpoint,
      snapshot: retained ? loaded : live,
      loadedSnapshot: loaded,
    });
    if (
      authority.kind !== 'terminal' ||
      (retained &&
        (!sameData(authority.checkpoint, retained.authority.checkpoint) ||
          !sameData(authority.values, retained.authority.values)))
    )
      throw Error('Unconfirmed root');
    if (!valid()) return;
    if (o.session.getSnapshot() !== source) throw Error('Changed publication');
    const projection = projectMemory({
      owner: o.key,
      currentOwner: o.key,
      generation: o.generation,
      currentGeneration: o.generation,
      scope: memoryScope,
      source: 'checkpoint',
      authority,
    });
    if (projection.kind !== 'checkpoint')
      throw Error('Memory confirmation unavailable.');
    const baseline = captureBaseline({ messages: authority.messages });
    if (!baseline) throw Error('Missing baseline');
    o.confirmed = loaded;
    o.authority = authority;
    o.baseline = baseline;
    o.loading = false;
    o.turn = undefined;
    o.expectedText = undefined;
    const saved: Saved = {
      authority,
      native: loaded,
      label: catalog.get(o.id)?.label ?? `Conversation ${++conversationSerial}`,
    };
    // Bound the entire page-local catalog, including repeated raw/native text.
    // Oldest entries leave the selectable catalog rather than remaining usable.
    copyData(saved);
    catalog.delete(o.id);
    catalog.set(o.id, saved);
    while (catalog.size > LIMITS.entries) {
      const oldest = catalog.keys().next().value;
      if (oldest !== undefined) catalog.delete(oldest);
    }
    while (true) {
      try {
        copyData([...catalog.values()]);
        break;
      } catch {
        const oldest = catalog.keys().next().value;
        if (oldest === undefined || oldest === o.id) {
          catalog.delete(o.id);
          throw Error('Unavailable catalog budget');
        }
        catalog.delete(oldest);
      }
    }
    install(o, loaded, authority, 'checkpoint');
    if (!valid()) return;
    publish({
      canSubmit: scope.getSnapshot().status === 'ready',
      outcome: 'success',
      history: history(),
    });
  }
  async function submit(text: string) {
    if (disposed || snapshot.busy || !snapshot.canSubmit || !text.trim())
      return;
    if (text.length > LIMITS.fieldText) {
      block(owner);
      return;
    }
    const context = scope.admit();
    if (!context) {
      updateScope();
      return;
    }
    const controller = new AbortController();
    operation = controller;
    const current = () =>
      !disposed && operation === controller && !controller.signal.aborted;
    publish({
      busy: true,
      canSubmit: false,
      activity: owner ? 'running' : 'creating',
      outcome: null,
      error: null,
      memory: { kind: 'none' },
      authority: { kind: 'unconfirmed' },
    });
    try {
      if (!current()) return;
      if (!owner) {
        const id = await client.createThread(controller.signal);
        if (!current()) return;
        if (typeof id !== 'string' || !id || id.length > LIMITS.fieldText)
          throw Error('Unknown thread');
        const o = make(id);
        if (!current()) {
          void close(o);
          return;
        }
        owner = o;
        publish({ threadId: id, activity: 'running' });
      }
      const o = owner,
        valid = () => current() && owner === o && !o.closed;
      const admitted = scope.admit();
      if (!admitted || admitted.memory_scope !== context.memory_scope) {
        updateScope();
        return;
      }
      o.generation = String(++serial);
      o.observation = undefined;
      o.turn = undefined;
      o.nativeGeneration = undefined;
      o.expectedText = text;
      o.completed = new Map();
      o.resolved = new Map();
      const before = read(o, valid);
      if (!valid()) return;
      if (
        !before ||
        o.unsafe ||
        before.messages.length !== o.baseline.messages.length
      )
        throw Error('Unowned baseline');
      o.releaseMemory?.();
      const observedGeneration = o.generation;
      o.releaseMemory = client.observeMemory(o.id, (event) => {
        if (!valid() || o.generation !== observedGeneration || o.unsafe) return;
        // Only actual matching custom observations are a Memory source.
        let captured: unknown;
        try {
          captured = copyData(event, false);
        } catch {
          block(o);
          return;
        }
        if (!record(captured) || captured.name !== 'deep_agents.memory') return;
        const projection = projectMemory({
          owner: o.key,
          currentOwner: o.key,
          generation: observedGeneration,
          currentGeneration: o.generation,
          scope: memoryScope,
          source: 'custom',
          event: captured,
        });
        if (projection.kind === 'unavailable') {
          block(o);
          return;
        }
        o.observation = captured;
        publish({ memory: projection });
      });
      const outcome = await o.session.submit(text, {
        context,
        signal: controller.signal,
      });
      if (!valid()) return;
      const live = read(o, valid);
      if (!valid()) return;
      const human = live?.messages[o.baseline.messages.length];
      if (
        !live ||
        o.unsafe ||
        outcome !== 'success' ||
        !human ||
        human.role !== 'user' ||
        human.content !== text ||
        !human.delivery?.generation ||
        live.messages
          .slice(o.baseline.messages.length + 1)
          .some((m) => m.role === 'user')
      )
        throw Error('Unconfirmed delivery');
      o.turn = captureTurn(o.baseline, {
        memoryScope: memoryScope!,
        owner: o.key,
        generation: o.generation,
        threadId: o.id,
        humanId: human.id,
        humanContent: text,
      });
      o.nativeGeneration = human.delivery.generation;
      if (
        !o.turn ||
        live.messages
          .slice(o.baseline.messages.length)
          .some((m) => m.delivery.generation !== o.nativeGeneration)
      )
        throw Error('Foreign generation');
      publish({ activity: 'confirming' });
      await confirm(o, controller, live, valid);
    } catch {
      if (current()) block(owner);
    } finally {
      if (current()) {
        operation = undefined;
        publish({ busy: false, activity: 'idle' });
        updateScope();
      }
    }
  }
  async function selectConversation(id: string) {
    if (disposed || !catalog.has(id)) return;
    if (operation && snapshot.threadId === id) {
      await stop();
      return;
    }
    const saved = catalog.get(id);
    if (!saved) return;
    if (operation && snapshot.threadId) catalog.delete(snapshot.threadId);
    operation?.abort();
    operation = undefined;
    const cleanup = detach();
    const controller = new AbortController();
    operation = controller;
    const current = () =>
      !disposed && operation === controller && !controller.signal.aborted;
    snapshot = initial(snapshot.viewGeneration + 1, history());
    publish({
      busy: true,
      canSubmit: false,
      activity: 'restoring',
      threadId: id,
    });
    updateScope();
    try {
      await cleanup;
      if (!current()) return;
      const o = make(id);
      owner = o;
      o.loading = true;
      o.turn = captureTurn(saved.authority.turn.baseline, {
        ...saved.authority.turn,
        owner: o.key,
        generation: o.generation,
      });
      const valid = () => current() && owner === o && !o.closed;
      await confirm(o, controller, saved.native, valid, saved);
    } catch {
      if (current()) {
        catalog.delete(id);
        block(owner);
      }
    } finally {
      if (current()) {
        operation = undefined;
        publish({ busy: false, activity: 'idle' });
        updateScope();
      }
    }
  }
  async function stop() {
    if (disposed || !operation) return;
    operation.abort();
    operation = undefined;
    const o = owner;
    const invalidated = o?.id ?? snapshot.threadId;
    if (invalidated) catalog.delete(invalidated);
    const p = detach();
    publish({
      busy: false,
      canSubmit: false,
      activity: 'idle',
      outcome: 'aborted',
      error: null,
      memory: { kind: 'none' },
      authority: { kind: 'unconfirmed' },
      history: history(),
    });
    await Promise.all([p, bounded(() => o?.session.stop())]);
  }
  async function newConversation() {
    if (disposed) return;
    if (operation && snapshot.threadId) catalog.delete(snapshot.threadId);
    operation?.abort();
    operation = undefined;
    const p = detach();
    snapshot = initial(snapshot.viewGeneration + 1, history());
    publish({});
    updateScope();
    await p;
  }
  function dispose() {
    if (disposal) return disposal;
    disposed = true;
    operation?.abort();
    operation = undefined;
    void detach();
    try {
      releaseScope();
    } catch {
      /* Finish cleanup. */
    }
    try {
      scope.dispose();
    } catch {
      /* Finish cleanup. */
    }
    listeners.clear();
    return (disposal = Promise.all([...cleanups]).then(() => undefined));
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (f: () => void) => {
      if (disposed) return () => undefined;
      listeners.add(f);
      return () => listeners.delete(f);
    },
    submit,
    stop,
    newConversation,
    selectConversation,
    dispose,
  };
}
export type MemoryApplication = ReturnType<typeof createMemoryApplication>;
