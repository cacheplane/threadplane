import { cleanup, render, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createReactApplication } from './application';
import { applicationFixture } from './application-fixture';
import { App } from './app';

afterEach(cleanup);
it('shows only the ready selected runtime error, literally and without execution recovery', async () => {
  const fixture = applicationFixture();
  const application = createReactApplication(fixture.options);
  try {
    application.start();
    await waitFor(() =>
      expect(application.getSnapshot().selection.status).toBe('ready')
    );
    const source = application.getSnapshot();
    const error = {
      kind: 'server' as const,
      message: '<img src=x onerror=bad()>',
      detail: '<script>literal</script>',
      retryable: true,
      recovery: 'retry' as const,
    };
    const failed = { ...source, runtime: { ...source.runtime!, error } };
    const snapshot = vi.fn(() => failed as typeof source);
    const retry = vi.fn();
    const observed = { ...application, getSnapshot: snapshot, retry };
    const work = { ...fixture.counters };
    const view = render(<App application={observed} />);
    const alert = view.getByRole('alert');
    expect(alert.textContent).toContain(error.message);
    expect(alert.textContent).toContain(error.detail);
    expect(within(alert).queryByRole('button')).toBeNull();
    expect(view.container.querySelector('script, img')).toBeNull();
    for (const next of [
      source,
      {
        ...failed,
        selection: { ...source.selection, status: 'pending' as const },
      },
    ]) {
      snapshot.mockReturnValue(next);
      view.rerender(<App application={observed} />);
      expect(view.queryByText(error.message)).toBeNull();
    }
    view.unmount();
    expect(retry).not.toHaveBeenCalled();
    expect(fixture.counters.commands).toBe(work.commands);
    expect(fixture.counters.disposals).toBe(work.disposals);
  } finally {
    application.dispose();
  }
});
