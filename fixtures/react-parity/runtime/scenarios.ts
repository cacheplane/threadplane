import type {
  AgentSession,
  AgentSnapshot,
  PlainValue,
} from '@threadplane/core';

export const reviewInstructions =
  'Click Load three times: saved history, equal refresh, then empty history. Continue with Send → Tool → Error → Hold → Stop → Pause → Stop → Send. Finish with Unmount → Dispose → Send after dispose in the owner controls below. Only three Load requests are available per server; restart the review command to reset. Reloading the page does not reset history.';

export interface FixtureTools {
  weather: {
    args: { city: string };
    result: { city: string; temperature: number };
  };
  count: { args: { values: readonly string[] }; result: number };
}

/** Fixture-local backend extension, expressed entirely through installed core. */
export type FixtureSnapshot = AgentSnapshot<FixtureTools> & {
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
  session: AgentSession<FixtureTools>,
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
    status.textContent = await session.submit('Send');
  });
  const label = document.createElement('h3');
  label.textContent = 'Owner state';
  owner.append(label, status);
  document.body.append(owner);
}
