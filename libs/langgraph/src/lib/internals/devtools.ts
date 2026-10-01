import type { ɵDevtoolsEmitter, ɵLangGraphDevtoolsSignal } from '@threadplane/chat';

/** Anything with a BehaviorSubject-style `next`; the instrumentation needs nothing else. */
interface Writable {
  next(value: never): void;
}

/**
 * Makes every subject in the bag report its name to the devtools emitter when
 * written. The subject key minus its `$` suffix is the reported name, which is
 * the LangGraph devtools vocabulary.
 *
 * The wrapper forwards the written value untouched and never reads it, nor the
 * subject's current value: the devtools report carries names and timing only.
 * It patches the instances in place so writes made through any reference to a
 * subject — the bridge's bag or `agent()`'s own locals — are all observed.
 */
export function instrumentSubjects(
  subjects: { [key: string]: Writable },
  devtools: ɵDevtoolsEmitter<ɵLangGraphDevtoolsSignal>,
): void {
  for (const key of Object.keys(subjects)) {
    const subject = subjects[key];
    const name = key.replace(/\$$/, '') as ɵLangGraphDevtoolsSignal;
    const next = subject.next;
    subject.next = function (this: unknown, value: never): void {
      devtools.wrote(name);
      next.call(this, value);
    };
  }
}
