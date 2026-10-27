import type {
  AgentSession,
  AgentStatus,
  CompleteOutcome,
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
  ConversationBudget,
  type Baseline,
  type Turn,
  type Checkpoint,
  type NativeSnapshot,
} from './authority';
import {
  projectParentObservations,
  type ParentProjection,
  type ToolCard,
} from './projection';
import { ChildObservations, type ChildRow } from './children';
export interface SubagentsSession extends Omit<AgentSession, 'getSnapshot'> {
  getSnapshot(): NativeSnapshot;
  load(options?: { readonly signal?: AbortSignal }): Promise<void>;
}
export interface SubagentsClient {
  createThread(signal: AbortSignal): Promise<string>;
  sessionFactory(threadId: string): SubagentsSession;
  readCurrent(threadId: string, signal: AbortSignal): Promise<unknown>;
  readHistory(
    threadId: string,
    signal: AbortSignal
  ): Promise<readonly unknown[]>;
  readCheckpoint(checkpoint: Checkpoint, signal: AbortSignal): Promise<unknown>;
}
export interface SubagentsSnapshot {
  readonly threadId: string | null;
  readonly rows: readonly MessageRow[];
  readonly observations: ReadonlyMap<string, readonly ToolCard[]>;
  readonly taskCount: number | null;
  readonly childObservations: readonly ChildRow[];
  readonly activity:
    | 'idle'
    | 'creating'
    | 'running'
    | 'confirming'
    | 'replacing';
  readonly busy: boolean;
  readonly canSubmit: boolean;
  readonly outcome: CompleteOutcome | null;
  readonly error: string | null;
  readonly viewGeneration: number;
}
const initial = (viewGeneration = 0): SubagentsSnapshot =>
  Object.freeze({
    threadId: null,
    rows: [],
    observations: new Map(),
    taskCount: 0,
    childObservations: [],
    activity: 'idle',
    busy: false,
    canSubmit: true,
    outcome: null,
    error: null,
    viewGeneration,
  });
