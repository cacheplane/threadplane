import type {
  AgentSession,
  AgentSnapshot,
  CompleteOutcome,
  PlainValue,
} from '@threadplane/core';

export const reviewInstructions =
  'Click Load three times: saved history, equal refresh, then empty history. Continue with Send → Tool → Error → Hold → Stop → Pause → Stop → Resume → Resume → Drop → Reconnect → Send. Tool and Drop send model, reasoning effort, UI mode and itinerary state once; displayed values come from the server. Resume first sends both approval responses, then confirms the final action. Drop loses observation of a running run; Reconnect joins that same run without another submission. Finish with Unmount → Dispose → Send after dispose → Resume after dispose → Reconnect after dispose in the owner controls below. Only three Load requests and one Drop are available per server; restart the review command to reset. Reloading the page does not reset server state.';

/** Fixture-local input contract uses only the installed neutral data vocabulary. */
export type FixtureInputState = Readonly<Record<string, PlainValue>> & {
  readonly messages?: never;
  readonly client_tools?: never;
};

export type FixtureSubmitInput = string | {
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
      itinerary: [{ id: 'paris', day: 1, place: 'Paris', note: 'Check the weather' }],
    },
  };
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

/** Fixture-local backend extension, expressed entirely through installed core. */
export type FixtureSnapshot = AgentSnapshot<FixtureTools> & {
  readonly reconnect?: { readonly runId: string };
  readonly values: Readonly<Record<string, PlainValue>> | undefined;
  readonly interrupts: readonly {
    readonly id?: string;
    readonly value?: PlainValue;
    readonly namespace?: readonly string[];
    readonly when?: string;
    readonly resumable?: boolean;
    readonly ns?: readonly string[];
  }[];
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
    interrupts: JSON.stringify(snapshot.interrupts),
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
