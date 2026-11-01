// libs/chat/src/lib/a2ui/partial-args-bridge.ts
import { createPartialJsonParser, materialize } from '@cacheplane/partial-json';
import { A2UI_BASIC_CATALOG_ID, A2UI_WIRE_VERSION, type A2uiMessage } from '@threadplane/a2ui';
import type { A2uiSurfaceStore } from './surface-store';
import { normalizeEnvelopeArgs } from './envelope-normalizer';

/** Feeds cumulative tool argument JSON into an A2UI surface store while tracking malformed streams. */
export interface PartialArgsBridge {
  /**
   * Replace the cumulative argument-string buffer for `toolCallId` with
   * `argsSoFar` and re-extract any newly-complete envelopes. The args
   * string is expected to grow monotonically.
   */
  push(toolCallId: string, argsSoFar: string): void;
  /** True if a tool_call_id has been poisoned by malformed input. */
  isPoisoned(toolCallId: string): boolean;
}

interface BridgeState {
  parser: ReturnType<typeof createPartialJsonParser>;
  args: string;
  /** Number of envelopes already dispatched to the store. */
  dispatchedCount: number;
  /** Surface ids for which a createSurface (real or synthesised) has been
   * dispatched this turn — used to synthesise the missing createSurface
   * exactly once per surface. */
  createDispatched: Set<string>;
  /** Once true, all subsequent pushes are ignored. */
  poisoned: boolean;
}

/**
 * Validate that `s` is a syntactically plausible JSON prefix. We can't
 * `JSON.parse` an incomplete string, so we run a lightweight scanner that
 * follows the grammar and tolerates only truncation at the right edge.
 * Returns false if any character violates JSON syntax mid-stream.
 *
 * The partial-json parser silently halts on bad input (setting an internal
 * error flag that is not exposed through its public API), so we use this
 * pre-check to detect poisoned streams.
 */
function isValidJsonPrefix(s: string): boolean {
  // Stack of expected closers: '}' for objects, ']' for arrays,
  // 'k' (object key expected), 'v' (value expected), ',' or ':'.
  // We model JSON with a small state machine. Returns true if the input
  // is consumable as a prefix of some valid JSON document.
  let i = 0;
  const len = s.length;
  // Outer state: 'value' (expecting any value), 'object-key' (after `{`
  // or `,`), 'after-key' (after a key string, expect `:`), 'after-value'
  // (after a value, expect `,` or matching close).
  type Frame = { container: 'object' | 'array' };
  const stack: Frame[] = [];
  let state: 'value' | 'object-key' | 'after-key' | 'after-value' = 'value';

  function skipWs(): void {
    while (i < len) {
      const c = s.charCodeAt(i);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i++;
      else break;
    }
  }

  function scanString(): boolean {
    // Already at opening quote
    if (s[i] !== '"') return false;
    i++;
    while (i < len) {
      const c = s[i];
      if (c === '\\') {
        i++;
        if (i >= len) return true; // truncated escape
        i++;
        continue;
      }
      if (c === '"') { i++; return true; }
      i++;
    }
    // Truncated mid-string is OK for a prefix.
    return true;
  }

  function scanLiteral(lit: string): boolean {
    // Match as much of `lit` as remains in input. Truncation OK.
    let j = 0;
    while (i < len && j < lit.length) {
      if (s[i] !== lit[j]) return false;
      i++; j++;
    }
    return true;
  }

  function scanNumber(): boolean {
    // Lenient: consume digits, '.', 'e', 'E', '+', '-' starting from current
    if (s[i] === '-') i++;
    while (i < len) {
      const c = s[i];
      if ((c >= '0' && c <= '9') || c === '.' || c === 'e' || c === 'E' || c === '+' || c === '-') i++;
      else break;
    }
    return true;
  }

  while (i < len) {
    skipWs();
    if (i >= len) break;
    const c = s[i];

    if (state === 'value') {
      if (c === '{') {
        i++; stack.push({ container: 'object' }); state = 'object-key';
      } else if (c === '[') {
        i++; stack.push({ container: 'array' }); state = 'value';
      } else if (c === '"') {
        if (!scanString()) return false;
        state = 'after-value';
      } else if (c === 't') { if (!scanLiteral('true')) return false; state = 'after-value'; }
      else if (c === 'f') { if (!scanLiteral('false')) return false; state = 'after-value'; }
      else if (c === 'n') { if (!scanLiteral('null')) return false; state = 'after-value'; }
      else if (c === '-' || (c >= '0' && c <= '9')) { if (!scanNumber()) return false; state = 'after-value'; }
      else if (c === ']' && stack.length > 0 && stack[stack.length - 1].container === 'array') {
        // empty array close
        i++; stack.pop(); state = 'after-value';
      } else {
        return false;
      }
    } else if (state === 'object-key') {
      if (c === '"') {
        if (!scanString()) return false;
        state = 'after-key';
      } else if (c === '}' && stack.length > 0 && stack[stack.length - 1].container === 'object') {
        i++; stack.pop(); state = 'after-value';
      } else {
        return false;
      }
    } else if (state === 'after-key') {
      if (c === ':') { i++; state = 'value'; }
      else return false;
    } else if (state === 'after-value') {
      if (stack.length === 0) {
        // Trailing content after top-level value is invalid.
        return false;
      }
      const top = stack[stack.length - 1];
      if (c === ',') {
        i++;
        state = top.container === 'object' ? 'object-key' : 'value';
      } else if (c === '}' && top.container === 'object') {
        i++; stack.pop(); state = 'after-value';
      } else if (c === ']' && top.container === 'array') {
        i++; stack.pop(); state = 'after-value';
      } else {
        return false;
      }
    }
  }
  return true;
}

