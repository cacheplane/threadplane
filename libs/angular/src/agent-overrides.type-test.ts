import type { Signal } from '@angular/core';
import type {
  AgentError,
  AgentInputBlock,
  AgentSession,
  AgentSubmitInput,
  AgentSubmitOptions,
  CompleteOutcome,
} from '@threadplane/core';
import {
  withAgentOverrides,
  ɵagentConfig,
  type Agent,
  type AgentOverrides,
} from './public-api.js';
import type { ScriptedSession } from './testing/scripted-session.js';

type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Expect<T extends true> = T;

interface Board {
  todos: string[];
}
type BoardSession = AgentSession<Record<string, never>, Board>;

declare function takesAgent(agent: Agent): void;
declare function takesScripted(agent: Agent<ScriptedSession>): void;

/** The derived agent is the whole agent, for the same session. */
export function derivedIsTheSameAgent(
  agent: Agent,
  scripted: Agent<ScriptedSession>,
  board: Agent<BoardSession>
) {
  const derived = withAgentOverrides(agent, {
    submit: () => Promise.resolve('aborted'),
  });
  void ({} as Expect<Same<typeof derived, Agent>>);
  takesAgent(derived);
  ɵagentConfig(derived);

  const derivedScripted = withAgentOverrides(scripted, {});
  void ({} as Expect<
    Same<typeof derivedScripted, Agent<ScriptedSession>>
  >);
  takesScripted(derivedScripted);

  const derivedBoard = withAgentOverrides(board, {});
  void ({} as Expect<Same<typeof derivedBoard, Agent<BoardSession>>>);
  // @ts-expect-error -- A derived agent keeps its own session type.
  takesScripted(derivedBoard);

  return [derived, derivedScripted, derivedBoard] as const;
}

/** A field that is absent when the agent is derived is still a signal. */
export function optionalFieldsStaySignals(
  agent: Agent,
  scripted: Agent<ScriptedSession>
) {
  const derived = withAgentOverrides(agent, {
    submit: (input, options) => agent.submit(input, options),
  });
  void ({} as Expect<
    Same<typeof derived.error, Signal<AgentError | undefined>>
  >);
  void ({} as Expect<
    Same<typeof derived.inputBlocked, Signal<AgentInputBlock | undefined>>
  >);
  const failure: AgentError | undefined = derived.error();

  const derivedScripted = withAgentOverrides(scripted, {});
  void ({} as Expect<
    Same<typeof derivedScripted.note, Signal<string | undefined>>
  >);
  const note: string | undefined = derivedScripted.note();
  return [failure, note] as const;
}

/** An override has the type of the member it replaces. */
export function overridesAreTyped(
  agent: Agent,
  scripted: Agent<ScriptedSession>
) {
  // Parameters are inferred from the member, in both forms.
  withAgentOverrides(agent, {
    submit: (input, options) => {
      void ({} as Expect<Same<typeof input, AgentSubmitInput<unknown>>>);
      void ({} as Expect<
        Same<typeof options, AgentSubmitOptions | undefined>
      >);
      return agent.submit(input, options);
    },
  });
  withAgentOverrides(agent, (inner) => {
    void ({} as Expect<Same<typeof inner, Agent>>);
    return {
      submit: (input, options) => inner.submit(input, options),
      stop: () => inner.stop(),
    };
  });
  withAgentOverrides(scripted, {
    submit: (input) => {
      void ({} as Expect<Same<typeof input, string>>);
      return scripted.submit(input.trim());
    },
    describe: (prefix) => prefix,
  });

  // An optional command can be hidden; a signal can be replaced by a signal.
  withAgentOverrides(agent, { regenerate: undefined, status: agent.status });

  withAgentOverrides(agent, {
    // @ts-expect-error -- submit must keep its result type.
    submit: () => 'sent',
  });
  withAgentOverrides(scripted, {
    // @ts-expect-error -- The scripted session's submit takes a string.
    submit: (input: number) => scripted.submit(String(input)),
  });
  withAgentOverrides(agent, {
    // @ts-expect-error -- A signal member is not replaced by a plain value.
    status: 'idle',
  });
  withAgentOverrides(agent, {
    // @ts-expect-error -- Only members of the agent can be overridden.
    sumbit: () => Promise.resolve('aborted'),
  });
  // @ts-expect-error -- The function form returns the same typed overrides.
  withAgentOverrides(agent, () => ({ stop: () => 'stopped' }));

  const typed: AgentOverrides<Agent> = {
    submit: (): Promise<CompleteOutcome> => Promise.resolve('aborted'),
  };
  return withAgentOverrides(agent, typed);
}
