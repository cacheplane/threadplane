import type {
  AgentSession,
  AgentSnapshot,
  CompleteOutcome,
  Message,
  ToolCall,
} from '@threadplane/core';
import {
  createMessageContent,
  type MessageRow,
} from '@threadplane/content/messages';
import {
  copyJson,
  inspectJson,
  ownValue,
  plainRecord,
  workspaceState,
  type WorkspaceState,
  type PlainValue,
} from './workspace-state';
import {
  approvalState,
  createDecision,
  type ApprovalState,
  type Choice,
} from './approval-state';
import {
  captureAuthority,
  captureBaseline,
  captureTurn,
  captureResume,
  checkpointSource,
  sameObservedAuthority,
  type Authority,
  type AuthorityInput,
  type Checkpoint,
  type FilesystemSnapshot,
  type Turn,
} from './authority';
export interface FilesystemSession extends Omit<AgentSession, 'getSnapshot'> {
  getSnapshot(): AgentSnapshot & FilesystemSnapshot;
  load(options?: { readonly signal?: AbortSignal }): Promise<void>;
  resume(
    value: PlainValue,
    options?: { readonly signal?: AbortSignal }
  ): Promise<CompleteOutcome>;
}
export interface FilesystemClient {
  createThread(signal: AbortSignal): Promise<string>;
  sessionFactory(threadId: string): FilesystemSession;
  readCurrent(threadId: string, signal: AbortSignal): Promise<unknown>;
  readCheckpoint(source: Checkpoint, signal: AbortSignal): Promise<unknown>;
}
type Workspace = Exclude<WorkspaceState, { kind: 'invalid' }>;
export interface FilesystemApplicationSnapshot {
  readonly threadId: string | null;
  readonly rows: readonly MessageRow[];
  readonly messages: readonly Message[];
  readonly toolCalls: readonly ToolCall[];
  readonly observedWorkspace: Workspace;
  readonly savedWorkspace: Workspace;
  readonly approval: ApprovalState | null;
  readonly decisionToken: string | null;
  readonly phase:
    | 'idle'
    | 'working'
    | 'confirming'
    | 'paused'
    | 'saved'
    | 'stopped'
    | 'failed'
    | 'unconfirmed';
  readonly busy: boolean;
  readonly canSubmit: boolean;
  readonly outcome: CompleteOutcome | null;
  readonly notice: string | null;
  readonly error: string | null;
  readonly viewGeneration: number;
}
const empty = (): FilesystemApplicationSnapshot =>
  Object.freeze({
    threadId: null,
    rows: Object.freeze([]),
    messages: Object.freeze([]),
    toolCalls: Object.freeze([]),
    observedWorkspace: Object.freeze({
      kind: 'missing',
      files: Object.freeze([]),
    }),
    savedWorkspace: Object.freeze({
      kind: 'missing',
      files: Object.freeze([]),
    }),
    approval: null,
    decisionToken: null,
    phase: 'idle',
    busy: false,
    canSubmit: true,
    outcome: null,
    notice: null,
    error: null,
    viewGeneration: 0,
  });