/**
 * Subscribes to LangGraph custom events of name 'a2ui-partial' and feeds
 * the surface store envelope-by-envelope as the parent LLM streams its
 * tool_call.arguments JSON. Uses @cacheplane/partial-json to extract
 * structurally-complete envelope objects from the growing args string.
 *
 * Synthesis safety net: v0.9 requires a `createSurface` envelope before
 * any `updateComponents`. If a complete `updateComponents` arrives for a
 * surface with no `createSurface` seen yet this turn, the bridge
 * synthesises one (basic catalog) so the surface can mount as soon as its
 * `root` component is defined — the store gates rendering on
 * createSurface + root, and fills the tree in progressively after that.
 *
 * The store treats a later "real" createSurface for the same surface as an
 * idempotent refresh, so LLMs that emit one out of order are harmless.
 */
export function createPartialArgsBridge(store: A2uiSurfaceStore): PartialArgsBridge {
  const states = new Map<string, BridgeState>();

  function stateOf(toolCallId: string): BridgeState {
    let s = states.get(toolCallId);
    if (!s) {
      s = {
        parser: createPartialJsonParser(),
        args: '',
        dispatchedCount: 0,
        createDispatched: new Set(),
        poisoned: false,
      };
      states.set(toolCallId, s);
    }
    return s;
  }

  function push(toolCallId: string, argsSoFar: string): void {
    const state = stateOf(toolCallId);
    if (state.poisoned) return;
    if (argsSoFar === state.args) return;
    // Pre-check: poison if the args string isn't a valid JSON prefix.
    if (!isValidJsonPrefix(argsSoFar)) {
      state.poisoned = true;
      return;
    }
    try {
      // Cumulative stream updates normally append. Replaying every previous
      // character on each update makes a fast-forward seek quadratic.
      if (!argsSoFar.startsWith(state.args)) {
        state.parser = createPartialJsonParser();
        state.args = '';
      }
      state.parser.push(argsSoFar.slice(state.args.length));
      state.args = argsSoFar;
    } catch {
      state.poisoned = true;
      return;
    }
    const rootNode = state.parser.getByPath('/');
    if (!rootNode) return;
    const materialised = materialize(rootNode) as Record<string, unknown> | null;
    if (!materialised || typeof materialised !== 'object') return;
    const envelopes = normalizeEnvelopeArgs(materialised);
    if (!envelopes) return;

    // Dispatch newly-complete envelopes in order, synthesising the missing
    // createSurface when the stream leads with components.
    const newEnvelopes: A2uiMessage[] = [];
    for (let i = state.dispatchedCount; i < envelopes.length; i++) {
      const env = envelopes[i] as A2uiMessage;
      if (!isStructurallyComplete(env)) {
        // Stop at the first not-yet-complete envelope; later siblings can't
        // exist before earlier ones complete (envelopes are an ordered list).
        break;
      }
      if ('createSurface' in env) {
        state.createDispatched.add(env.createSurface.surfaceId);
      } else if ('updateComponents' in env) {
        const surfaceId = env.updateComponents.surfaceId;
        if (!state.createDispatched.has(surfaceId)) {
          state.createDispatched.add(surfaceId);
          newEnvelopes.push({
            version: A2UI_WIRE_VERSION,
            createSurface: { surfaceId, catalogId: A2UI_BASIC_CATALOG_ID },
          });
        }
      }
      newEnvelopes.push(env);
      state.dispatchedCount = i + 1;
    }
    if (newEnvelopes.length > 0) {
      store.applyPartialArgs(toolCallId, newEnvelopes);
    }
  }

  function isPoisoned(toolCallId: string): boolean {
    return stateOf(toolCallId).poisoned;
  }

  return { push, isPoisoned };
}

/** True if the envelope has a recognised discriminator key with an object value. */
function isStructurallyComplete(env: unknown): env is A2uiMessage {
  if (!env || typeof env !== 'object' || Array.isArray(env)) return false;
  const obj = env as Record<string, unknown>;
  for (const k of ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface']) {
    if (k in obj && typeof obj[k] === 'object' && obj[k] !== null) {
      // For updateComponents, require surfaceId + components where every
      // component has at least parsed its `id` and `component` fields —
      // a half-streamed component object materialises as `{}` and must not
      // dispatch (it would consume the envelope index and drop the real
      // components forever, since re-parses skip dispatched indices).
      if (k === 'updateComponents') {
        const uc = obj[k] as { surfaceId?: unknown; components?: unknown };
        return typeof uc.surfaceId === 'string'
          && Array.isArray(uc.components)
          && uc.components.length > 0
          && uc.components.every((c) =>
            c != null && typeof c === 'object'
            && typeof (c as { id?: unknown }).id === 'string'
            && typeof (c as { component?: unknown }).component === 'string');
      }
      // For createSurface, require both ids so a half-streamed envelope
      // doesn't commit with an undefined catalogId.
      if (k === 'createSurface') {
        const cs = obj[k] as { surfaceId?: unknown; catalogId?: unknown };
        return typeof cs.surfaceId === 'string' && typeof cs.catalogId === 'string';
      }
      return true;
    }
  }
  return false;
}
