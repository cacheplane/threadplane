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
import { copyJson, plainRecord, planState, type PlanState } from './plan-state';
import {
  captureBaseline,
  captureTurn,
  captureTerminal,
  checkpointSource,
  type Checkpoint,
  type PlanningSnapshot,
  type Turn,
} from './terminal';

export interface PlanningSession extends Omit<AgentSession, 'getSnapshot'> {
  getSnapshot(): AgentSnapshot & PlanningSnapshot;
  load(options?: { readonly signal?: AbortSignal }): Promise<void>;
}
export interface PlanningClient {
  createThread(signal: AbortSignal): Promise<string>;
  sessionFactory(threadId: string): PlanningSession;
  readCurrent(threadId: string, signal: AbortSignal): Promise<unknown>;
  readCheckpoint(source: Checkpoint, signal: AbortSignal): Promise<unknown>;
}
export interface PlanningApplicationSnapshot {
  readonly threadId: string | null;
  readonly rows: readonly MessageRow[];
  readonly messages: readonly Message[];
  readonly toolCalls: readonly ToolCall[];
  readonly observedPlan: Exclude<PlanState, { kind: 'invalid' }>;
  readonly savedPlan: Exclude<PlanState, { kind: 'invalid' }>;
  readonly phase:
    | 'idle'
    | 'working'
    | 'confirming'
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
const empty = (): PlanningApplicationSnapshot =>
  Object.freeze({
    threadId: null,
    rows: Object.freeze([]),
    messages: Object.freeze([]),
    toolCalls: Object.freeze([]),
    observedPlan: Object.freeze({ kind: 'missing' }),
    savedPlan: Object.freeze({ kind: 'missing' }),
    phase: 'idle',
    busy: false,
    canSubmit: true,
    outcome: null,
    notice: null,
    error: null,
    viewGeneration: 0,
  });

/** One lazy native owner. Live observation never grants saved authority. */
export function createPlanningApplication(client: PlanningClient) {
  type Owner = {
    id: string;
    identity: string;
    session: PlanningSession;
    content: ReturnType<typeof createMessageContent>;
    release?: () => void;
    closed: boolean;
    attempted: boolean;
    checkpointKnown: boolean;
  };
  type Attempt = {
    controller: AbortController;
    owner?: Owner;
    generation: string;
    turn?: Turn;
    baseline?: ReturnType<typeof captureBaseline>;
    text: string;
    view: number;
    submitting?: boolean;
    saving?: boolean;
    previousHumanIds?: ReadonlySet<string>;
    previousGenerations?: ReadonlySet<string>;
  };
  let snapshot = empty(),
    owner: Owner | undefined,
    attempt: Attempt | undefined,
    disposed = false,
    disposal: Promise<void> | undefined;
  const listeners = new Set<() => void>(),
    cleanups = new Set<Promise<void>>();
  const current = (run: Attempt, selected = run.owner) =>
    !disposed &&
    attempt === run &&
    !run.controller.signal.aborted &&
    snapshot.viewGeneration === run.view &&
    (!selected || (owner === selected && !selected.closed));
  function publish(update: Partial<PlanningApplicationSnapshot>) {
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
    const cleanup = Promise.race([
      Promise.resolve()
        .then(() => selected.session.dispose())
        .catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 2000);
      }),
    ]).finally(() => clearTimeout(timer));
    cleanups.add(cleanup);
    void cleanup.then(() => cleanups.delete(cleanup));
    return cleanup;
  }
  function observe(run: Attempt): PlanningSnapshot | undefined {
    const selected = run.owner;
    if (!selected || !current(run)) return;
    const source = selected.session.getSnapshot();
    if (!current(run)) return;
    const state = copyJson(source, true) as ReturnType<
      PlanningSession['getSnapshot']
    >;
    if (
      !Array.isArray(state.messages) ||
      !Array.isArray(state.toolCalls) ||
      !Array.isArray(state.interrupts) ||
      !Array.isArray(state.subgraphs)
    )
      throw Error('Unavailable native state');
    if (!run.turn && run.baseline && run.submitting && !run.saving) {
      // Native submit authors the ID. Bind its unique new user from the owned
      // live projection before any history load; loaded history cannot attest
      // what this submit authored. Raw prefix parity is checked separately.
      const humans = state.messages.filter(
        (message) =>
          message.role === 'user' && !run.previousHumanIds?.has(message.id)
      );
      const human = humans.length === 1 ? humans[0] : undefined;
      if (
        human?.content === run.text &&
        human.delivery.generation &&
        !run.previousGenerations?.has(human.delivery.generation)
      )
        run.turn = captureTurn(run.baseline, {
          owner: selected.identity,
          generation: run.generation,
          threadId: selected.id,
          humanId: human.id,
          humanContent: run.text,
        });
    }
    const plan = planState(state.values),
      rows = selected.content.project(state);
    if (!current(run)) return;
    publish({
      rows,
      messages: state.messages,
      toolCalls: state.toolCalls,
      ...(plan.kind === 'valid' ? { observedPlan: plan, notice: null } : {}),
      ...(plan.kind === 'invalid'
        ? {
            notice:
              'This plan update could not be displayed. Plans support up to 50 items, 2000 characters per item, and pending, in progress, or completed status. The prior valid plan is retained.',
          }
        : {}),
    });
    return current(run) ? state : undefined;
  }
  function finish(
    run: Attempt,
    phase: PlanningApplicationSnapshot['phase'],
    outcome: CompleteOutcome | null,
    error: string | null,
    canSubmit = true
  ) {
    if (!current(run)) return;
    attempt = undefined;
    publish({ busy: false, phase, outcome, error, canSubmit });
  }
  async function submit(text: string) {
    if (disposed || snapshot.busy || !snapshot.canSubmit || !text.trim())
      return false;
    const run: Attempt = {
      controller: new AbortController(),
      generation: crypto.randomUUID(),
      text,
      view: snapshot.viewGeneration,
    };
    attempt = run;
    publish({
      busy: true,
      canSubmit: false,
      phase: 'working',
      outcome: null,
      error: null,
    });
    let nativeSucceeded = false;
    try {
      if (!current(run)) return false;
      if (!owner) {
        const id = await client.createThread(run.controller.signal);
        if (!current(run)) return false;
        if (!id || typeof id !== 'string') throw Error('Unconfirmed creation');
        const selected: Owner = {
          id,
          identity: crypto.randomUUID(),
          session: client.sessionFactory(id),
          content: createMessageContent(),
          closed: false,
          attempted: false,
          checkpointKnown: false,
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
              /* Terminal confirmation will fail closed. */
            }
          }
        });
        if (selected.closed) selected.release();
        if (!current(run)) return false;
        publish({ threadId: id });
      } else run.owner = owner;
      const selected = run.owner;
      if (!selected || !current(run)) return false;
      // Read only after authored Send. An uncertain prior turn may advance the
      // exact canonical prefix without advancing separately retained authority.
      const prior = selected.attempted
        ? await client.readCurrent(selected.id, run.controller.signal)
        : undefined;
      if (!current(run)) return false;
      const values =
        prior === undefined
          ? undefined
          : plainRecord(prior)
          ? prior.values
          : undefined;
      if (prior !== undefined && !plainRecord(values))
        throw Error('Unavailable prefix');
      if (
        plainRecord(prior) &&
        prior.checkpoint !== undefined &&
        !checkpointSource(prior.checkpoint, selected.id)
      )
        throw Error('Foreign current state');
      if (plainRecord(prior) && checkpointSource(prior.checkpoint, selected.id))
        selected.checkpointKnown = true;
      run.baseline = captureBaseline(values, snapshot.savedPlan);
      if (!run.baseline) throw Error('Unavailable prefix');
      selected.attempted = true;
      const before = selected.session.getSnapshot();
      if (!current(run)) return false;
      run.previousHumanIds = new Set(
        before.messages
          .filter((message) => message.role === 'user')
          .map((message) => message.id)
      );
      run.previousGenerations = new Set(
        before.messages.map((message) => message.delivery.generation)
      );
      run.submitting = true;
      const outcome = await selected.session.submit(text, {
        signal: run.controller.signal,
      });
      if (!current(run)) return false;
      const live = observe(run);
      if (!current(run)) return false;
      if (outcome !== 'success') {
        finish(
          run,
          outcome === 'aborted'
            ? 'stopped'
            : outcome === 'error'
            ? 'failed'
            : 'unconfirmed',
          outcome,
          outcome === 'error'
            ? selected.checkpointKnown
              ? 'The response failed. The last saved plan is retained.'
              : 'The response failed before a saved conversation could be confirmed. Start a new conversation to continue.'
            : 'The response was not confirmed. The last saved plan is retained.',
          outcome === 'error' && selected.checkpointKnown
        );
        return false;
      }
      nativeSucceeded = true;
      if (!run.turn) throw Error('Native human was not observed');
      run.saving = true;
      publish({ phase: 'confirming' });
      if (!current(run)) return false;
      await selected.session.load({ signal: run.controller.signal });
      if (!current(run)) return false;
      const saved = observe(run),
        checkpoint =
          saved &&
          checkpointSource(
            saved.history?.[0] && plainRecord(saved.history[0])
              ? saved.history[0].checkpoint
              : undefined,
            selected.id
          );
      if (!saved || !live || !checkpoint) throw Error('Unavailable checkpoint');
      selected.checkpointKnown = true;
      const raw = await client.readCheckpoint(
        checkpoint,
        run.controller.signal
      );
      if (!current(run)) return false;
      const latest = observe(run);
      if (!current(run) || !latest) return false;
      // Raw observedValues and loadedCheckpoint deliberately share this exact
      // owned SDK read. Independent corroboration is native success, current
      // human/prefix, canonical messages/tools, native values and history.
      const confirmation = captureTerminal({
        turn: run.turn,
        owner: selected.identity,
        generation: run.generation,
        threadId: selected.id,
        submittedSuccessfully: outcome === 'success',
        observedCheckpoint: checkpoint,
        observedValues: plainRecord(raw) ? raw.values : undefined,
        loadedCheckpoint: raw,
        snapshot: latest,
      });
      if (!current(run)) return false;
      if (confirmation.kind !== 'confirmed')
        throw Error('Unconfirmed saved plan');
      publish({
        savedPlan: confirmation.plan,
        observedPlan: confirmation.plan,
      });
      finish(run, 'saved', outcome, null);
      return true;
    } catch {
      if (current(run))
        finish(
          run,
          nativeSucceeded ? 'unconfirmed' : 'failed',
          nativeSucceeded ? 'success' : 'error',
          nativeSucceeded
            ? 'The saved plan could not be confirmed. The last saved plan is retained.'
            : run.owner?.attempted && !run.owner.checkpointKnown
            ? 'The request failed before a saved conversation could be confirmed. Start a new conversation to continue.'
            : 'The request failed. You can try again.',
          nativeSucceeded || !run.owner?.attempted || run.owner.checkpointKnown
        );
      return false;
    }
  }
  async function stop() {
    const run = attempt;
    if (disposed || !run) return;
    attempt = undefined;
    run.controller.abort();
    publish({
      busy: false,
      canSubmit: false,
      phase: 'stopped',
      outcome: 'aborted',
      error:
        'Response stopped. The last saved plan is retained. Start a new conversation to continue.',
    });
    try {
      await run.owner?.session.stop();
    } catch {
      /* Cancellation is not save authority. */
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
    stop,
    newConversation,
    dispose,
  };
}
