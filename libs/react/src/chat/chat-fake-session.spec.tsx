import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
} from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import {
  createFakeAgentSession,
  type FakeAssistantStream,
} from '@threadplane/core/testing';
import { useAgent } from '../use-agent';
import { Chat } from './index';

afterEach(cleanup);

it('submits from the Chat composer and shows a reply streamed by the fake session', async () => {
  let reply: FakeAssistantStream | undefined;
  const fake = createFakeAgentSession({
    onSubmit: (input, session) => {
      reply = session.stream();
      reply.append(`Echo: ${input}`);
    },
  });
  const view = render(<Chat session={fake.session} />);
  const box = view.getByRole('textbox', { name: 'Message' });
  fireEvent.change(box, { target: { value: '  Hello  ' } });
  await act(async () => {
    fireEvent.click(view.getByRole('button', { name: 'Send' }));
  });

  expect(fake.submits.map((call) => call.input)).toEqual(['Hello']);
  expect(view.getByText('Hello')).toBeTruthy();
  expect(view.getByText('Echo: Hello')).toBeTruthy();
  expect(fake.session.getSnapshot().status).toBe('running');
  expect(view.getByRole('button', { name: 'Stop' })).toBeTruthy();

  act(() => {
    reply?.append(' and more');
    reply?.complete();
  });
  expect(view.getByText('Echo: Hello and more')).toBeTruthy();
  expect(fake.session.getSnapshot().status).toBe('idle');
  expect(view.queryByRole('button', { name: 'Stop' })).toBeNull();
});

it('stops a running reply from the Chat Stop button', async () => {
  const fake = createFakeAgentSession();
  const view = render(<Chat session={fake.session} />);
  act(() => {
    fake.stream({ text: 'Partial' });
  });
  await act(async () => {
    fireEvent.click(view.getByRole('button', { name: 'Stop' }));
  });
  expect(fake.stopCount).toBe(1);
  expect(fake.session.getSnapshot().status).toBe('idle');
  expect(view.getByText('Partial')).toBeTruthy();
});

it('drives useAgent through the fake session controls', () => {
  const fake = createFakeAgentSession();
  const { result } = renderHook(() => useAgent(fake.session));
  const initial = result.current;
  expect(initial.messages).toEqual([]);
  act(() => {
    fake.push({ role: 'assistant', content: 'Hi' });
    fake.setError({ kind: 'server', message: 'Down', retryable: true });
  });
  expect(result.current).not.toBe(initial);
  expect(result.current.messages.map((m) => m.content)).toEqual(['Hi']);
  expect(result.current.status).toBe('error');
  expect(result.current.error?.message).toBe('Down');
});
