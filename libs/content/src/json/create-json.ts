import { create, push, finish } from '@cacheplane/json-stream';
import { createProjection } from './projection.js';
import { classify } from './transition.js';
import type { Json, JsonDocument, JsonOptions, JsonSnapshot } from './types.js';

function capture(input: JsonDocument): JsonDocument {
  return Object.freeze({
    generation: input.generation,
    phase: input.phase,
    content: input.content,
  });
}

/** Create an application-owned incremental JSON document. */
export function createJson(
  initial: JsonDocument,
  options: JsonOptions = {}
): Json {
  return createJsonOwner(initial, options, {
    create,
    push,
    finish,
    createProjection,
  });
}

/** @internal Narrow work/failure seam, not exported from the feature entry. */
export function createJsonOwner(
  initial: JsonDocument,
  options: JsonOptions,
  work: {
    create: typeof create;
    push: typeof push;
    finish: typeof finish;
    createProjection: typeof createProjection;
  }
): Json {
  const policy = options.violationPolicy ?? 'throw';
  function prepare(document: JsonDocument) {
    let state = work.push(work.create(), document.content);
    if (document.phase === 'complete') state = work.finish(state);
    return { state, project: work.createProjection() };
  }
  const document = capture(initial);
  let derived: ReturnType<typeof prepare> | null = prepare(document);
  let snapshot: JsonSnapshot = Object.freeze({
    document,
    ...derived.project(derived.state),
  });
  let disposed = false,
    notifying = false,
    dirty = false;
  const registrations = new Set<{ notify: () => void }>();
  const assertActive = () => {
    if (disposed) throw new Error('JSON owner is disposed');
  };
  function publish() {
    dirty = true;
    if (notifying) return;
    notifying = true;
    try {
      while (dirty && !disposed) {
        dirty = false;
        for (const registration of [...registrations]) {
          if (disposed) break;
          if (!registrations.has(registration)) continue;
          try {
            registration.notify();
          } catch {
            /* An observer cannot reject an accepted update. */
          }
        }
      }
    } finally {
      notifying = false;
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(notify) {
      if (disposed) return () => undefined;
      const registration = { notify };
      registrations.add(registration);
      return () => {
        registrations.delete(registration);
      };
    },
    update(input) {
      assertActive();
      const document = capture(input);
      // Input getters can commit commands or dispose this owner.
      assertActive();
      const action = classify(snapshot.document, document);
      if (action.kind === 'noop') return;
      if (action.kind === 'violation' && policy === 'throw')
        throw new Error(`JSON document contract violation: ${action.reason}`);
      try {
        if (action.kind === 'replace' || action.kind === 'violation')
          derived = prepare(document);
        else if (action.kind === 'append') {
          derived ??= prepare(snapshot.document);
          if (action.suffix.length)
            derived.state = work.push(derived.state, action.suffix);
          if (action.finish) derived.state = work.finish(derived.state);
        }
        if (!derived) throw new Error('Missing JSON derived state');
        snapshot = Object.freeze({
          document,
          ...derived.project(derived.state),
        });
      } catch (error) {
        derived = null;
        throw error;
      }
      publish();
    },
    dispose() {
      disposed = true;
      dirty = false;
      registrations.clear();
      derived = null;
    },
  };
}
