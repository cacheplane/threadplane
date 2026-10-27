import { StrictMode } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { createReactApplication } from './application';
import { applicationFixture } from './application-fixture';
import { App } from './app';

afterEach(cleanup);
it('renders application-owned raw trip output through StrictMode, unrelated updates, and an actual remount', async () => {
  const f = applicationFixture();
  f.rawTitle('Raw <b>City</b>');
  const app = createReactApplication(f.options);
  try {
    app.start();
    await waitFor(() =>
      expect(app.getSnapshot().selection.status).toBe('ready')
    );
    expect(f.counters.owners).toBe(1);
    const accepted = app.getSnapshot().messages;
    const work = { ...f.counters };
    const view = render(
      <StrictMode>
        <App application={app} />
      </StrictMode>
    );
    const section = view.getByRole('region', { name: 'Trip summary' });
    expect(view.getAllByRole('region', { name: 'Trip summary' })).toHaveLength(
      1
    );
    expect(
      view.getByRole('heading', { level: 4, name: 'Raw <b>City</b>' })
    ).toBeTruthy();
    expect(accepted[0].tripSummaryRenders[0].state.title).toBe('<b>City</b>');
    expect(
      accepted[0].a2uiTripSummaryRenders[0].spec.elements['root'].props['title']
    ).toBe('Raw <b>City</b>');
    expect(view.getByText('<script>literal</script>')).toBeTruthy();
    expect(view.container.querySelector('b,script')).toBeNull();
    await act(async () => {
      app.refresh();
    });
    expect(view.getByRole('region', { name: 'Trip summary' })).toBe(section);
    expect(app.getSnapshot().messages).toBe(accepted);
    view.rerender(
      <StrictMode>
        <App application={app} />
      </StrictMode>
    );
    expect(view.getByRole('region', { name: 'Trip summary' })).toBe(section);
    view.unmount();
    expect(f.counters).toEqual(work);
    const fresh = render(
      <StrictMode>
        <App application={app} />
      </StrictMode>
    );
    expect(fresh.getByRole('region', { name: 'Trip summary' })).not.toBe(
      section
    );
    expect(app.getSnapshot().messages).toBe(accepted);
    expect(f.counters).toEqual(work);
    fresh.unmount();
    expect(f.counters.disposals).toBe(0);
  } finally {
    app.dispose();
  }
  expect(f.counters.disposals).toBe(1);
});
