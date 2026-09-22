import type { AgentSession, AgentSnapshot } from '@threadplane/core';

export interface FixtureTools {
  weather: { args: { city: string }; result: { city: string; temperature: number } };
  count: { args: { values: readonly string[] }; result: number };
}

export function display(snapshot: AgentSnapshot<FixtureTools>) {
  const assistant = snapshot.messages.filter((message) => message.role === 'assistant');
  const delivery = assistant.at(-1)?.delivery;
  return {
    text: assistant.map((message) => message.content).join('\n'),
    transcript: snapshot.messages.map((message) => message.content).join('\n'),
    error: snapshot.error?.message ?? '',
    tool: JSON.stringify(snapshot.toolCalls),
    delivery: delivery?.phase === 'complete' ? `complete:${delivery.outcome}` : delivery?.phase ?? '',
  };
}

/** Owner controls deliberately survive framework teardown. */
export function attachOwner(session: AgentSession<FixtureTools>, unmount: () => void) {
  const owner = document.createElement('section');
  owner.setAttribute('aria-label', 'Session owner');
  const status = document.createElement('output');
  status.setAttribute('data-testid', 'owner');
  status.textContent = 'mounted';
  const button = (label: string, action: () => void | Promise<void>) => {
    const control = document.createElement('button');
    control.textContent = label;
    control.addEventListener('click', () => void action());
    owner.append(control);
  };
  button('Unmount', () => { unmount(); status.textContent = 'unmounted'; });
  button('Dispose', async () => { await session.dispose(); status.textContent = 'disposed'; });
  button('Send after dispose', async () => { status.textContent = await session.submit('Send'); });
  owner.append(status);
  document.body.append(owner);
}
