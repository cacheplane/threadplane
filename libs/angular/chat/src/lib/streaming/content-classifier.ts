import { signal, untracked, type Signal } from '@angular/core';
import type { Spec } from '@json-render/core';
import { createPartialJsonParser } from '@cacheplane/partial-json';
import { createParseTreeStore, type ElementAccumulationState, type ParseTreeStore } from './parse-tree-store';
import { isTraceEnabled, trace } from './trace';

/** The detected format of accumulated assistant content, or pending while its prefix is incomplete. */
export type ContentType = 'pending' | 'markdown' | 'json-render' | 'a2ui';

const A2UI_PREFIX = '---a2ui_JSON---';

/**
 * Accumulates assistant content and exposes its markdown, json-render, or A2UI
 * representation as signals. A2UI is recognized but not parsed: `a2uiSource`
 * is the content after the `---a2ui_JSON---` marker, for the chat's A2UI
 * renderer.
 */
export interface ContentClassifier {
  update(content: string): void;
  readonly type: Signal<ContentType>;
  readonly markdown: Signal<string>;
  readonly spec: Signal<Spec | null>;
  readonly elementStates: Signal<Map<string, ElementAccumulationState>>;
  /** The content after the `---a2ui_JSON---` marker; empty unless `type` is `'a2ui'`. */
  readonly a2uiSource: Signal<string>;
  readonly streaming: Signal<boolean>;
  readonly errors: Signal<string[]>;
  dispose(): void;
}

/**
 * Create a {@link ContentClassifier} — the streaming accumulator that inspects
 * an assistant message's content as it arrives and classifies it (markdown vs a
 * generative-UI/A2UI spec), exposing the parsed result and per-element state as
 * signals so the renderer can switch modes mid-stream.
 *
 * @returns A fresh {@link ContentClassifier}; call `dispose()` when done.
 * @example
 * ```ts
 * const cc = createContentClassifier();
 * effect(() => console.log(cc.type())); // 'pending' | 'markdown' | 'spec'
 * ```
 */
