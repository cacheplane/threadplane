import type { WritableSignal } from '@angular/core';
import type { ɵAgUiDevtoolsSignal, ɵDevtoolsEmitter } from '@threadplane/chat';

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
