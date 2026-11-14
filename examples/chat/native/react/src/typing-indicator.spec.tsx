import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createReactApplication } from './application';
import { applicationFixture } from './application-fixture';
import { App } from './app';

afterEach(cleanup);
it('shows only ready selected runtime waiting without duplicating the submission announcement', async () => {
  const fixture = applicationFixture();
  const application = createReactApplication(fixture.options);
  try {
    application.start();
    await waitFor(() =>
      expect(application.getSnapshot().selection.status).toBe('ready')
    );
    const source = application.getSnapshot();
    // MessageList reads the prepared rows, so the waiting view empties both.
    const waiting = {
      ...source,
      messages: [],
      runtime: { ...source.runtime!, status: 'running' as const, messages: [] },
    };
    const snapshot = vi.fn(() => source);
    const observed = { ...application, getSnapshot: snapshot };
    const work = { ...fixture.counters };
    const view = render(<App application={observed} />);
    // Count announcements on the same empty rows while idle, so running is the only change.
    snapshot.mockReturnValue({ ...source, messages: [] });
    view.rerender(<App application={observed} />);
    const announcements = view.getAllByRole('status').length;
    snapshot.mockReturnValue(waiting);
    view.rerender(<App application={observed} />);
    const label = view.getByText('Assistant is typing');
    expect(
      label.closest('[role="status"], [aria-live], [aria-atomic]')
    ).toBeNull();
    const status = view.container.querySelector('.submission-status');
    expect(status?.getAttribute('role')).toBe('status');
    expect(view.getAllByRole('status')).toHaveLength(announcements);
    for (const next of [
      source,
      { ...waiting, runtime: null },
      {
        ...waiting,
        selection: { ...source.selection, status: 'pending' as const },
      },
      { ...waiting, runtime: { ...waiting.runtime, status: 'error' as const } },
      {
        ...waiting,
        // The fixture's prepared rows end with assistant text.
        messages: source.messages,
        runtime: {
          ...waiting.runtime,
          messages: [{ id: 'a', role: 'assistant' as const, content: 'First' }],
        },
      },
    ]) {
      snapshot.mockReturnValue(next as typeof source);
      view.rerender(<App application={observed} />);
      expect(view.queryByText('Assistant is typing')).toBeNull();
      expect(view.container.querySelector('.submission-status')).toBe(status);
    }
    view.unmount();
    expect(fixture.counters.commands).toBe(work.commands);
    expect(fixture.counters.disposals).toBe(work.disposals);
  } finally {
    application.dispose();
  }
});
