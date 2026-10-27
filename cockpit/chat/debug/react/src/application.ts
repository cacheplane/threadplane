import type { AgentSnapshot, Message } from '@threadplane/core';
import {
  createMessageContent,
  type MessageRow,
} from '@threadplane/content/messages';
import type {
  DebugCheckpointPage,
  DebugCurrentObservation,
  DebugInspection,
  DebugRefreshRequest,
  DebugSelection,
} from '@threadplane/react/debug';
import {
  captureBaseline,
  captureFirstHuman,
  captureSemanticMessages,
  confirmLiveTurn,
  confirmReload,
  type DebugSnapshot,
  type FirstHuman,
  type SemanticMessage,
} from './authority';
import {
  captureCheckpoint,
  captureCheckpointPage,
  sameCheckpoint,
  selectCheckpoint,
  type CheckpointPage,
} from './checkpoint-page';
import {
  captureData,
  captureInspectionValues,
  ownField,
} from './inspection-values';
import type { DebugClient, DebugSession } from './connection';

export interface ApplicationSnapshot {
  readonly contextKey: string;
  readonly threadId: string | null;
  readonly rows: readonly MessageRow[];
  readonly activity:
    | 'idle'
    | 'creating'
    | 'running'
    | 'confirming'
    | 'refreshing'
    | 'inspecting'
    | 'replacing'
    | 'cleanup-failed';
  readonly busy: boolean;
  readonly canSubmit: boolean;
  /** False means the latest attempt is unconfirmed; rows show the last confirmed state. */
  readonly confirmed: boolean;
  readonly error: string | null;
  readonly readError: string | null;
  readonly current: DebugCurrentObservation;
  readonly checkpointPage?: DebugCheckpointPage;
  readonly selection?: DebugSelection;
  readonly inspection: DebugInspection;
}
type Methods = Required<
  Pick<
    DebugSession,
    'getSnapshot' | 'subscribe' | 'submit' | 'load' | 'stop' | 'dispose'
  >
>;
type Owner = {
  readonly id: string;
  readonly methods: Methods;
  readonly content: ReturnType<typeof createMessageContent>;
  release?: () => void;
  closed: boolean;
  safe: boolean;
  prefix: readonly SemanticMessage[];
  generations: Set<string>;
  confirmedRows: readonly MessageRow[];
  turn?: {
    input: string;
    observed: boolean;
    human?: FirstHuman;
    error: boolean;
  };
};
type Operation = {
  readonly kind: 'send' | 'refresh' | 'inspect';
  readonly epoch: number;
  readonly controller: AbortController;
  readonly done: Promise<void>;
  readonly settle: () => void;
};
const EMPTY = Object.freeze([]);