export function createContentClassifier(): ContentClassifier {
  const typeSignal = signal<ContentType>('pending');
  const markdownSignal = signal<string>('');
  const specSignal = signal<Spec | null>(null);
  const elementStatesSignal = signal<Map<string, ElementAccumulationState>>(new Map());
  const streamingSignal = signal<boolean>(false);
  const errorsSignal = signal<string[]>([]);

  let processedLength = 0;
  let previousContent = '';
  let store: ParseTreeStore | null = null;
  let jsonStartIndex = 0;

  const a2uiSourceSignal = signal('');

  /**
   * Decide the content type from the first non-whitespace character.
   * Returns 'pending' when:
   *  - content is empty or all whitespace, OR
   *  - the first non-whitespace char is '-' AND content is too short to
   *    confirm or disprove the full A2UI_PREFIX (the "patience" case).
   * Once we have at least A2UI_PREFIX.length non-prefix chars after the
   * first '-', we commit to either 'a2ui' (full match) or 'markdown'
   * (definitively not the prefix).
   */
  function detectType(content: string): ContentType {
    for (let i = 0; i < content.length; i++) {
      const ch = content[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') continue;

      if (ch === '{') {
        return 'json-render';
      }

      if (ch === '-') {
        if (content.startsWith(A2UI_PREFIX, i)) {
          return 'a2ui';
        }
        const remaining = content.length - i;
        if (remaining < A2UI_PREFIX.length) {
          const candidate = content.slice(i);
          if (A2UI_PREFIX.startsWith(candidate)) {
            return 'pending';
          }
          return 'markdown';
        }
        return 'markdown';
      }

      return 'markdown';
    }
    return 'pending';
  }

  function initJsonStore(jsonContent: string): void {
    const parser = createPartialJsonParser();
    store = createParseTreeStore(parser);
    if (jsonContent.length > 0) {
      store.push(jsonContent);
    }
    syncJsonSignals();
  }

  function syncJsonSignals(): void {
    if (!store) return;
    specSignal.set(store.spec());
    elementStatesSignal.set(store.elementStates());

    const spec = store.spec();
    if (spec) {
      streamingSignal.set(isStillStreaming());
    } else {
      streamingSignal.set(true);
    }
  }

  function isStillStreaming(): boolean {
    if (!store) return false;
    const states = store.elementStates();
    for (const state of states.values()) {
      if (state.streaming) return true;
    }
    const spec = store.spec();
    if (!spec || !spec.root || !spec.elements) return true;
    return false;
  }

  function resetState(): void {
    typeSignal.set('pending');
    markdownSignal.set('');
    specSignal.set(null);
    elementStatesSignal.set(new Map());
    streamingSignal.set(false);
    errorsSignal.set([]);
    processedLength = 0;
    store = null;
    jsonStartIndex = 0;
    a2uiSourceSignal.set('');
  }

  function update(content: string): void {
    // Wrap in untracked() because this is called during template rendering
    // (via classifyMessage in ChatComponent's AI message template). Angular's
    // NG0600 forbids writing signals during change detection; untracked()
    // opts out of the reactive graph for this imperative push-based update.
    untracked(() => {
      // A same-id replacement can be longer than its streamed introduction
      // (e.g. the render tool replaces prose with an A2UI payload). Only
      // append-only content can reuse the existing classification and parser.
      if (!content.startsWith(previousContent)) {
        resetState();
      }
      previousContent = content;
      const currentType = typeSignal();

      if (currentType === 'pending') {
        const detected = detectType(content);
        if (detected === 'pending') return;

        typeSignal.set(detected);

        if (detected === 'markdown') {
          markdownSignal.set(content);
          processedLength = content.length;
        } else if (detected === 'json-render') {
          streamingSignal.set(true);
          jsonStartIndex = 0;
          for (let i = 0; i < content.length; i++) {
            if (content[i] !== ' ' && content[i] !== '\t' && content[i] !== '\n' && content[i] !== '\r') {
              jsonStartIndex = i;
              break;
            }
          }
          const jsonContent = content.slice(jsonStartIndex);
          try {
            initJsonStore(jsonContent);
          } catch (err) {
            errorsSignal.update(prev => [...prev, err instanceof Error ? err.message : String(err)]);
          }
          processedLength = content.length;
        } else if (detected === 'a2ui') {
          streamingSignal.set(true);
          jsonStartIndex = content.indexOf(A2UI_PREFIX) + A2UI_PREFIX.length;
          a2uiSourceSignal.set(content.slice(jsonStartIndex));
          processedLength = content.length;
        }
        return;
      }

      // Compute delta
      const delta = content.slice(processedLength);
      processedLength = content.length;

      if (delta.length === 0) return;

      if (currentType === 'markdown') {
        markdownSignal.set(content);
      } else if (currentType === 'json-render') {
        if (store) {
          try {
            store.push(delta);
            syncJsonSignals();
          } catch (err) {
            errorsSignal.update(prev => [...prev, err instanceof Error ? err.message : String(err)]);
          }
        }
      } else if (currentType === 'a2ui') {
        a2uiSourceSignal.set(content.slice(jsonStartIndex));
      }

      if (isTraceEnabled()) {
        trace('classifier.update', { contentLength: content.length, type: typeSignal() });
      }
    });
  }

  function dispose(): void {
    store = null;
  }

  return {
    update,
    type: typeSignal.asReadonly(),
    markdown: markdownSignal.asReadonly(),
    spec: specSignal.asReadonly(),
    elementStates: elementStatesSignal.asReadonly(),
    a2uiSource: a2uiSourceSignal.asReadonly(),
    streaming: streamingSignal.asReadonly(),
    errors: errorsSignal.asReadonly(),
    dispose,
  };
}
