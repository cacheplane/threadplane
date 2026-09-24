import type {
  AgentSession,
  AgentSnapshot,
  AgentError,
  Message,
  CompleteOutcome,
  PlainValue,
} from '@threadplane/core';

export const reviewInstructions =
  'Click Load three times: saved history, equal refresh, then empty history. Continue with Send → Tool → Error → Hold → Stop → Pause → Stop → Resume → Resume → Drop → Reconnect → Send. Tool and Drop send model, reasoning effort, UI mode and itinerary state once; displayed values come from the server. Resume first sends both approval responses, then confirms the final action. Drop loses observation of a running run; Reconnect joins that same run without another submission. Finish with Unmount → Dispose → Send after dispose → Resume after dispose → Reconnect after dispose in the owner controls below. Only three Load requests and one Drop are available per server; restart the review command to reset. Reloading the page does not reset server state.';

export const checkpointInstructions =
  'Load → Select A → Select B → Select A → Fork selected → Select B → Continue branch → Load → Select P → Fork selected (rejected) → Drop branch → Reconnect branch → Dispose → Continue branch → Fork selected. Selection only chooses a saved reference for Fork selected. Continue and Load follow the session’s confirmed branch position even while B is selected; the global latest remains B. One bounded sequence is available per server; restart the review command to reset.';

/** Fixture-local input contract uses only the installed neutral data vocabulary. */
export type FixtureInputState = Readonly<Record<string, PlainValue>> & {
  readonly messages?: never;
  readonly client_tools?: never;
};

export type FixtureSubmitInput =
  | string
  | {
      readonly message: string;
      readonly state?: FixtureInputState;
    };

/** Project application records to plain data before passing them to the backend. */
export function reviewInput(label: string): FixtureSubmitInput {
  if (label !== 'Tool' && label !== 'Drop') return label;
  return {
    message: label,
    state: {
      model: 'gpt-5-mini',
      reasoning_effort: 'minimal',
      gen_ui_mode: 'a2ui',
      itinerary: [
        { id: 'paris', day: 1, place: 'Paris', note: 'Check the weather' },
      ],
    },
  };
}

/** Fixture-local backend contract; installed consumers import only core types. */
export interface FixtureRunOptions {
  readonly signal?: AbortSignal;
  readonly config?: {
    readonly tags?: readonly string[];
    readonly recursion_limit?: number;
    readonly configurable?: Readonly<Record<string, PlainValue>> & {
      readonly thread_id?: never;
      readonly checkpoint_id?: never;
      readonly checkpoint_ns?: never;
      readonly checkpoint_map?: never;
    };
  };
  readonly context?: PlainValue;
  readonly metadata?: Readonly<Record<string, PlainValue>>;
}

/** Explicit execution choices, separate from accumulated graph input. */
export function reviewRunOptions(label: string) {
  if (!['Tool', 'Drop', 'Resume'].includes(label)) return undefined;
  return {
    config: {
      tags: ['runtime-review'],
      recursion_limit: 50,
      configurable: { user_id: 'review-user' },
    },
    context: { locale: 'en', features: ['memory'] },
    metadata: { source: 'runtime-review' },
  } as const;
}

/** Application-authored choices for this fixture, not a library targeting helper. */
export function reviewResponse(snapshot: FixtureSnapshot): PlainValue {
  return snapshot.interrupts.some(
    (interrupt) => interrupt.id === 'final-approval'
  )
    ? { 'final-approval': true }
    : { 'live-approval': 'yes', 'live-confirmation': false };
}

export interface FixtureTools {
  weather: {
    args: { city: string };
    result: { city: string; temperature: number };
  };
  count: { args: { values: readonly string[] }; result: number };
}

type FixtureInterrupt = {
  readonly id?: string;
  readonly value?: PlainValue;
  readonly namespace?: readonly string[];
  readonly when?: string;
  readonly resumable?: boolean;
  readonly ns?: readonly string[];
};

export type FixtureCheckpoint = {
  readonly thread_id: string;
  readonly checkpoint_ns: string;
  readonly checkpoint_id: string | null | undefined;
  readonly checkpoint_map:
    | Readonly<Record<string, PlainValue>>
    | null
    | undefined;
};

