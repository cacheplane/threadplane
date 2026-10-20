import { StrictMode } from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { createReactApplication } from './application';
import { applicationFixture } from './application-fixture';
import { App } from './app';

afterEach(cleanup);

it('popup visibility preserves the conversation DOM, draft and application owners', async () => {
  const fixture = applicationFixture();
  const application = createReactApplication(fixture.options);
  try {
    application.start();
    await waitFor(() =>
      expect(application.getSnapshot().selection.status).toBe('ready')
    );
    const work = { ...fixture.counters };
    const view = render(
      <StrictMode>
        <App application={application} presentation="popup" />
      </StrictMode>
    );
    const launcher = view.getByRole('button', { name: 'Chat', exact: true });
    const section = view.container.querySelector('.conversation');
    const input = view.container.querySelector<HTMLTextAreaElement>('#message');
    expect(input).toBeTruthy();
    expect(view.queryByRole('dialog')).toBeNull();
    expect(launcher.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(launcher);
    expect(view.getByRole('dialog', { name: 'Conversation' })).toBeTruthy();
    fireEvent.change(input!, { target: { value: 'Keep this unsent draft.' } });
    fireEvent.click(view.getByRole('button', { name: 'Close chat' }));
    expect(view.queryByRole('dialog')).toBeNull();
    expect(section?.isConnected).toBe(true);
    expect(input?.value).toBe('Keep this unsent draft.');
    fireEvent.click(launcher);
    expect(view.container.querySelector('.conversation')).toBe(section);
    expect(view.getByRole('textbox', { name: 'Message' })).toBe(input);
    expect(input?.value).toBe('Keep this unsent draft.');
    expect(fixture.counters).toEqual(work);
    view.unmount();
    expect(fixture.counters).toEqual(work);
  } finally {
    application.dispose();
  }
  expect(fixture.counters.disposals).toBe(1);
});