/** Captures native message meaning and delivery separately, without imposing inspector text limits. */
function captureNative(
  raw: unknown
): Omit<DebugSnapshot, 'messages' | 'status' | 'toolCalls' | 'error'> &
  AgentSnapshot {
  const error = ownField(raw, 'error');
  if (error !== undefined && error !== null)
    throw Error('Native observation failed.');
  const source = ownField(raw, 'messages'),
    semantic = captureSemanticMessages(source);
  if (!semantic || !Array.isArray(source))
    throw Error('Invalid native observation.');
  const messages = Object.freeze(
    semantic.map((m, i) => {
      const delivery = ownField(ownField(source, String(i)), 'delivery');
      return Object.freeze({
        ...m,
        delivery: captureData(delivery),
      }) as unknown as Message;
    })
  );
  const values = captureInspectionValues(ownField(raw, 'values'));
  const rawHistory = ownField(raw, 'history');
  let history: readonly unknown[] | undefined;
  if (rawHistory !== undefined) {
    if (!Array.isArray(rawHistory) || rawHistory.length > 10)
      throw Error('Invalid history.');
    history = Object.freeze(
      Array.from({ length: rawHistory.length }, (_, i) => {
        const row = ownField(rawHistory, String(i)),
          result: Record<string, unknown> = {};
        for (const k of [
          'checkpoint',
          'next',
          'created_at',
          'parent_checkpoint',
        ]) {
          const v = ownField(row, k);
          if (v !== undefined) result[k] = captureData(v);
        }
        return Object.freeze(result);
      })
    );
  }
  return Object.freeze({
    status: ownField(raw, 'status') as AgentSnapshot['status'],
    messages,
    toolCalls: captureData(
      ownField(raw, 'toolCalls')
    ) as AgentSnapshot['toolCalls'],
    interrupts: captureData(ownField(raw, 'interrupts')) as readonly unknown[],
    subgraphs: captureData(ownField(raw, 'subgraphs')) as readonly unknown[],
    values: values.kind === 'available' ? values.values : undefined,
    history,
  });
}
/** Own the current read before awaiting the exact read: no SDK object crosses an await. */
function captureSaved(raw: unknown, threadId: string) {
  const checkpoint = captureCheckpoint(ownField(raw, 'checkpoint'), threadId);
  const rawValues = ownField(raw, 'values'),
    messages = captureSemanticMessages(ownField(rawValues, 'messages'));
  const values = captureInspectionValues(rawValues);
  if (!checkpoint || !messages || values.kind !== 'available')
    throw Error('Saved observation unavailable.');
  const result: Record<string, unknown> = {
    checkpoint,
    values: Object.freeze({ ...values.values, messages }),
  };
  for (const k of [
    'next',
    'tasks',
    'interrupts',
    '__interrupt__',
    'subgraphs',
    'toolCalls',
    'error',
  ]) {
    const value = ownField(raw, k);
    if (value !== undefined) result[k] = captureData(value);
  }
  return Object.freeze(result);
}
function panelPage(page: CheckpointPage): DebugCheckpointPage {
  return Object.freeze({
    contextKey: page.context,
    pageGeneration: page.generation,
    truncated: false,
    rows: Object.freeze(
      page.rows.map((row) =>
        Object.freeze({
          rowKey: row.key,
          label:
            row.checkpoint?.checkpoint_id ??
            `Checkpoint ${row.ordinal + 1} (identity unavailable)`,
          inspectable: row.inspectable,
          ...(row.createdAt ? { createdAt: row.createdAt } : {}),
          ...(row.next ? { next: row.next } : {}),
          ...(row.parentCheckpoint
            ? { parentLabel: row.parentCheckpoint.checkpoint_id }
            : {}),
        })
      )
    ),
  });
}