/** Native state remains transient. Copy canonical metadata only, never the raw file map. */
function metadata(source: FilesystemSnapshot): FilesystemSnapshot {
  inspectJson(source, true, [['values'], ['history', '0', 'values']]);
  const omit = (input: object, keys: string[]) =>
    Object.fromEntries(
      Object.keys(input)
        .filter((k) => !keys.includes(k))
        .map((k) => [k, ownValue(input, k)])
    );
  const history = ownValue(source, 'history');
  const copied = copyJson(
    {
      ...omit(source, ['values', 'history']),
      ...(Array.isArray(history)
        ? {
            history: history.map((x) => {
              if (!plainRecord(x)) throw Error('Unavailable history');
              return omit(x, ['values']);
            }),
          }
        : {}),
    },
    true
  ) as FilesystemSnapshot;
  return {
    ...copied,
    values: ownValue(source, 'values'),
    history: history as readonly unknown[] | undefined,
  };
}
export function createFilesystemApplication(client: FilesystemClient) {
  type Owner = {
    id: string;
    identity: string;
    session: FilesystemSession;
    content: ReturnType<typeof createMessageContent>;
    release?: () => void;
    closed: boolean;
    authority: Authority;
  };
  type Attempt = {
    controller: AbortController;
    owner?: Owner;
    generation: string;
    view: number;
    text: string;
    turn?: Turn;
    baseline?: ReturnType<typeof captureBaseline>;
    submitting?: boolean;
    saving?: boolean;
    previousHumanIds?: Set<string>;
    previousGenerations?: Set<string>;
  };
  let snapshot = empty(),
    owner: Owner | undefined,
    attempt: Attempt | undefined,
    disposed = false,
    disposal: Promise<void> | undefined;
  const listeners = new Set<() => void>(),
    cleanups = new Set<Promise<void>>();
  const current = (run: Attempt) =>
    !disposed &&
    attempt === run &&
    !run.controller.signal.aborted &&
    snapshot.viewGeneration === run.view &&
    (!run.owner || (owner === run.owner && !run.owner.closed));
  function publish(update: Partial<FilesystemApplicationSnapshot>) {
    if (disposed) return;
    snapshot = Object.freeze({ ...snapshot, ...update });
    for (const notify of [...listeners]) notify();
  }
  function close(selected: Owner) {
    if (selected.closed) return Promise.resolve();
    selected.closed = true;
    selected.release?.();
    selected.content.dispose();
    let timer: ReturnType<typeof setTimeout>;
    const task = Promise.race([
      Promise.resolve()
        .then(() => selected.session.dispose())
        .catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 2000);
      }),
    ]).finally(() => clearTimeout(timer));
    cleanups.add(task);
    void task.then(() => cleanups.delete(task));
    return task;
  }
  function observe(run: Attempt) {
    if (!run.owner || !current(run)) return;
    const source = run.owner.session.getSnapshot();
    if (!current(run)) return;
    const state = metadata(source);
    if (
      !Array.isArray(state.messages) ||
      !Array.isArray(state.toolCalls) ||
      !Array.isArray(state.interrupts) ||
      !Array.isArray(state.subgraphs)
    )
      throw Error('Unavailable native state');
    if (!run.turn && run.submitting && !run.saving && run.baseline) {
      const humans = state.messages.filter(
        (m) => m.role === 'user' && !run.previousHumanIds?.has(m.id)
      );
      const human = humans.length === 1 ? humans[0] : undefined;
      if (
        human?.content === run.text &&
        human.delivery.generation &&
        !run.previousGenerations?.has(human.delivery.generation)
      )
        run.turn = captureTurn(run.baseline, {
          owner: run.owner.identity,
          generation: run.generation,
          threadId: run.owner.id,
          humanId: human.id,
          humanContent: run.text,
        });
    }
    const workspace = workspaceState(state.values);
    const rows = run.owner.content.project(state as AgentSnapshot);
    if (!current(run)) return;
    publish({
      rows,
      messages: state.messages,
      toolCalls: state.toolCalls,
      ...(workspace.kind === 'invalid'
        ? {
            notice:
              'The current files update is unavailable. The last confirmed workspace is retained.',
          }
        : { observedWorkspace: workspace, notice: null }),
    });
    return state;
  }
  function finish(
    run: Attempt,
    phase: FilesystemApplicationSnapshot['phase'],
    outcome: CompleteOutcome | null,
    error: string | null,
    canSubmit = false
  ) {
    if (!current(run)) return;
    attempt = undefined;
    publish({ busy: false, phase, outcome, error, canSubmit });
  }
  function input(
    run: Attempt,
    state: FilesystemSnapshot,
    raw: unknown,
    outcome: string,
    checkpoint: unknown
  ): AuthorityInput {
    return {
      turn: run.turn,
      owner: run.owner!.identity,
      generation: run.generation,
      threadId: run.owner!.id,
      outcome,
      observedCheckpoint: checkpoint,
      observedValues: plainRecord(raw) ? ownValue(raw, 'values') : undefined,
      loadedCheckpoint: raw,
      snapshot: state,
    };
  }
  async function confirm(run: Attempt, outcome: CompleteOutcome) {
    if (!run.owner || !current(run)) return false;
    const selected = run.owner;
    run.saving = true;
    publish({ phase: 'confirming' });
    if (!current(run)) return false;
    await selected.session.load({ signal: run.controller.signal });
    if (!current(run)) return false;
    const state = observe(run);
    const checkpoint =
      state &&
      checkpointSource(
        plainRecord(state.history?.[0])
          ? ownValue(state.history![0] as object, 'checkpoint')
          : undefined,
        selected.id
      );
    if (!state || !checkpoint || !run.turn)
      throw Error('Unavailable exact checkpoint');
    const raw = await client.readCheckpoint(checkpoint, run.controller.signal);
    if (!current(run)) return false;
    const latest = observe(run);
    if (!latest || !current(run)) return false;
    const authority = captureAuthority(
      input(run, latest, raw, outcome, checkpoint)
    );
    if (!current(run)) return false;
    if (authority.kind === 'unconfirmed') {
      const proposal =
        latest.interrupts.length === 1
          ? approvalState(latest.interrupts[0])
          : null;
      publish({ approval: proposal?.kind === 'unavailable' ? proposal : null });
      throw Error('Unconfirmed authority');
    }
    selected.authority = authority;
    publish({
      savedWorkspace: authority.workspace,
      observedWorkspace: authority.workspace,
      approval: authority.kind === 'paused' ? authority.approval : null,
      decisionToken: authority.kind === 'paused' ? authority.signature : null,
    });
    finish(
      run,
      authority.kind === 'paused' ? 'paused' : 'saved',
      outcome,
      null,
      authority.kind === 'terminal'
    );
    return true;
  }
  function fail(run: Attempt, outcome: CompleteOutcome | null) {
    if (!current(run)) return;
    publish({
      approval:
        snapshot.approval?.kind === 'unavailable' ? snapshot.approval : null,
      decisionToken: null,
    });
    finish(
      run,
      outcome === 'success' || outcome === 'paused' ? 'unconfirmed' : 'failed',
      outcome ?? 'error',
      'The request or saved workspace could not be confirmed. The last confirmed workspace is retained. Start a new conversation to continue.'
    );
  }
  async function submit(text: string) {
    if (disposed || snapshot.busy || !snapshot.canSubmit || !text.trim())
      return false;
    const run: Attempt = {
      controller: new AbortController(),
      generation: crypto.randomUUID(),
      view: snapshot.viewGeneration,
      text,
    };
    attempt = run;
    publish({
      busy: true,
      canSubmit: false,
      phase: 'working',
      outcome: null,
      error: null,
      approval: null,
    });
    let outcome: CompleteOutcome | null = null;
    try {
      if (!current(run)) return false;
      if (!owner) {
        const id = await client.createThread(run.controller.signal);
        if (!current(run)) return false;
        if (typeof id !== 'string' || !id) throw Error('Unconfirmed creation');
        const selected: Owner = {
          id,
          identity: crypto.randomUUID(),
          session: client.sessionFactory(id),
          content: createMessageContent(),
          closed: false,
          authority: { kind: 'unconfirmed' },
        };
        if (!current(run)) {
          void close(selected);
          return false;
        }
        owner = selected;
        run.owner = selected;
        selected.release = selected.session.subscribe(() => {
          const active = attempt;
          if (active?.owner === selected && current(active)) {
            try {
              observe(active);
            } catch {
              /* Reconciliation fails closed. */
            }
          }
        });
        if (selected.closed) selected.release();
        if (!current(run)) return false;
        publish({ threadId: id });
      } else run.owner = owner;
      const selected = run.owner;
      if (!selected || !current(run)) return false;
      run.baseline = captureBaseline(
        selected.authority.kind === 'terminal'
          ? { messages: selected.authority.messages }
          : undefined
      );
      if (!run.baseline) throw Error('Unavailable prefix');
      if (selected.authority.kind === 'terminal') {
        const raw = await client.readCurrent(
          selected.id,
          run.controller.signal
        );
        if (!current(run)) return false;
        if (
          !plainRecord(raw) ||
          !plainRecord(ownValue(raw, 'values')) ||
          !checkpointSource(ownValue(raw, 'checkpoint'), selected.id)
        )
          throw Error('Foreign current state');
        const latest = ownValue(raw, 'checkpoint');
        if (
          JSON.stringify(latest) !==
          JSON.stringify(selected.authority.checkpoint)
        )
          throw Error('Conversation advanced');
      }
      const before = selected.session.getSnapshot();
      if (!current(run)) return false;
      run.previousHumanIds = new Set(
        before.messages.filter((m) => m.role === 'user').map((m) => m.id)
      );
      run.previousGenerations = new Set(
        before.messages.map((m) => m.delivery.generation)
      );
      run.submitting = true;
      outcome = await selected.session.submit(text, {
        signal: run.controller.signal,
      });
      if (!current(run)) return false;
      observe(run);
      if (!current(run)) return false;
      if (outcome !== 'success' && outcome !== 'paused')
        throw Error('Unconfirmed outcome');
      return await confirm(run, outcome);
    } catch {
      fail(run, outcome);
      return false;
    }
  }
  async function decide(choice: Choice, decisionToken: string | null) {
    const selected = owner,
      authority = selected?.authority;
    if (
      disposed ||
      snapshot.busy ||
      snapshot.phase !== 'paused' ||
      !selected ||
      authority?.kind !== 'paused' ||
      !decisionToken ||
      decisionToken !== authority.signature ||
      snapshot.decisionToken !== decisionToken ||
      snapshot.approval !== authority.approval ||
      !authority.approval.choices.includes(choice)
    )
      return false;
    const run: Attempt = {
      controller: new AbortController(),
      generation: crypto.randomUUID(),
      view: snapshot.viewGeneration,
      text: authority.turn.humanContent,
      owner: selected,
    };
    run.turn = captureResume(authority.turn, run.generation);
    attempt = run;
    publish({ busy: true, canSubmit: false, phase: 'confirming', error: null });
    let outcome: CompleteOutcome | null = null;
    try {
      if (!current(run)) return false;
      const raw = await client.readCurrent(selected.id, run.controller.signal);
      if (!current(run)) return false;
      // This MUST be the current head. Reading the old checkpoint alone misses external advancement.
      const state = observe(run);
      if (
        !state ||
        !current(run) ||
        (snapshot as FilesystemApplicationSnapshot).phase !== 'confirming'
      )
        return false;
      const preflight: AuthorityInput = {
        ...input(
          run,
          state,
          raw,
          'paused',
          plainRecord(raw) ? ownValue(raw, 'checkpoint') : undefined
        ),
        turn: authority.turn,
        generation: authority.turn.generation,
      };
      if (!sameObservedAuthority(authority, preflight))
        throw Error('Pause advanced');
      const decision = createDecision(
        authority.approval,
        authority.approval.signature,
        choice
      );
      if (
        !decision ||
        !current(run) ||
        (snapshot as FilesystemApplicationSnapshot).phase !== 'confirming'
      )
        throw Error('Unavailable whole batch');
      publish({ phase: 'working', approval: null, decisionToken: null });
      if (!current(run)) return false;
      outcome = await selected.session.resume(decision, {
        signal: run.controller.signal,
      });
      if (!current(run)) return false;
      observe(run);
      if (!current(run)) return false;
      if (outcome !== 'success' && outcome !== 'paused')
        throw Error('Unconfirmed resume');
      return await confirm(run, outcome);
    } catch {
      fail(run, outcome);
      return false;
    }
  }
  async function stop() {
    const run = attempt;
    if (disposed || (!run && snapshot.phase !== 'paused')) return;
    attempt = undefined;
    run?.controller.abort();
    publish({
      busy: false,
      canSubmit: false,
      phase: 'stopped',
      approval: null,
      decisionToken: null,
      outcome: 'aborted',
      error:
        'Response stopped. The last confirmed workspace is retained. Cancellation does not roll back backend files. Start a new conversation to continue.',
    });
    try {
      await (run?.owner ?? owner)?.session.stop();
    } catch {
      /* Not rollback. */
    }
  }
  async function newConversation() {
    if (disposed) return;
    attempt?.controller.abort();
    attempt = undefined;
    const previous = owner;
    owner = undefined;
    publish({ ...empty(), viewGeneration: snapshot.viewGeneration + 1 });
    if (previous) await close(previous);
  }
  function dispose() {
    if (disposal) return disposal;
    disposed = true;
    attempt?.controller.abort();
    attempt = undefined;
    const previous = owner;
    owner = undefined;
    if (previous) void close(previous);
    listeners.clear();
    return (disposal = Promise.all([...cleanups]).then(() => undefined));
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) {
      if (disposed) return () => undefined;
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    submit,
    decide,
    stop,
    newConversation,
    dispose,
  };
}
