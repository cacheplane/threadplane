import {
  createPartialMarkdownParser,
  type PartialMarkdownParser,
} from '@cacheplane/partial-markdown';
import { createProjection } from './projection.js';
import { classify } from './transition.js';
import type {
  Markdown,
  MarkdownDocument,
  MarkdownOptions,
  MarkdownSnapshot,
} from './types.js';

function capture(input: MarkdownDocument): MarkdownDocument {
  return Object.freeze({
    generation: input.generation,
    phase: input.phase,
    content: input.content,
  });
}

/** Create an owned incremental Markdown document. */
export function createMarkdown(
  initial: MarkdownDocument,
  options: MarkdownOptions = {}
): Markdown {
  return createMarkdownOwner(initial, options, {
    createParser: createPartialMarkdownParser,
    createProjection,
  });
}

/** @internal Narrow lifecycle/failure seam; not exported from the feature entry. */
export function createMarkdownOwner(
  initial: MarkdownDocument,
  options: MarkdownOptions,
  work: {
    createParser: () => Pick<PartialMarkdownParser, 'push' | 'finish' | 'root'>;
    createProjection: typeof createProjection;
  }
): Markdown {
  const policy = options.violationPolicy ?? 'throw';
  function prepare(document: MarkdownDocument) {
    const parser = work.createParser(),
      project = work.createProjection();
    parser.push(document.content);
    if (document.phase === 'complete') parser.finish();
    return { parser, project };
  }
  const document = capture(initial);
  let derived: ReturnType<typeof prepare> | null = prepare(document);
  let snapshot: MarkdownSnapshot = Object.freeze({
    document,
    root: derived.project(derived.parser.root),
  });
  let disposed = false,
    notifying = false,
    dirty = false;
  const registrations = new Set<{ notify: () => void }>();
  const assertActive = () => {
    if (disposed) throw new Error('Markdown owner is disposed');
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
            /* Observer errors cannot reject an accepted update. */
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
      // Getters may have committed a newer document or disposed this owner.
      assertActive();
      const action = classify(snapshot.document, document);
      if (action.kind === 'noop') return;
      if (action.kind === 'violation' && policy === 'throw')
        throw new Error(
          `Markdown document contract violation: ${action.reason}`
        );
      try {
        if (action.kind === 'replace' || action.kind === 'violation')
          derived = prepare(document);
        else {
          derived ??= prepare(snapshot.document);
          if (action.suffix.length) derived.parser.push(action.suffix);
          if (action.finish) derived.parser.finish();
        }
        const root = derived.project(derived.parser.root);
        snapshot = Object.freeze({ document, root });
      } catch (error) {
        // A parser may have advanced before throwing. Only the accepted snapshot survives.
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