/** Fixture-local backend extension, expressed entirely through installed core. */
export type FixtureSnapshot = AgentSnapshot<FixtureTools> & {
  readonly history:
    | readonly {
        readonly checkpoint: FixtureCheckpoint;
        readonly parent_checkpoint: FixtureCheckpoint | null | undefined;
        readonly created_at: string | null | undefined;
        readonly next: readonly string[];
      }[]
    | undefined;
  readonly subgraphs: readonly {
    readonly namespace: readonly string[];
    readonly messages: readonly Message[];
    readonly values: Readonly<Record<string, PlainValue>> | undefined;
    readonly interrupts: readonly FixtureInterrupt[];
    readonly error?: AgentError;
  }[];
  readonly reconnect?: { readonly runId: string };
  readonly values: Readonly<Record<string, PlainValue>> | undefined;
  readonly interrupts: readonly FixtureInterrupt[];
};

export function display(snapshot: FixtureSnapshot) {
  const assistant = snapshot.messages.filter(
    (message) => message.role === 'assistant'
  );
  const delivery = assistant.at(-1)?.delivery;
  return {
    text: assistant.map((message) => message.content).join('\n'),
    transcript: snapshot.messages.map((message) => message.content).join('\n'),
    values: JSON.stringify(snapshot.values) ?? 'unobserved',
    history: JSON.stringify(snapshot.history) ?? 'unobserved',
    interrupts: JSON.stringify(snapshot.interrupts),
    subgraphs: JSON.stringify(
      snapshot.subgraphs.map((child) => ({
        namespace: child.namespace,
        messages: child.messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          delivery:
            message.delivery.phase === 'complete'
              ? `complete:${message.delivery.outcome}`
              : message.delivery.phase,
        })),
        values: child.values ?? null,
        interrupts: child.interrupts,
        error: child.error?.message ?? '',
      }))
    ),
    humanMessages: snapshot.messages.filter(
      (message) => message.role === 'user'
    ).length,
    error: snapshot.error?.message ?? '',
    tool: JSON.stringify(snapshot.toolCalls),
    delivery:
      delivery?.phase === 'complete'
        ? `complete:${delivery.outcome}`
        : delivery?.phase ?? '',
  };
}

/** Owner controls deliberately survive framework teardown. */
export function attachOwner(
  session: AgentSession<FixtureTools> & {
    resume(value?: PlainValue): Promise<CompleteOutcome>;
    reconnect(): Promise<CompleteOutcome>;
  },
  unmount: () => void
) {
  const owner = document.createElement('section');
  owner.setAttribute('aria-label', 'Session owner');
  owner.className = 'panel owner-panel';
  const heading = document.createElement('h2');
  heading.textContent = 'Application owner';
  const explanation = document.createElement('p');
  explanation.textContent =
    'These controls survive observer unmount. Unmount removes the framework view; Dispose closes the application-owned session.';
  const controls = document.createElement('div');
  controls.className = 'controls';
  owner.append(heading, explanation, controls);
  const status = document.createElement('output');
  status.setAttribute('data-testid', 'owner');
  status.textContent = 'mounted';
  const button = (label: string, action: () => void | Promise<void>) => {
    const control = document.createElement('button');
    control.textContent = label;
    control.addEventListener('click', () => void action());
    controls.append(control);
  };
  button('Unmount', () => {
    unmount();
    status.textContent = 'unmounted';
  });
  button('Dispose', async () => {
    await session.dispose();
    status.textContent = 'disposed';
  });
  button('Send after dispose', async () => {
    status.textContent = 'submitting';
    status.textContent = await session.submit('Send');
  });
  button('Resume after dispose', async () => {
    status.textContent = 'resuming';
    status.textContent = await session.resume(true);
  });
  button('Reconnect after dispose', async () => {
    status.textContent = 'reconnecting';
    status.textContent = await session.reconnect();
  });
  const label = document.createElement('h3');
  label.textContent = 'Owner state';
  owner.append(label, status);
  document.body.append(owner);
}
