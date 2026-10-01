import type { WritableSignal } from '@angular/core';
import type { AbstractAgent, BaseEvent, RunAgentInput } from '@ag-ui/client';
import { Observable } from 'rxjs';
import type { ɵAgUiDevtoolsSignal, ɵAgUiScriptedRun, ɵDevtoolsEmitter } from '@threadplane/chat';

/**
 * Makes each named writable signal report its name to the devtools emitter
 * when it is `set` or `update`d. The names are the AG-UI devtools vocabulary.
 *
 * The wrappers forward their argument untouched: they never read the written
 * value, never call the signal's getter, and never run an `update` callback
 * themselves — the devtools report carries names and timing only. Patching the
 * signal objects in place means writes through any reference — the reducer,
 * the adapter, client tools — are all observed.
 */
export function instrumentSignals(
  signals: Partial<Record<ɵAgUiDevtoolsSignal, WritableSignal<never>>>,
  devtools: ɵDevtoolsEmitter<ɵAgUiDevtoolsSignal>,
): void {
  for (const name of Object.keys(signals) as ɵAgUiDevtoolsSignal[]) {
    const target = signals[name];
    if (!target) continue;
    const set = target.set;
    const update = target.update;
    target.set = (value: never): void => {
      devtools.wrote(name);
      set.call(target, value);
    };
    target.update = (updateFn: (value: never) => never): void => {
      devtools.wrote(name);
      update.call(target, updateFn);
    };
  }
}

/** Lifecycle events whose ids name the run; a scripted run is the run it replaces. */
const RUN_LIFECYCLE_EVENTS = new Set(['RUN_STARTED', 'RUN_FINISHED']);

/**
 * Makes the source agent's next `run(input)` call return the scripted events
 * instead of reaching its backend, then puts `run` back. Everything around
 * that call — `runAgent`'s pipeline, middleware, verification and every
 * subscriber's `onEvent` — runs unchanged, so the adapter's real handling is
 * what the script exercises.
 *
 * `RUN_STARTED` and `RUN_FINISHED` take the run input's `threadId` and
 * `runId`: a script (often captured from another run) stands in for this run,
 * and the adapter attributes events to runs by those ids.
 *
 * Returns the restore function; calling it again is harmless.
 */
export function scriptNextRun(source: AbstractAgent, script: ɵAgUiScriptedRun): () => void {
  const target = source as unknown as { run: (input: RunAgentInput) => Observable<BaseEvent> };
  const ownRun = Object.prototype.hasOwnProperty.call(target, 'run');
  const originalRun = target.run;
  let restored = false;
  const restore = (): void => {
    if (restored) return;
    restored = true;
    if (ownRun) target.run = originalRun;
    else delete (target as Partial<typeof target>).run;
  };
  target.run = (input: RunAgentInput): Observable<BaseEvent> => {
    restore();
    return scriptedEvents(script, input);
  };
  return restore;
}

function scriptedEvents(script: ɵAgUiScriptedRun, input: RunAgentInput): Observable<BaseEvent> {
  return new Observable<BaseEvent>(subscriber => {
    let index = 0;
    let closed = false;
    // One event per microtask: asynchronous like a stream, without timer clamping.
    const next = (): void => {
      if (closed) return;
      if (index >= script.events.length) {
        subscriber.complete();
        return;
      }
      const event = script.events[index++];
      subscriber.next((RUN_LIFECYCLE_EVENTS.has(event.type)
        ? { ...event, threadId: input.threadId, runId: input.runId }
        : event) as unknown as BaseEvent);
      void Promise.resolve().then(next);
    };
    void Promise.resolve().then(next);
    return () => {
      closed = true;
    };
  });
}
