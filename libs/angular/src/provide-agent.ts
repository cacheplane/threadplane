import {
  InjectionToken,
  inject,
  isDevMode,
  type Provider,
} from '@angular/core';
import type { AgentSession } from '@threadplane/core';
import {
  createAgent,
  type Agent,
  type AgentConfig,
  type AgentSessionLike,
} from './agent';
import { AGENT_LIFECYCLE } from './agent-lifecycle';
import type { AgentRef } from './agent-ref';

/**
 * @internal The agent the ref-less `injectAgent()` resolves. Exported for the
 * testing entry's `provideAgentValue`; tests provide an agent through that.
 */
export const ɵAGENT = new InjectionToken<Agent<AgentSessionLike>>('AGENT');

/** @internal The resolved config of the agent behind `ɵAGENT`. */
export const ɵAGENT_CONFIG = new InjectionToken<AgentConfig<AgentSessionLike>>(
  'AGENT_CONFIG'
);

/**
 * @internal The debug name of every `provideAgent(ref, …)` call at one injector
 * level. Angular does not merge multi-providers across parent and child
 * injectors, so the list is exactly this level.
 */
const AGENT_REF_NAMES = new InjectionToken<string[]>('AGENT_REF_NAMES');

/** A config, or a factory for one that runs in an injection context. */
export type AgentConfigInput<TSession extends AgentSessionLike> =
  | AgentConfig<TSession>
  | (() => AgentConfig<TSession>);

/** @internal Also used by `provideFakeAgent`. */
export function ɵisAgentRef(value: unknown): value is AgentRef<never> {
  return typeof value === 'object' && value !== null && 'token' in value;
}

function refDebugName(ref: AgentRef<never>): string {
  return ref.token.toString().replace(/^InjectionToken\s+/, '');
}

/**
 * Provides one {@link Agent}, built from a session factory. Retrieve it in any
 * component with `injectAgent()`. Provide it at the application root for an
 * app-wide agent, or in a component's `providers` to give that subtree its
 * own.
 *
 * The agent creates its sessions through `config.createSession`, so this
 * package depends on no backend. The last session is disposed when the
 * providing injector is destroyed.
 *
 * **Static or factory config.** Pass the config object when it is known up
 * front. Pass a `() => AgentConfig` factory when it depends on injected state:
 * the factory runs once, in an injection context, so it may call `inject()`.
 *
 * **Typed agents.** Pass an {@link AgentRef} first to carry the session type
 * from `provideAgent` to `injectAgent(ref)`.
 *
 * **Several agents at one injector level.** Each `provideAgent(ref, …)` call
 * builds its own agent from its own config, so several refs may share one
 * `providers` array and `injectAgent(refA)` / `injectAgent(refB)` return
 * distinct agents. The ref-less `injectAgent()` resolves one shared token,
 * which can name only one of them: the last call wins, and resolving it in
 * development mode logs a `console.warn` naming every competing ref.
 * `AGENT_LIFECYCLE` follows the same rule.
 *
 * @example
 * ```ts
 * providers: [
 *   provideAgent({
 *     threadId: currentThreadId,
 *     createSession: async (context) =>
 *       createSession({ assistantId: 'chat', apiUrl, ...context }),
 *   }),
 * ];
 * ```
 */
export function provideAgent<TSession extends AgentSessionLike>(
  ref: AgentRef<TSession>,
  config: AgentConfigInput<NoInfer<TSession>>
): Provider[];
export function provideAgent<TSession extends AgentSessionLike>(
  config: AgentConfigInput<TSession>
): Provider[];
export function provideAgent(
  refOrConfig: AgentRef<never> | AgentConfigInput<AgentSessionLike>,
  maybeConfig?: AgentConfigInput<AgentSessionLike>
): Provider[] {
  const ref = ɵisAgentRef(refOrConfig) ? refOrConfig : undefined;
  const input = (ref ? maybeConfig : refOrConfig) as
    | AgentConfigInput<AgentSessionLike>
    | undefined;
  // Resolved lazily, inside the injection context of the config provider
  // below: never when the providers array is built.
  const resolveConfig = (): AgentConfig<AgentSessionLike> => {
    const config = typeof input === 'function' ? input() : input;
    if (typeof config?.createSession !== 'function')
      throw new TypeError(
        'provideAgent: `createSession` is required to build the agent.'
      );
    return config;
  };

  if (!ref)
    return [
      // The config token resolves once, so a config factory runs exactly once.
      { provide: ɵAGENT_CONFIG, useFactory: resolveConfig },
      { provide: ɵAGENT, useFactory: () => createAgent(inject(ɵAGENT_CONFIG)) },
      {
        provide: AGENT_LIFECYCLE,
        useFactory: () => inject(ɵAGENT).lifecycle,
      },
    ];

  // Ref form: this call has its own config token and its own agent, so several
  // refs coexist in one providers array. The shared tokens alias this call's
  // pair; with several refs they can mean only one, and the last call wins.
  const refConfig = new InjectionToken<AgentConfig<AgentSessionLike>>(
    `AGENT_CONFIG(${ref.token.toString()})`
  );
  const token = ref.token as unknown as InjectionToken<Agent<AgentSessionLike>>;
  const name = refDebugName(ref);
  return [
    { provide: refConfig, useFactory: resolveConfig },
    { provide: token, useFactory: () => createAgent(inject(refConfig)) },
    { provide: ɵAGENT_CONFIG, useExisting: refConfig },
    { provide: AGENT_REF_NAMES, useValue: name, multi: true },
    {
      provide: ɵAGENT,
      useFactory: () => {
        if (isDevMode()) {
          const names = inject(AGENT_REF_NAMES, { optional: true }) ?? [];
          const others = names.filter((other) => other !== name);
          if (others.length > 0)
            console.warn(
              `[@threadplane/angular] provideAgent(): ${names.length} agent refs ` +
                `(${names.join(', ')}) are provided at the same injector level. ` +
                `The ref-less injectAgent() resolves a single shared token, so it now ` +
                `returns the last one provided (${name}). ` +
                `Inject by ref — injectAgent(${others[0]}) / injectAgent(${name}) — ` +
                `to reach each agent unambiguously.`
            );
        }
        return inject(token);
      },
    },
    { provide: AGENT_LIFECYCLE, useFactory: () => inject(token).lifecycle },
  ];
}

/**
 * Retrieves the agent provided in the current injection context.
 *
 * Pass the ref given to `provideAgent(ref, …)` to receive that agent with its
 * session's type. Without a ref the result is typed by the core contract; a
 * backend's own fields and commands are then reached by naming the session
 * type, `injectAgent<MySession>()`, which is not checked against the provider.
 *
 * @example
 * ```ts
 * readonly agent = injectAgent(TRIP);
 * readonly count = computed(() => this.agent.messages().length);
 * send(text: string) {
 *   void this.agent.submit(text);
 * }
 * ```
 */
export function injectAgent<
  TSession extends AgentSessionLike = AgentSession
>(): Agent<TSession>;
export function injectAgent<TSession extends AgentSessionLike>(
  ref: AgentRef<TSession>
): Agent<TSession>;
export function injectAgent(
  ref?: AgentRef<AgentSessionLike>
): Agent<AgentSessionLike> {
  return inject(
    ref
      ? (ref.token as unknown as InjectionToken<Agent<AgentSessionLike>>)
      : ɵAGENT
  );
}
