import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createReactApplication } from './application';
import { applicationFixture } from './application-fixture';
import { App } from './app';

afterEach(cleanup);
it('uses only selected view controls and current runtime mode without application commands', async () => {
  const fixture = applicationFixture();
  const application = createReactApplication(fixture.options);
  try {
    application.start();
    await waitFor(() =>
      expect(application.getSnapshot().selection.status).toBe('ready')
    );
    const source = application.getSnapshot();
    const snapshot = vi.fn(() => source);
    const observed = { ...application, getSnapshot: snapshot };
    const before = { ...fixture.counters };
    const view = render(<App application={observed} />);
    const region = view.getByRole('region', { name: 'Conversation messages' });
    const focus = vi.spyOn(region, 'focus');
    let top = 800;
    Object.defineProperties(region, {
      scrollHeight: { configurable: true, get: () => 1000 },
      clientHeight: { configurable: true, get: () => 200 },
      scrollTop: {
        configurable: true,
        get: () => top,
        set: (value) => {
          top = Math.min(value, 800);
        },
      },
    });
    fireEvent.scroll(region);
    top = 100;
    fireEvent.scroll(region);
    expect(view.getByRole('button', { name: 'Scroll to latest' })).toBeTruthy();
    snapshot.mockReturnValue({
      ...source,
      runtime: { ...source.runtime!, status: 'running' },
    });
    view.rerender(<App application={observed} />);
    expect(top).toBe(100);
    expect(focus).not.toHaveBeenCalled();
    fireEvent.click(
      view.getByRole('button', {
        name: 'Scroll to latest, response in progress',
      })
    );
    expect(top).toBe(800);
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(document.activeElement).toBe(region);
    expect(view.queryByRole('button', { name: /Scroll to latest/ })).toBeNull();
    snapshot.mockReturnValue({
      ...source,
      selection: { ...source.selection, status: 'pending' },
    });
    view.rerender(<App application={observed} />);
    expect(view.queryByRole('button', { name: /Scroll to latest/ })).toBeNull();
    view.unmount();
    expect(fixture.counters.commands).toBe(before.commands);
    expect(fixture.counters.disposals).toBe(before.disposals);
  } finally {
    application.dispose();
  }
});
