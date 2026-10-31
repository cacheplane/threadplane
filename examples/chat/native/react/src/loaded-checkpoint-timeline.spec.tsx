import { StrictMode, useLayoutEffect } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { TimelineProps } from '@threadplane/react/chat';
import { createReactApplication, type ReactApplication } from './application';
import { applicationFixture } from './application-fixture';
import { App } from './app';
import { LoadedCheckpointTimeline } from './loaded-checkpoint-timeline';
import type { CheckpointPage } from './checkpoint-metadata';

let latest: TimelineProps;
vi.mock('@threadplane/react/chat', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('@threadplane/react/chat')
  >();
  return {
    ...original,
    Timeline: (props: TimelineProps) => {
      latest = props;
      return <original.Timeline {...props} />;
    },
  };
});
afterEach(cleanup);
const page = (id = '<b>id</b>'): CheckpointPage =>
  [
    {
      checkpoint: { checkpoint_id: id, checkpoint_ns: '' },
      parent_checkpoint: null,
      created_at: '<script>now</script>',
      next: ['<img>next'],
    },
  ] as unknown as CheckpointPage;
function owner(initial = page()) {
  let current = initial;
  let id = 'a';
  const application = {
    getSnapshot: () => ({
      selection: { status: 'ready', id },
      runtime: { history: current },
    }),
  } as ReactApplication;
  return {
    application,
    setPage: (value: CheckpointPage) => {
      current = value;
    },
    setId: (value: string) => {
      id = value;
    },
  };
}
it('starts collapsed and distinguishes unloaded and empty pages', () => {
  const f = owner(undefined);
  const view = render(
    <LoadedCheckpointTimeline
      application={f.application}
      threadId="a"
      page={undefined}
    />
  );
  expect(
    view.getByText('Loaded checkpoint timeline').closest('details')?.open
  ).toBe(false);
  expect(
    view.getByText('Checkpoint history has not been loaded.')
  ).toBeTruthy();
  view.rerender(
    <LoadedCheckpointTimeline
      application={f.application}
      threadId="a"
      page={[]}
    />
  );
  expect(view.getByText('No checkpoints in the loaded page.')).toBeTruthy();
});
it('shows explicit empty metadata labels and unavailable labels without blank details', () => {
  const p = [
    {
      checkpoint: { checkpoint_id: '', checkpoint_ns: '' },
      parent_checkpoint: { checkpoint_id: '' },
      created_at: '',
      next: [''],
    },
    {},
  ] as CheckpointPage;
  const f = owner(p);
  const view = render(
    <LoadedCheckpointTimeline
      application={f.application}
      threadId="a"
      page={p}
    />
  );
  fireEvent.click(view.getAllByRole('button', { hidden: true })[0]);
  const region = view.getByRole('region', {
    name: 'Selected checkpoint metadata',
    hidden: true,
  });
  expect(
    Array.from(region.querySelectorAll('dd'), (node) => node.textContent)
  ).toEqual([
    'Checkpoint ID empty',
    'Root namespace (empty)',
    'Created timestamp empty',
    'Parent checkpoint ID empty',
    'Empty next-node name',
  ]);
  fireEvent.click(view.getAllByRole('button', { hidden: true })[1]);
  expect(
    Array.from(region.querySelectorAll('dd'), (node) => node.textContent)
  ).toEqual([
    'Checkpoint ID unavailable',
    'Namespace unavailable',
    'Created timestamp unavailable',
    'Parent checkpoint ID unavailable',
    'Next nodes unavailable',
  ]);
});
it('inspects literal metadata with unique region IDs and preserves selection in StrictMode', () => {
  const p = page();
  const f = owner(p);
  const view = render(
    <StrictMode>
      <LoadedCheckpointTimeline
        application={f.application}
        threadId="a"
        page={p}
      />
      <LoadedCheckpointTimeline
        application={f.application}
        threadId="a"
        page={p}
      />
    </StrictMode>
  );
  fireEvent.click(view.getAllByText('Loaded checkpoint timeline')[0]);
  fireEvent.click(
    view.getAllByRole('button', { name: /Checkpoint 1/, hidden: true })[0]
  );
  const region = view.getByRole('region', {
    name: 'Selected checkpoint metadata',
    hidden: true,
  });
  expect(region.textContent).toContain('Root namespace (empty)');
  expect(region.textContent).toContain('<script>now</script>');
  expect(view.container.querySelector('b,script,img')).toBeNull();
  fireEvent.click(
    view.getAllByRole('button', { name: /Checkpoint 1/, hidden: true })[1]
  );
  const ids = view
    .getAllByRole('region', {
      name: 'Selected checkpoint metadata',
      hidden: true,
    })
    .map((node) => node.getAttribute('aria-labelledby'));
  expect(new Set(ids).size).toBe(2);
  view.rerender(
    <StrictMode>
      <LoadedCheckpointTimeline
        application={f.application}
        threadId="a"
        page={p}
      />
      <LoadedCheckpointTimeline
        application={f.application}
        threadId="a"
        page={p}
      />
    </StrictMode>
  );
  expect(
    view.getAllByRole('region', {
      name: 'Selected checkpoint metadata',
      hidden: true,
    })
  ).toHaveLength(2);
});
it('rejects live page/thread changes before rerender and invalid occurrence IDs', () => {
  const p = page();
  const f = owner(p);
  const view = render(
    <LoadedCheckpointTimeline
      application={f.application}
      threadId="a"
      page={p}
    />
  );
  const pick = latest.onSelect;
  f.setPage(page());
  act(() => pick('0'));
  expect(view.queryByText('Selected checkpoint metadata')).toBeNull();
  f.setPage(p);
  f.setId('b');
  act(() => pick('0'));
  expect(view.queryByText('Selected checkpoint metadata')).toBeNull();
  f.setId('a');
  act(() => pick('999'));
  expect(view.queryByText('Selected checkpoint metadata')).toBeNull();
});
it('discloses omitted checkpoints and truncated selected metadata', () => {
  const p = Array(12).fill({
    checkpoint: { checkpoint_id: 'x'.repeat(513) },
    next: Array(11).fill('node'),
  }) as CheckpointPage;
  const f = owner(p);
  const view = render(
    <LoadedCheckpointTimeline
      application={f.application}
      threadId="a"
      page={p}
    />
  );
  expect(
    view.getByText('2 additional checkpoints omitted; showing the first 10.')
  ).toBeTruthy();
  fireEvent.click(view.getAllByRole('button', { hidden: true })[9]);
  expect(
    view.getByText(
      'Metadata truncated for display; showing up to 10 next-node names.'
    )
  ).toBeTruthy();
  expect(view.getAllByRole('button', { hidden: true })).toHaveLength(10);
});
it('clears committed thread changes even when the same page is reused', () => {
  const p = page();
  const f = owner(p);
  const view = render(
    <LoadedCheckpointTimeline
      application={f.application}
      threadId="a"
      page={p}
    />
  );
  const stale = latest.onSelect;
  act(() => stale('0'));
  f.setId('b');
  view.rerender(
    <LoadedCheckpointTimeline
      application={f.application}
      threadId="b"
      page={p}
    />
  );
  expect(view.queryByText('Selected checkpoint metadata')).toBeNull();
  f.setId('a');
  view.rerender(
    <LoadedCheckpointTimeline
      application={f.application}
      threadId="a"
      page={p}
    />
  );
  act(() => stale('0'));
  expect(view.queryByText('Selected checkpoint metadata')).toBeNull();
});
it('retains a selection accepted in layout across StrictMode effect replay', () => {
  const p = page();
  const f = owner(p);
  let selected = false;
  function PickOnce() {
    useLayoutEffect(() => {
      if (!selected) {
        selected = true;
        latest.onSelect('0');
      }
    }, []);
    return null;
  }
  const view = render(
    <StrictMode>
      <LoadedCheckpointTimeline
        application={f.application}
        threadId="a"
        page={p}
      />
      <PickOnce />
    </StrictMode>
  );
  expect(view.getByText('Selected checkpoint metadata')).toBeTruthy();
});
it('inspects separate occurrences with duplicate or missing backend IDs', () => {
  const p = [
    { checkpoint: { checkpoint_id: 'same', checkpoint_ns: 'first' } },
    { checkpoint: { checkpoint_id: 'same', checkpoint_ns: 'second' } },
    { checkpoint: { checkpoint_ns: 'missing' } },
  ] as CheckpointPage;
  const f = owner(p);
  const view = render(
    <LoadedCheckpointTimeline
      application={f.application}
      threadId="a"
      page={p}
    />
  );
  for (const [index, namespace] of ['first', 'second', 'missing'].entries()) {
    fireEvent.click(view.getAllByRole('button', { hidden: true })[index]);
    expect(
      view.getByRole('region', {
        name: 'Selected checkpoint metadata',
        hidden: true,
      }).textContent
    ).toContain(namespace);
  }
});
it('retires page and application scopes across A-B-A, during layout, and on unmount', () => {
  const p = page();
  const other = page();
  const f = owner(p);
  const g = owner(p);
  function Observer({ pick }: { pick?: () => void }) {
    useLayoutEffect(() => {
      pick?.();
    });
    return null;
  }
  const content = (
    application: ReactApplication,
    current: CheckpointPage,
    pick?: () => void
  ) => (
    <>
      <LoadedCheckpointTimeline
        application={application}
        threadId="a"
        page={current}
      />
      <Observer pick={pick} />
    </>
  );
  const view = render(content(f.application, p));
  const first = latest.onSelect;
  act(() => first('0'));
  expect(view.getByText('Selected checkpoint metadata')).toBeTruthy();
  f.setPage(other);
  view.rerender(content(f.application, other, () => first('0')));
  expect(view.queryByText('Selected checkpoint metadata')).toBeNull();
  f.setPage(p);
  view.rerender(content(f.application, p));
  act(() => first('0'));
  expect(view.queryByText('Selected checkpoint metadata')).toBeNull();
  const second = latest.onSelect;
  view.rerender(content(g.application, p));
  view.rerender(content(f.application, p));
  act(() => second('0'));
  expect(view.queryByText('Selected checkpoint metadata')).toBeNull();
  const retired = latest.onSelect;
  const snapshot = vi.spyOn(f.application, 'getSnapshot');
  view.unmount();
  snapshot.mockClear();
  act(() => retired('0'));
  expect(snapshot).not.toHaveBeenCalled();
});
it('preserves the real application runtime, transcript, draft node/value, URL and I/O', async () => {
  const f = applicationFixture();
  const application = createReactApplication(f.options);
  try {
    application.start();
    await waitFor(() =>
      expect(application.getSnapshot().selection.status).toBe('ready')
    );
    const view = render(
      <StrictMode>
        <App application={application} />
      </StrictMode>
    );
    const input = view.getByRole('textbox', { name: 'Message' });
    fireEvent.change(input, { target: { value: 'Retained draft' } });
    const before = application.getSnapshot();
    const counters = { ...f.counters };
    const url = f.options.history.currentUrl();
    const transcript = view.getByRole('region', {
      name: 'Conversation messages',
    });
    fireEvent.click(view.getByText('Loaded checkpoint timeline'));
    fireEvent.click(
      view.getByRole('button', { name: /Checkpoint 1/, hidden: true })
    );
    await act(async () => {
      application.refresh();
    });
    expect(view.getByText('Selected checkpoint metadata')).toBeTruthy();
    fireEvent.click(view.getByText('Loaded checkpoint timeline'));
    expect(view.getByRole('textbox', { name: 'Message' })).toBe(input);
    expect((input as HTMLTextAreaElement).value).toBe('Retained draft');
    expect(view.getByRole('region', { name: 'Conversation messages' })).toBe(
      transcript
    );
    expect(application.getSnapshot().runtime).toBe(before.runtime);
    expect(application.getSnapshot().messages).toBe(before.messages);
    expect(f.options.history.currentUrl()).toBe(url);
    expect(f.counters).toEqual(counters);
  } finally {
    application.dispose();
  }
});
it('replaces a ready application with one transcript and fresh timeline and draft ownership', async () => {
  const first = applicationFixture();
  const second = applicationFixture();
  second.options.history.push('http://example.test/?thread=b');
  const applicationA = createReactApplication(first.options);
  const applicationB = createReactApplication(second.options);
  try {
    applicationA.start();
    applicationB.start();
    await waitFor(() => {
      expect(applicationA.getSnapshot().selection).toMatchObject({
        status: 'ready',
        id: 'a',
      });
      expect(applicationB.getSnapshot().selection).toMatchObject({
        status: 'ready',
        id: 'b',
      });
    });
    const view = render(<App application={applicationA} />);
    const oldTranscript = view.getByRole('region', {
      name: 'Conversation messages',
    });
    const oldDraft = view.getByRole('textbox', { name: 'Message' });
    fireEvent.change(oldDraft, { target: { value: 'Owner A draft' } });
    fireEvent.click(view.getByText('Loaded checkpoint timeline'));
    fireEvent.click(
      view.getByRole('button', { name: /Checkpoint 1/, hidden: true })
    );
    expect(view.getByText('Selected checkpoint metadata')).toBeTruthy();
    const countersA = { ...first.counters };
    const countersB = { ...second.counters };
    view.rerender(<App application={applicationB} />);
    expect(
      view.getAllByRole('region', { name: 'Conversation messages' })
    ).toHaveLength(1);
    expect(
      view.getByRole('region', { name: 'Conversation messages' })
    ).not.toBe(oldTranscript);
    expect(oldTranscript.isConnected).toBe(false);
    expect(view.getByRole('heading', { name: 'b', level: 1 })).toBeTruthy();
    expect(applicationB.getSnapshot().selection.id).toBe('b');
    expect(second.options.history.currentUrl()).toBe(
      'http://example.test/?thread=b'
    );
    expect(view.queryByText('Selected checkpoint metadata')).toBeNull();
    expect(view.getAllByText('Loaded checkpoint timeline')).toHaveLength(1);
    expect(
      view.getByText('Loaded checkpoint timeline').closest('details')?.open
    ).toBe(false);
    const newDraft = view.getByRole('textbox', { name: 'Message' });
    expect(newDraft).not.toBe(oldDraft);
    expect((newDraft as HTMLTextAreaElement).value).toBe('');
    expect(first.counters).toEqual(countersA);
    expect(second.counters).toEqual(countersB);
  } finally {
    applicationA.dispose();
    applicationB.dispose();
  }
});
