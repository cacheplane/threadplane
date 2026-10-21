import { StrictMode } from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { createReactApplication } from './application';
import { applicationFixture } from './application-fixture';
import { App } from './app';

afterEach(cleanup);

it('sidebar preference changes only layout while retaining the directory, drafts and owners', async () => {
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
        <App application={application} presentation="sidebar" />
      </StrictMode>
    );
    const preference = view.getByRole('checkbox', {
      name: 'Keep page beside chat',
    }) as HTMLInputElement;
    const filter = view.getByRole('searchbox') as HTMLInputElement;
    const directory = view.getByRole('complementary');
    const input =
      view.container.querySelector<HTMLTextAreaElement>('#message')!;
    const layout = view.container.querySelector('.tp-chat-sidebar-layout');
    expect(preference.checked).toBe(true);
    expect(directory.closest('.tp-chat-sidebar-layout__page')).toBeTruthy();
    expect(view.getAllByRole('complementary')).toHaveLength(1);
    expect(layout?.classList.contains('tp-chat-sidebar-layout--push')).toBe(
      false
    );
    fireEvent.change(filter, { target: { value: 'First' } });
    fireEvent.click(view.getByRole('button', { name: 'Chat', exact: true }));
    fireEvent.change(input, { target: { value: 'Preserve this draft.' } });
    expect(layout?.classList.contains('tp-chat-sidebar-layout--push')).toBe(
      true
    );
    for (const checked of [false, true, false]) {
      fireEvent.click(preference);
      expect(preference.checked).toBe(checked);
      expect(layout?.classList.contains('tp-chat-sidebar-layout--push')).toBe(
        checked
      );
      expect(view.getByRole('searchbox')).toBe(filter);
      expect(filter.value).toBe('First');
      expect(view.getByRole('textbox', { name: 'Message' })).toBe(input);
      expect(input.value).toBe('Preserve this draft.');
      expect(view.getByRole('complementary')).toBe(directory);
      expect(fixture.counters).toEqual(work);
    }
    fireEvent.click(view.getByRole('button', { name: 'Close chat' }));
    expect(filter.closest('[inert], [hidden], [role="dialog"]')).toBeNull();
    fireEvent.click(preference);
    fireEvent.click(view.getByRole('button', { name: 'Chat', exact: true }));
    expect(layout?.classList.contains('tp-chat-sidebar-layout--push')).toBe(
      true
    );
    expect(view.getByRole('textbox', { name: 'Message' })).toBe(input);
    expect(input.value).toBe('Preserve this draft.');
    expect(fixture.counters).toEqual(work);
    view.unmount();
    expect(fixture.counters).toEqual(work);
  } finally {
    application.dispose();
  }
  expect(fixture.counters.disposals).toBe(1);
});

it.each(['popup', 'sidebar'] as const)(
  '%s visibility preserves the conversation DOM, draft and application owners',
  async (presentation) => {
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
          <App application={application} presentation={presentation} />
        </StrictMode>
      );
      const launcher = view.getByRole('button', { name: 'Chat', exact: true });
      const section = view.container.querySelector('.conversation');
      const input =
        view.container.querySelector<HTMLTextAreaElement>('#message');
      expect(input).toBeTruthy();
      expect(view.queryByRole('dialog')).toBeNull();
      expect(launcher.getAttribute('aria-expanded')).toBe('false');
      fireEvent.click(launcher);
      expect(view.getByRole('dialog', { name: 'Conversation' })).toBeTruthy();
      fireEvent.change(input!, {
        target: { value: 'Keep this unsent draft.' },
      });
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
  }
);
