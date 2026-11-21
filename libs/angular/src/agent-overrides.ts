import { ɵadoptDerivedAgent } from './agent';

/**
 * Members of an agent to serve in place of its own. Each one has the type of
 * the member it replaces. `undefined` for an optional member, such as
 * `regenerate`, makes the derived agent read as not having it.
 */
export type AgentOverrides<TAgent extends object> = {
  readonly [K in keyof TAgent]?: TAgent[K];
};

/**
 * Derives an agent that serves `overrides` in place of the named members and
 * forwards every other read to `agent`, at the time of the read.
 *
 * Use it instead of an object spread. An agent serves a snapshot field that
 * is not set yet, such as `error`, only when it is asked for by name, so a
 * spread copies the members that exist at that moment and the copy never
 * gains the rest. The derived agent has no such moment: a field published
 * later, a thread switch and a replaced session all show through it, and the
 * members it does not override are the same references as the original's.
 *
 * `overrides` may be a function. It is called once, with the original agent,
 * so a replacement can call the member it wraps:
 *
 * ```ts
 * const guarded = withAgentOverrides(injectAgent(), (agent) => ({
 *   submit: (input, options) =>
 *     locked() ? Promise.resolve('aborted') : agent.submit(input, options),
 * }));
 * ```
 *
 * The original agent is not changed, and code holding it does not see the
 * overrides. The overrides are read once: changing the object afterwards
 * changes nothing. The derived agent resolves to the original's configuration
 * and development-install policy, and it can be derived from again.
 */
export function withAgentOverrides<TAgent extends object>(
  agent: TAgent,
  overrides:
    | AgentOverrides<TAgent>
    | ((agent: TAgent) => AgentOverrides<TAgent>)
): TAgent {
  const given = typeof overrides === 'function' ? overrides(agent) : overrides;
  if (given === null || typeof given !== 'object')
    throw new TypeError(
      'withAgentOverrides takes an object of members, or a function returning one.'
    );
  const replaced = new Map<string, unknown>(Object.entries(given));
  const has = (key: string | symbol): boolean =>
    typeof key === 'string' && replaced.has(key)
      ? replaced.get(key) !== undefined
      : Reflect.has(agent, key);

  const derived = new Proxy(Object.create(null) as object, {
    get: (_target, key) =>
      typeof key === 'string' && replaced.has(key)
        ? replaced.get(key)
        : Reflect.get(agent, key),
    has: (_target, key) => has(key),
    ownKeys: () =>
      [...new Set([...Reflect.ownKeys(agent), ...replaced.keys()])].filter(
        has
      ),
    getOwnPropertyDescriptor: (_target, key) => {
      if (typeof key === 'string' && replaced.has(key)) {
        const value = replaced.get(key);
        return value === undefined
          ? undefined
          : { value, writable: false, enumerable: true, configurable: true };
      }
      const own = Reflect.getOwnPropertyDescriptor(agent, key);
      // The proxy's own target holds nothing, so it may only report a
      // configurable property.
      return own && { ...own, configurable: true };
    },
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
  }) as TAgent;
  ɵadoptDerivedAgent(derived, agent);
  return derived;
}