/** One lazy conversation, one admitted operation, and one cleanup owner. */
export function createDebugApplication(client: DebugClient) {
  // Freeze bound own-data capabilities once; later property replacement cannot redirect a read.
  const capabilities = Object.fromEntries(
    [
      'createThread',
      'sessionFactory',
      'readCurrent',
      'readCheckpoint',
      'readHistory',
    ].map((key) => {
      const method = ownField(client, key);
      if (typeof method !== 'function')
        throw Error('Runtime client is unavailable.');
      return [key, method.bind(client)];
    })
  ) as unknown as DebugClient;
  let epoch = 0,
    pageGeneration = 0,
    owner: Owner | undefined,
    page: CheckpointPage | undefined,
    active: Operation | undefined;
  let disposed = false,
    cleanupFailed = false,
    requiresNew = false,
    revoking = 0,
    disposal: Promise<void> | undefined;
  const listeners = new Set<() => void>(),
    pending = new Set<Promise<void>>();
  const context = () => `conversation-${epoch}`;
  let snapshot: ApplicationSnapshot = Object.freeze({
    contextKey: context(),
    threadId: null,
    rows: EMPTY,
    activity: 'idle',
    busy: false,
    canSubmit: true,
    confirmed: false,
    error: null,
    readError: null,
    current: Object.freeze({ contextKey: context(), status: 'unknown' }),
    inspection: Object.freeze({ status: 'idle' }),
  });
  function publish(update: Partial<ApplicationSnapshot>) {
    if (disposed) return;
    snapshot = Object.freeze({
      ...snapshot,
      ...update,
      ...(cleanupFailed
        ? {
            canSubmit: false,
            activity: 'cleanup-failed' as const,
            error:
              'The conversation could not close safely. Reload the preview to continue.',
          }
        : {}),
    });
    for (const notify of [...listeners]) {
      try {
        notify();
      } catch {
        /* Observers cannot block revocation. */
      }
    }
  }
  function track(work: Promise<unknown>) {
    const done = work.then(
      () => undefined,
      () => undefined
    );
    pending.add(done);
    void done.then(() => pending.delete(done));
    return done;
  }
  async function drain() {
    while (pending.size) await Promise.all([...pending]);
  }
  function quarantine() {
    cleanupFailed = true;
    publish({ canSubmit: false });
  }
  function close(selected: Owner, stopping: boolean) {
    if (selected.closed) return;
    selected.closed = true;
    const release = selected.release;
    selected.release = undefined;
    // Install the cleanup in the ledger before invoking release or any native method.
    let resolve!: () => void;
    const done = new Promise<void>((yes) => {
      resolve = yes;
    });
    track(done);
    let releasing: Promise<void> = Promise.resolve();
    try {
      releasing = Promise.resolve(release?.()).catch(() => {
        quarantine();
      });
    } catch {
      quarantine();
    }
    try {
      selected.content.dispose();
    } catch {
      quarantine();
    }
    void (async () => {
      try {
        if (stopping) {
          try {
            await selected.methods.stop();
          } catch {
            quarantine();
          }
        }
        try {
          await selected.methods.dispose();
        } catch {
          quarantine();
        }
      } finally {
        await releasing;
        resolve();
      }
    })();
  }
  function begin(kind: Operation['kind']): Operation {
    let settle!: () => void;
    const done = new Promise<void>((yes) => {
      settle = yes;
    });
    track(done);
    const operation: Operation = {
      kind,
      epoch,
      controller: new AbortController(),
      done,
      settle,
    };
    active = operation;
    return operation;
  }
  const valid = (op: Operation, selected?: Owner) =>
    !disposed &&
    !cleanupFailed &&
    active === op &&
    epoch === op.epoch &&
    !op.controller.signal.aborted &&
    (!selected || (owner === selected && !selected.closed));
  function end(op: Operation) {
    if (active === op) {
      active = undefined;
      publish({
        busy: false,
        activity: 'idle',
        canSubmit:
          !cleanupFailed && !revoking && !requiresNew && (!owner || owner.safe),
      });
    }
    op.settle();
  }
  function admitted() {
    return (
      !disposed && !cleanupFailed && !revoking && !active && !snapshot.busy
    );
  }
  async function acquire(op: Operation) {
    if (!valid(op)) return;
    const id = await capabilities.createThread(op.controller.signal);
    if (!valid(op)) return;
    if (typeof id !== 'string' || !id) throw Error('Unconfirmed conversation.');
    let candidate: DebugSession;
    try {
      candidate = await capabilities.sessionFactory(id);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'Runtime session cleanup failed.'
      )
        quarantine();
      throw error;
    }
    // The connection already binds these own-data methods. Capture once and validate after each boundary.
    const methods: Partial<Methods> = {};
    let selected: Owner | undefined;
    try {
      for (const key of [
        'dispose',
        'stop',
        'getSnapshot',
        'subscribe',
        'submit',
        'load',
      ] as const) {
        const method = ownField(candidate, key);
        if (typeof method !== 'function')
          throw Error('Missing native capability.');
        Object.defineProperty(methods, key, {
          value: method,
          enumerable: true,
        });
      }
      selected = {
        id,
        methods: methods as Methods,
        content: createMessageContent(),
        closed: false,
        safe: true,
        prefix: EMPTY,
        generations: new Set(),
        confirmedRows: EMPTY,
      };
      if (!valid(op)) {
        close(selected, false);
        return;
      }
      const raw = selected.methods.getSnapshot();
      if (!valid(op)) {
        close(selected, false);
        return;
      }
      const initial = captureNative(raw);
      if (!valid(op)) {
        close(selected, false);
        return;
      }
      if (
        initial.status !== 'idle' ||
        initial.error ||
        initial.messages.length ||
        initial.toolCalls.length ||
        initial.interrupts.length ||
        initial.subgraphs.length ||
        initial.history?.length
      )
        throw Error('Session must start empty.');
      owner = selected;
      const target = selected;
      const release = target.methods.subscribe(() => {
        // Inert observation only: no execution or direct SDK reads in this callback.
        const observing = active;
        if (
          !observing ||
          observing.kind !== 'send' ||
          !valid(observing, target) ||
          !target.turn
        )
          return;
        try {
          const raw = target.methods.getSnapshot();
          if (!valid(observing, target)) return;
          const observed = captureNative(raw);
          if (!valid(observing, target)) return;
          const turn = target.turn;
          if (
            !turn.observed &&
            observed.status === 'running' &&
            observed.messages.length === target.prefix.length + 1
          ) {
            turn.observed = true;
            turn.human = captureFirstHuman(observed, target.prefix, turn.input);
          }
          if (!valid(observing, target)) return;
          const rows = target.content.project(observed);
          if (!valid(observing, target)) return;
          publish({ rows });
        } catch {
          if (valid(observing, target) && target.turn) target.turn.error = true;
        }
      });
      if (typeof release !== 'function') throw Error('Missing release.');
      if (target.closed) {
        try {
          await release();
        } catch {
          quarantine();
        }
        return;
      }
      target.release = release;
      if (!valid(op, target)) {
        close(target, false);
        return;
      }
      publish({ threadId: id, activity: 'running' });
      if (!valid(op, target)) return;
      return target;
    } catch (error) {
      if (selected) close(selected, false);
      else {
        // A malformed facade is quarantined if its captured disposal cannot complete.
        try {
          const dispose = methods.dispose;
          if (!dispose) throw Error('No cleanup.');
          await dispose();
        } catch {
          quarantine();
        }
      }
      throw error;
    }
  }
  function unconfirmed(selected: Owner) {
    selected.safe = false;
    selected.turn = undefined;
    publish({
      canSubmit: false,
      confirmed: false,
      rows: selected.confirmedRows,
      error:
        'The response could not be confirmed. Last confirmed conversation shown. Start a new conversation to continue.',
    });
  }
  async function submit(input: string, contextKey = snapshot.contextKey) {
    if (
      !admitted() ||
      !snapshot.canSubmit ||
      contextKey !== snapshot.contextKey ||
      typeof input !== 'string' ||
      !input.trim()
    )
      return;
    const op = begin('send');
    publish({
      busy: true,
      canSubmit: false,
      activity: owner ? 'running' : 'creating',
      error: null,
      readError: null,
    });
    let selected: Owner | undefined;
    try {
      if (!valid(op)) return;
      selected = owner ?? (await acquire(op));
      if (!selected || !valid(op, selected)) return;
      const target = selected;
      // Rebind the observation callback's operation for later turns via a single current operation.
      const raw = target.methods.getSnapshot();
      if (!valid(op, target)) return;
      const before = captureNative(raw);
      if (!valid(op, target)) return;
      const prefix = captureBaseline(before.messages);
      if (
        !target.safe ||
        before.status !== 'idle' ||
        !prefix ||
        JSON.stringify(prefix) !== JSON.stringify(target.prefix) ||
        before.error ||
        before.toolCalls.length ||
        before.interrupts.length ||
        before.subgraphs.length
      )
        throw Error('Invalid baseline.');
      target.turn = { input, observed: false, error: false };
      const result = await target.methods.submit(input, {
        signal: op.controller.signal,
      });
      if (!valid(op, target)) return;
      const finalRaw = target.methods.getSnapshot();
      if (!valid(op, target)) return;
      const live = captureNative(finalRaw);
      if (!valid(op, target)) return;
      const turn = target.turn;
      if (
        result !== 'success' ||
        !turn ||
        turn.error ||
        !turn.human ||
        target.generations.has(turn.human.generation)
      )
        throw Error('Unconfirmed live turn.');
      publish({ activity: 'confirming' });
      if (!valid(op, target)) return;
      const rawCurrent = await capabilities.readCurrent(
        target.id,
        op.controller.signal
      );
      if (!valid(op, target)) return;
      const current = captureSaved(rawCurrent, target.id);
      if (!valid(op, target)) return;
      const cp = captureCheckpoint(ownField(current, 'checkpoint'), target.id);
      if (!valid(op, target) || !cp) throw Error('Missing checkpoint.');
      const rawExact = await capabilities.readCheckpoint(
        cp,
        op.controller.signal
      );
      if (!valid(op, target)) return;
      const exact = captureSaved(rawExact, target.id);
      if (!valid(op, target)) return;
      const authority = confirmLiveTurn({
        prefix: target.prefix,
        human: turn.human,
        generation: turn.human.generation,
        snapshot: live,
        current,
        exact,
        threadId: target.id,
      });
      if (!valid(op, target)) return;
      if (!authority) throw Error('Saved response mismatch.');
      await target.methods.load({ signal: op.controller.signal });
      if (!valid(op, target)) return;
      const reloadRaw = target.methods.getSnapshot();
      if (!valid(op, target)) return;
      const reload = captureNative(reloadRaw);
      if (!valid(op, target)) return;
      if (!confirmReload({ authority, snapshot: reload, threadId: target.id }))
        throw Error('Reload mismatch.');
      if (!valid(op, target)) return;
      const values = captureInspectionValues(ownField(current, 'values'));
      const ownedPage = captureCheckpointPage(
        reload.history,
        context(),
        target.id,
        ++pageGeneration
      );
      if (
        !valid(op, target) ||
        values.kind !== 'available' ||
        ownedPage.kind !== 'available'
      )
        throw Error('Confirmation unavailable.');
      const rows = target.content.project(reload);
      if (!valid(op, target)) return;
      target.prefix = authority.messages;
      target.generations.add(turn.human.generation);
      target.turn = undefined;
      target.confirmedRows = rows;
      page = ownedPage;
      publish({
        rows,
        confirmed: true,
        error: null,
        current: Object.freeze({
          contextKey: context(),
          status: 'ready',
          values: values.values,
        }),
        checkpointPage: panelPage(ownedPage),
        selection: undefined,
        inspection: Object.freeze({ status: 'idle' }),
      });
    } catch {
      if (valid(op)) {
        requiresNew = true;
        if (selected) unconfirmed(selected);
        else
          publish({
            canSubmit: false,
            confirmed: false,
            error:
              'The conversation could not start safely. Start a new conversation to continue.',
          });
      }
    } finally {
      end(op);
    }
  }
  function refresh(input: DebugRefreshRequest): Promise<void> {
    let request: DebugRefreshRequest;
    try {
      const contextKey = ownField(input, 'contextKey'),
        generation = ownField(input, 'pageGeneration');
      if (
        typeof contextKey !== 'string' ||
        !(
          generation === null ||
          (typeof generation === 'number' && Number.isSafeInteger(generation))
        )
      )
        return Promise.resolve();
      request = Object.freeze({ contextKey, pageGeneration: generation });
    } catch {
      return Promise.resolve();
    }
    if (
      !admitted() ||
      !owner ||
      request.contextKey !== snapshot.contextKey ||
      request.pageGeneration !==
        (snapshot.checkpointPage?.pageGeneration ?? null)
    )
      return Promise.resolve();
    const target = owner,
      op = begin('refresh');
    publish({
      busy: true,
      canSubmit: false,
      activity: 'refreshing',
      selection: undefined,
      inspection: Object.freeze({ status: 'idle' }),
      readError: null,
    });
    return (async () => {
      try {
        if (!valid(op, target)) return;
        const raw = await capabilities.readHistory(
          target.id,
          op.controller.signal
        );
        if (!valid(op, target)) return;
        const next = captureCheckpointPage(
          raw,
          context(),
          target.id,
          ++pageGeneration
        );
        if (!valid(op, target)) return;
        if (next.kind !== 'available') throw Error('Unavailable page.');
        page = next;
        publish({ checkpointPage: panelPage(next) });
      } catch {
        if (valid(op, target))
          publish({
            readError:
              'History refresh failed. Last observed checkpoint page retained.',
            selection: undefined,
            inspection: Object.freeze({ status: 'idle' }),
          });
      } finally {
        end(op);
      }
    })();
  }
  function inspect(input: DebugSelection): Promise<void> {
    let request: DebugSelection;
    try {
      const contextKey = ownField(input, 'contextKey'),
        generation = ownField(input, 'pageGeneration'),
        rowKey = ownField(input, 'rowKey');
      if (
        typeof contextKey !== 'string' ||
        typeof generation !== 'number' ||
        !Number.isSafeInteger(generation) ||
        typeof rowKey !== 'string'
      )
        return Promise.resolve();
      request = Object.freeze({
        contextKey,
        pageGeneration: generation,
        rowKey,
      });
    } catch {
      return Promise.resolve();
    }
    if (!admitted() || !owner || !page) return Promise.resolve();
    const target = owner,
      cp = selectCheckpoint(page, {
        context: request.contextKey,
        threadId: target.id,
        generation: request.pageGeneration,
        key: request.rowKey,
      });
    if (!cp || request.contextKey !== snapshot.contextKey)
      return Promise.resolve();
    const selection = Object.freeze({
      contextKey: request.contextKey,
      pageGeneration: request.pageGeneration,
      rowKey: request.rowKey,
    });
    const op = begin('inspect');
    publish({
      busy: true,
      canSubmit: false,
      activity: 'inspecting',
      selection,
      inspection: Object.freeze({ status: 'loading', selection }),
      readError: null,
    });
    return (async () => {
      try {
        if (!valid(op, target)) return;
        const raw = await capabilities.readCheckpoint(cp, op.controller.signal);
        if (!valid(op, target)) return;
        const returned = captureCheckpoint(
          ownField(raw, 'checkpoint'),
          target.id
        );
        if (!valid(op, target)) return;
        if (!sameCheckpoint(cp, returned))
          throw Error('Mismatched checkpoint.');
        const values = captureInspectionValues(ownField(raw, 'values'));
        if (!valid(op, target)) return;
        publish({
          readError:
            values.kind === 'available'
              ? null
              : 'Checkpoint values are unavailable.',
          inspection:
            values.kind === 'available'
              ? Object.freeze({
                  status: 'ready',
                  selection,
                  values: values.values,
                })
              : Object.freeze({
                  status: 'unavailable',
                  selection,
                  message: 'Checkpoint values are unavailable.',
                }),
        });
      } catch {
        if (valid(op, target))
          publish({
            readError: 'Checkpoint inspection failed.',
            inspection: Object.freeze({
              status: 'error',
              selection,
              message: 'Checkpoint inspection failed.',
            }),
          });
      } finally {
        end(op);
      }
    })();
  }
  function revoke(replacing: boolean) {
    const selected = owner,
      operation = active;
    // Authority is gone before abort, release, stop, dispose, or observer notification.
    epoch++;
    revoking++;
    requiresNew = !replacing;
    owner = undefined;
    active = undefined;
    page = undefined;
    pageGeneration++;
    publish({
      contextKey: context(),
      threadId: null,
      rows: replacing ? EMPTY : selected?.confirmedRows ?? EMPTY,
      confirmed: false,
      current: Object.freeze({ contextKey: context(), status: 'unknown' }),
      checkpointPage: undefined,
      selection: undefined,
      inspection: Object.freeze({ status: 'idle' }),
      busy: true,
      canSubmit: false,
      activity: 'replacing',
      readError: null,
      error: replacing
        ? null
        : 'Stopped. Start a new conversation to continue.',
    });
    operation?.controller.abort();
    if (selected) close(selected, operation?.kind === 'send');
    return (async () => {
      await drain();
      revoking--;
      // Every New updates the shared intent; an older Stop cannot overwrite it.
      if (!disposed && !revoking)
        publish({
          busy: false,
          activity: 'idle',
          canSubmit: !requiresNew && !cleanupFailed,
        });
    })();
  }
  function newConversation() {
    if (disposed) return Promise.resolve();
    return revoke(true);
  }
  function stop() {
    const op = active;
    if (!op || disposed) return Promise.resolve();
    if (op.kind !== 'send') {
      op.controller.abort();
      if (!disposed && active === op)
        publish({
          selection: undefined,
          inspection: Object.freeze({ status: 'idle' }),
          readError: 'Read stopped. Last confirmed conversation retained.',
        });
      return op.done;
    }
    return revoke(false);
  }
  function dispose() {
    if (disposal) return disposal;
    // Install a stable disposal promise before any reentrant cleanup can call dispose again.
    let resolve!: () => void;
    disposal = new Promise<void>((yes) => {
      resolve = yes;
    });
    disposed = true;
    epoch++;
    const selected = owner,
      op = active;
    owner = undefined;
    active = undefined;
    page = undefined;
    snapshot = Object.freeze({
      ...snapshot,
      contextKey: context(),
      threadId: null,
      rows: EMPTY,
      current: Object.freeze({ contextKey: context(), status: 'unknown' }),
      checkpointPage: undefined,
      selection: undefined,
      inspection: Object.freeze({ status: 'idle' }),
      confirmed: false,
      readError: null,
      busy: false,
      canSubmit: false,
    });
    listeners.clear();
    op?.controller.abort();
    if (selected) close(selected, op?.kind === 'send');
    void drain().then(resolve);
    return disposal;
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      if (!disposed) listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    submit,
    refresh,
    inspect,
    newConversation,
    stop,
    dispose,
  };
}
export type DebugApplication = ReturnType<typeof createDebugApplication>;
