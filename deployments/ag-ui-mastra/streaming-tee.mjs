// Delegation stream tee: observe a Mastra Agent's `fullStream` chunks before
// the @ag-ui/mastra bridge consumes them.
//
// Why a Proxy and not a bridge subclass: the bridge (1.1.5) reads the agent
// only through public members — `'getMemory' in agent`, `stream()`,
// `resumeStream()`, `getMemory()`, `listTools()`, `model` — and consumes
// `stream()`'s `.fullStream` in a private chunk processor that DROPS every
// `tool-output` chunk (the in-process sub-agent deltas). Wrapping the agent
// keeps the bridge unmodified and version-independent; wrapping only the
// `fullStream` iterator keeps `.traceId` / `.usage` / everything else on the
// stream result intact.
//
// Ordering guarantee: the bridge is the single reader of the wrapped
// generator, so `observe(chunk)` runs strictly before the bridge processes
// that same chunk. Anything the observer writes to the SSE socket therefore
// lands ahead of the bridge's own events for the chunk.

/**
 * Wrap an async iterable so `observe` sees each item before it is yielded.
 * Observer failures are logged and never break the consumer.
 */
async function* tee(source, observe) {
  for await (const chunk of source) {
    try {
      observe(chunk);
    } catch (err) {
      console.warn('[streaming-tee] observer threw; chunk still forwarded:', err);
    }
    yield chunk;
  }
}

const WRAPPED_METHODS = new Set(['stream', 'resumeStream']);

/**
 * @template {object} T
 * @param {T} agent the real Mastra Agent (or any object with `stream()`).
 * @param {(chunk: object) => void} observe called with every `fullStream`
 *   chunk of every `stream()` / `resumeStream()` result, before the bridge
 *   receives it.
 * @returns {T} a Proxy that forwards every member to `agent` with `this`
 *   bound to the real instance (so `#private` fields keep working), except
 *   that `stream` / `resumeStream` return their result with `fullStream`
 *   replaced by the teed generator.
 */
export function withDelegationTee(agent, observe) {
  return new Proxy(agent, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (!WRAPPED_METHODS.has(prop)) {
        // Bind to the REAL target, not the receiver: class methods that touch
        // `#private` state throw when `this` is the Proxy.
        return value.bind(target);
      }
      return async (...args) => {
        const result = await value.apply(target, args);
        if (!result || typeof result !== 'object' || !result.fullStream) return result;
        const wrapped = tee(result.fullStream, observe);
        // Keep the original result object (its getters for traceId/usage/
        // text/etc. must still resolve); only shadow `fullStream`.
        return new Proxy(result, {
          get(res, key) {
            if (key === 'fullStream') return wrapped;
            const v = Reflect.get(res, key, res);
            return typeof v === 'function' ? v.bind(res) : v;
          },
        });
      };
    },
    has(target, prop) {
      // Restates the default `has` behavior explicitly, so the bridge's
      // `'getMemory' in agent` check reads as a deliberate, documented
      // contract of this Proxy rather than an accident of the default trap.
      return prop in target;
    },
  });
}
