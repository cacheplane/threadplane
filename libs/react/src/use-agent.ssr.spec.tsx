import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import { createFakeAgentSession } from '@threadplane/core/testing';
import { useAgent } from './use-agent';

type Session = ReturnType<typeof createFakeAgentSession>['session'];

function Status({ session }: { readonly session: Session }) {
  const snapshot = useAgent(session);
  return (
    <p>
      {`${snapshot.status}:${snapshot.messages.map((m) => m.content).join(',')}`}
    </p>
  );
}

it('renders the session snapshot on the server without subscribing', () => {
  const fake = createFakeAgentSession();
  let subscriptions = 0;
  const session: Session = {
    ...fake.session,
    getSnapshot: () => fake.session.getSnapshot(),
    subscribe: (notify) => {
      subscriptions += 1;
      return fake.session.subscribe(notify);
    },
  };
  const html = renderToString(<Status session={session} />);
  expect(html).toContain('idle:');
  expect(subscriptions).toBe(0);
});

it('renders the snapshot a session already holds', () => {
  const fake = createFakeAgentSession();
  fake.push({ role: 'user', content: 'hello from the server' });
  const html = renderToString(<Status session={fake.session} />);
  expect(html).toContain('hello from the server');
});
