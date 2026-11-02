import { signal, untracked, type Signal } from '@angular/core';
import type { Spec } from '@json-render/core';
import { createPartialJsonParser } from '@cacheplane/partial-json';
import { createParseTreeStore, type ElementAccumulationState, type ParseTreeStore } from './parse-tree-store';
import { createA2uiMessageParser, type A2uiMessageParser } from '@threadplane/a2ui';
import type { A2uiSurface } from '@threadplane/a2ui';
import { createA2uiSurfaceStore, type A2uiSurfaceStore, type A2uiSurfaceState } from '../a2ui/surface-store';
import { isTraceEnabled, trace } from './trace';

/** The detected format of accumulated assistant content, or pending while its prefix is incomplete. */
export type ContentType = 'pending' | 'markdown' | 'json-render' | 'a2ui';

const A2UI_PREFIX = '---a2ui_JSON---';

/** Accumulates assistant content and exposes its markdown, json-render, or A2UI representation as signals. */
export interface ContentClassifier {
  update(content: string): void;
  readonly type: Signal<ContentType>;
  readonly markdown: Signal<string>;
  readonly spec: Signal<Spec | null>;
  readonly elementStates: Signal<Map<string, ElementAccumulationState>>;
  readonly a2uiSurfaces: Signal<Map<string, A2uiSurface>>;
  readonly a2uiSurfaceStates: Signal<Map<string, A2uiSurfaceState>>;
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

  let a2uiParser: A2uiMessageParser | null = null;
  let a2uiStore: A2uiSurfaceStore | null = null;
  const a2uiSurfacesSignal = signal<Map<string, A2uiSurface>>(new Map());
  const a2uiSurfaceStatesSignal = signal<Map<string, A2uiSurfaceState>>(new Map());

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
    a2uiParser = null;
    a2uiStore = null;
    a2uiSurfacesSignal.set(new Map());
    a2uiSurfaceStatesSignal.set(new Map());
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
          a2uiParser = createA2uiMessageParser();
          a2uiStore = createA2uiSurfaceStore();
          jsonStartIndex = content.indexOf(A2UI_PREFIX) + A2UI_PREFIX.length;
          const a2uiContent = content.slice(jsonStartIndex);
          if (a2uiContent.length > 0) {
            try {
              const msgs = a2uiParser.push(a2uiContent);
              for (const msg of msgs) a2uiStore.apply(msg);
              a2uiSurfacesSignal.set(a2uiStore.surfaces());
              a2uiSurfaceStatesSignal.set(a2uiStore.surfaceStates());
            } catch (err) {
              errorsSignal.update(prev => [...prev, err instanceof Error ? err.message : String(err)]);
            }
          }
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
        if (a2uiParser && a2uiStore) {
          try {
            const msgs = a2uiParser.push(delta);
            for (const msg of msgs) a2uiStore.apply(msg);
            a2uiSurfacesSignal.set(a2uiStore.surfaces());
            a2uiSurfaceStatesSignal.set(a2uiStore.surfaceStates());
          } catch (err) {
            errorsSignal.update(prev => [...prev, err instanceof Error ? err.message : String(err)]);
          }
        }
      }

      if (isTraceEnabled()) {
        trace('classifier.update', { contentLength: content.length, type: typeSignal() });
      }
    });
  }

  function dispose(): void {
    store = null;
    a2uiParser = null;
    a2uiStore = null;
  }

  return {
    update,
    type: typeSignal.asReadonly(),
    markdown: markdownSignal.asReadonly(),
    spec: specSignal.asReadonly(),
    elementStates: elementStatesSignal.asReadonly(),
    a2uiSurfaces: a2uiSurfacesSignal.asReadonly(),
    a2uiSurfaceStates: a2uiSurfaceStatesSignal.asReadonly(),
    streaming: streamingSignal.asReadonly(),
    errors: errorsSignal.asReadonly(),
    dispose,
  };
}