/** A local owner may author again only after exact raw authority and canonical load. */
export function createSubagentsApplication(client: SubagentsClient) {
  type Owner = {
    id: string;
    key: string;
    session: SubagentsSession;
    content: ReturnType<typeof createMessageContent>;
    budget: ConversationBudget;
    children: ChildObservations;
    baseline: Baseline;
    release?: () => void;
    closed: boolean;
    unsafe: boolean;
    loading: boolean;
    turn?: Turn;
    nativeGeneration?: string;
    text?: string;
    serial: string;
    completed: Map<string, unknown>;
    resolvedTools: Map<string, unknown>;
    projection?: ParentProjection;
    confirmed?: NativeSnapshot;
    rawStatuses?: Readonly<Record<string, 'success' | 'error'>>;
  };
  let owner: Owner | undefined,
    operation: AbortController | undefined,
    serial = 0,
    disposed = false;
  let snapshot = initial();
  const listeners = new Set<() => void>(),
    cleanups = new Set<Promise<void>>();
  let disposal: Promise<void> | undefined;
  const publish = (update: Partial<SubagentsSnapshot>) => {
    if (disposed) return;
    snapshot = Object.freeze({ ...snapshot, ...update });
    for (const f of listeners) f();
  };
  function bounded(work: () => void | Promise<void>) {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
      Promise.resolve()
        .then(work)
        .catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 2000);
      }),
    ]).finally(() => clearTimeout(timer));
  }
  function close(o: Owner) {
    if (o.closed) return Promise.resolve();
    o.closed = true;
    o.release?.();
    o.content.dispose();
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
  function blocked(o?: Owner) {
    o?.children.finish('error');
    if (o?.confirmed) {
      const projection = projectParentObservations(
        o.confirmed.messages,
        o.confirmed.toolCalls,
        o.budget,
        'parents',
        o.rawStatuses
      );
      if (projection.status === 'available')
        publish({
          rows: o.content.project({
            status: o.confirmed.status as AgentStatus,
            messages: o.confirmed.messages,
            toolCalls: o.confirmed.toolCalls,
          }),
          observations: projection.cards,
          taskCount: projection.taskCount,
        });
    }
    publish({
      canSubmit: false,
      outcome: 'error',
      error:
        'This conversation could not be confirmed. Start a new conversation to continue.',
      ...(o ? { childObservations: o.children.rows() } : {}),
    });
  }
  function read(o: Owner, valid: () => boolean): NativeSnapshot | undefined {
    if (!valid() || o.loading) return;
    try {
      const source = o.session.getSnapshot();
      if (!valid()) return;
      const s = copyData(source) as NativeSnapshot;
      if (
        !record(s) ||
        !Array.isArray(s.messages) ||
        !Array.isArray(s.toolCalls) ||
        !Array.isArray(s.subgraphs) ||
        !Array.isArray(s.interrupts)
      )
        throw Error('Unavailable');
      if (o.confirmed) {
        const prior = o.confirmed;
        if (
          s.messages.length < prior.messages.length ||
          prior.messages.some(
            (m, i) =>
              !sameData(
                { ...m, delivery: undefined },
                { ...s.messages[i], delivery: undefined }
              )
          ) ||
          prior.toolCalls.some(
            (t) =>
              !sameData(
                t,
                s.toolCalls.find((x) => x.id === t.id)
              )
          )
        )
          throw Error('Changed confirmed root');
      }
      if (
        o.text !== undefined &&
        s.messages.length > o.baseline.messages.length
      ) {
        const human = s.messages[o.baseline.messages.length];
        if (
          human.role !== 'user' ||
          human.content !== o.text ||
          !human.delivery?.generation ||
          s.messages
            .slice(o.baseline.messages.length + 1)
            .some((m) => m.role === 'user')
        )
          throw Error('Unowned turn');
        if (!o.turn) {
          o.turn = captureTurn(o.baseline, {
            owner: o.key,
            generation: o.serial,
            threadId: o.id,
            humanId: human.id,
            humanContent: o.text,
          });
          o.nativeGeneration = human.delivery.generation;
          if (!o.turn || !o.children.begin(o.serial, human.delivery.generation))
            throw Error('Unavailable turn');
        }
        if (
          human.id !== o.turn.humanId ||
          human.delivery.generation !== o.nativeGeneration ||
          s.messages
            .slice(o.baseline.messages.length)
            .some((m) => m.delivery?.generation !== o.nativeGeneration)
        )
          throw Error('Foreign generation');
        if (
          [...o.completed.keys()].some(
            (id) => !s.messages.some((m) => m.id === id)
          )
        )
          throw Error('Missing completed message');
        for (const tool of s.toolCalls) {
          const prior = o.resolvedTools.get(tool.id);
          if (prior && !sameData(prior, tool))
            throw Error('Changed resolved tool');
          if (tool.status === 'complete' || tool.status === 'error')
            o.resolvedTools.set(tool.id, tool);
        }
        if (
          [...o.resolvedTools.keys()].some(
            (id) => !s.toolCalls.some((t) => t.id === id)
          )
        )
          throw Error('Missing resolved tool');
        for (const m of s.messages) {
          const semantic = { ...m, delivery: undefined };
          const prior = o.completed.get(m.id);
          if (prior && !sameData(prior, semantic))
            throw Error('Changed completed message');
          if (m.delivery.phase === 'complete') o.completed.set(m.id, semantic);
        }
        if (
          !o.children.observe(s.subgraphs, {
            owner: o.key,
            turn: o.serial,
            generation: human.delivery.generation,
          })
        )
          throw Error('Incomplete children');
      } else if (s.subgraphs.length) throw Error('Unowned children');
      const projection = projectParentObservations(
        s.messages,
        s.toolCalls,
        o.budget
      );
      if (projection.status === 'available') {
        const rows = o.content.project({
          status: s.status as AgentStatus,
          messages: s.messages,
          toolCalls: s.toolCalls,
        });
        if (!valid()) return;
        o.projection = projection;
        publish({
          rows,
          observations: projection.cards,
          taskCount: projection.taskCount,
          childObservations: o.children.rows(),
        });
      } else publish({ taskCount: null, childObservations: o.children.rows() });
      if (!valid()) return;
      if (o.session.getSnapshot() !== source) throw Error('Changed source');
      return s;
    } catch {
      if (valid()) {
        o.unsafe = true;
        blocked(o);
      }
      return;
    }
  }
  async function submit(text: string) {
    if (disposed || snapshot.busy || !snapshot.canSubmit || !text.trim())
      return;
    if (text.length > LIMITS.fieldText) {
      blocked(owner);
      return;
    }
    const admitted = new AbortController();
    operation = admitted;
    const current = () =>
      !disposed && operation === admitted && !admitted.signal.aborted;
    publish({
      busy: true,
      canSubmit: false,
      activity: owner ? 'running' : 'creating',
      outcome: null,
      error: null,
    });
    try {
      if (!current()) return;
      if (!owner) {
        const id = await client.createThread(admitted.signal);
        if (!current()) return;
        if (typeof id !== 'string' || !id || id.length > LIMITS.fieldText)
          throw Error('Unknown thread');
        const session = client.sessionFactory(id),
          budget = new ConversationBudget(),
          key = String(snapshot.viewGeneration);
        const o: Owner = {
          id,
          key,
          session,
          budget,
          children: new ChildObservations(key, budget),
          content: createMessageContent(),
          baseline: { messages: [] },
          closed: false,
          unsafe: false,
          loading: false,
          serial: '',
          completed: new Map(),
          resolvedTools: new Map(),
        };
        if (!current()) {
          void close(o);
          return;
        }
        owner = o;
        o.release = session.subscribe(() => {
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
        publish({ threadId: id, activity: 'running' });
      }
      const o = owner,
        valid = () => current() && owner === o && !o.closed;
      o.serial = String(++serial);
      o.text = text;
      o.turn = undefined;
      o.nativeGeneration = undefined;
      o.completed = new Map();
      o.resolvedTools = new Map();
      if (!valid()) return;
      const before = read(o, valid);
      if (!valid()) return;
      if (
        !before ||
        before.messages.length !== o.baseline.messages.length ||
        before.subgraphs.length ||
        o.unsafe
      )
        throw Error('Unowned baseline');
      const outcome = await o.session.submit(text, { signal: admitted.signal });
      if (!valid()) return;
      const live = read(o, valid);
      if (!valid()) return;
      if (!live || o.unsafe || outcome !== 'success' || !o.turn)
        throw Error('Unconfirmed delivery');
      publish({ activity: 'confirming' });
      if (!valid()) return;
      const observedState = copyData(
        await client.readCurrent(o.id, admitted.signal),
        false
      );
      if (!valid()) return;
      const history = copyData(
        await client.readHistory(o.id, admitted.signal),
        false
      );
      if (!valid()) return;
      if (!Array.isArray(history) || !record(history[0]))
        throw Error('Unavailable history');
      const requested = copyData(history[0].checkpoint, false) as Checkpoint;
      const loadedCheckpoint = copyData(
        await client.readCheckpoint(requested, admitted.signal),
        false
      );
      if (!valid()) return;
      o.children.finish(outcome);
      o.loading = true;
      await o.session.load({ signal: admitted.signal });
      if (!valid()) return;
      const source = o.session.getSnapshot(),
        loaded = copyData(source) as NativeSnapshot;
      if (!valid()) return;
      const authority = captureAuthority({
        turn: o.turn,
        owner: o.key,
        generation: o.serial,
        threadId: o.id,
        outcome,
        observedState,
        history,
        loadedCheckpoint,
        snapshot: live,
        loadedSnapshot: loaded,
      });
      if (authority.kind !== 'terminal' || o.children.incomplete)
        throw Error('Unconfirmed authority');
      const projection = projectParentObservations(
        loaded.messages,
        loaded.toolCalls,
        o.budget,
        'parents',
        authority.rawToolStatuses
      );
      if (projection.status !== 'available')
        throw Error('Unavailable final display');
      const rows = o.content.project({
        status: loaded.status as AgentStatus,
        messages: loaded.messages,
        toolCalls: loaded.toolCalls,
      });
      if (!valid()) return;
      const latest = o.session.getSnapshot();
      if (!valid()) return;
      if (latest !== source) throw Error('Changed source before publication');
      o.confirmed = loaded;
      o.rawStatuses = authority.rawToolStatuses;
      const baseline = captureBaseline({ messages: authority.messages });
      if (!baseline) throw Error('Unavailable baseline');
      o.baseline = baseline;
      o.text = undefined;
      o.turn = undefined;
      o.loading = false;
      o.projection = projection;
      publish({
        rows,
        observations: projection.cards,
        taskCount: projection.taskCount,
        childObservations: o.children.rows(),
        outcome,
        canSubmit: true,
      });
    } catch {
      if (current()) {
        if (owner) owner.unsafe = true;
        blocked(owner);
      }
    } finally {
      if (current()) {
        operation = undefined;
        publish({ busy: false, activity: 'idle' });
      }
    }
  }
  async function stop() {
    if (disposed || !operation) return;
    operation.abort();
    operation = undefined;
    const o = owner;
    o?.children.finish('aborted');
    const children = o?.children.rows() ?? snapshot.childObservations;
    const p = detach();
    publish({
      busy: false,
      canSubmit: false,
      activity: 'idle',
      outcome: 'aborted',
      error: null,
      childObservations: children,
    });
    await Promise.all([p, bounded(() => o?.session.stop())]);
  }
  async function newConversation() {
    if (disposed) return;
    operation?.abort();
    operation = undefined;
    owner?.children.finish('new');
    const p = detach();
    snapshot = initial(snapshot.viewGeneration + 1);
    publish({});
    await p;
  }
  function dispose() {
    if (disposal) return disposal;
    disposed = true;
    operation?.abort();
    operation = undefined;
    void detach();
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
    dispose,
  };
}
