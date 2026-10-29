import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createReactApplication } from './application';
import { applicationFixture } from './application-fixture';
import { App } from './app';
import { PROJECT_CATALOG_KEY } from './project-catalog';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

it('New captures the exact current project filter without selecting it or changing the retained conversation', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  localStorage.setItem(
    PROJECT_CATALOG_KEY,
    JSON.stringify({
      version: 1,
      projects: [
        { id: ' p/one ', name: 'First project' },
        { id: '__proto__', name: 'Second project' },
      ],
    })
  );
  const fixture = applicationFixture();
  const owner = createReactApplication(fixture.options);
  const newConversation = vi.fn();
  const application = Object.freeze({ ...owner, newConversation });
  try {
    owner.start();
    await waitFor(() =>
      expect(owner.getSnapshot().selection.status).toBe('ready')
    );
    const view = render(
      <App application={application} presentation="sidenav" />
    );
    expect(
      view.getByText(/New conversations use the selected project/)
    ).toBeTruthy();
    const nav = view.getByRole('navigation', {
      name: 'Conversations',
      exact: true,
    });
    const input = view.getByRole('textbox', {
      name: 'Message',
      exact: true,
    }) as HTMLTextAreaElement;
    fireEvent.change(input, {
      target: { value: 'Retain this draft until confirmed creation' },
    });
    const selected = owner.getSnapshot().selection;
    const runtime = owner.getSnapshot().runtime;
    for (const [name, id] of [
      ['First project', ' p/one '],
      ['Second project', '__proto__'],
      ['All conversations', null],
    ] as const) {
      fireEvent.click(within(nav).getByRole('button', { name, exact: true }));
      fireEvent.click(
        within(nav).getByRole('button', { name: 'New', exact: true })
      );
      expect(newConversation).toHaveBeenLastCalledWith(id);
      expect(owner.getSnapshot().selection).toBe(selected);
      expect(owner.getSnapshot().runtime).toBe(runtime);
      expect(view.getByRole('textbox', { name: 'Message', exact: true })).toBe(
        input
      );
      expect(input.value).toBe('Retain this draft until confirmed creation');
    }
    expect(newConversation).toHaveBeenCalledTimes(3);
  } finally {
    owner.dispose();
  }
});
