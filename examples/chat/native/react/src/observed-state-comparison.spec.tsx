import { StrictMode, useLayoutEffect } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { StateDiffProps } from '@threadplane/react/debug';
import { App } from './app';
import { applicationFixture } from './application-fixture';
import {
  createReactApplication,
  type ReactApplication,
  type ReactApplicationSnapshot,
} from './application';
import { ObservedStateComparison } from './observed-state-comparison';

type Values = NonNullable<ReactApplicationSnapshot['runtime']>['values'];
let supplied: StateDiffProps;
vi.mock('@threadplane/react/debug', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('@threadplane/react/debug')
  >();
  return {
    ...original,
    StateDiff: (props: StateDiffProps) => {
      supplied = props;
      return <original.StateDiff {...props} />;
    },
  };
});
afterEach(cleanup);
function owner(initial: Values = { count: 1 }) {
  let values = initial;
  let id = 'a';
  let status = 'ready';
  const getSnapshot = vi.fn(() => ({
    selection: { status, id },
    runtime: { values },
  }));
  return {
    application: { getSnapshot } as unknown as ReactApplication,
    getSnapshot,
    values: (next: Values) => {
      values = next;
    },
    id: (next: string) => {
      id = next;
    },
    status: (next: string) => {
      status = next;
    },
  };
}
const captureName = 'Capture current state baseline';
const clearName = 'Clear baseline';
const label = 'Observed baseline to current state';
// Retain the actual committed React callback to exercise retired controls even
// after React has replaced or detached their host node.
function callback(button: HTMLElement): () => void {
  const key = Object.keys(button).find((key) =>
    key.startsWith('__reactProps$')
  )!;
  return (button as unknown as Record<string, { onClick: () => void }>)[key]
    .onClick;
}
function controls(view: ReturnType<typeof render>) {
  return {
    capture: view.getByRole('button', { name: captureName, hidden: true }),
    clear: view.getByRole('button', { name: clearName, hidden: true }),
  };
}
it('starts collapsed, borrows observed values, compares updates and clears locally', () => {
  const before = Object.freeze({ count: 1 });
  const f = owner(before);
  const content = (values: Values) => (
    <ObservedStateComparison
      application={f.application}
      threadId="a"
      values={values}
    />
  );
  const view = render(content(before));
  expect(
    view.getByText('Observed state comparison').closest('details')?.open
  ).toBe(false);
  expect((controls(view).clear as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(controls(view).capture);
  expect(view.getByText('No changes in the supplied states.')).toBeTruthy();
  const after = Object.freeze({
    count: 2,
    literal: '<script>literal</script>',
  });
  f.values(after);
  view.rerender(content(after));
  expect(supplied.before).toBe(before);
  expect(supplied.after).toBe(after);
  const changes = view.getByLabelText(`${label} JSON`);
  expect(JSON.parse(changes.textContent!)).toEqual([
    { path: '/count', kind: 'changed', before: 1, after: 2 },
    { path: '/literal', kind: 'added', after: '<script>literal</script>' },
  ]);
  expect(view.container.querySelector('script')).toBeNull();
  fireEvent.click(controls(view).clear);
  expect(view.queryByRole('region', { name: label, hidden: true })).toBeNull();
});
it.each([
  ['object field', { field: undefined }],
  ['nested array entry', { field: [undefined] }],
] as const)(
  'keeps undefined %s observations intact and lets the passive diff reject them',
  (_name, invalid) => {
    const f = owner(invalid);
    const content = (values: Values) => (
      <ObservedStateComparison
        application={f.application}
        threadId="a"
        values={values}
      />
    );
    const view = render(content(invalid));
    fireEvent.click(controls(view).capture);
    expect(supplied.before).toBe(invalid);
    expect(supplied.after).toBe(invalid);
    expect(
      view.getByText(
        'Comparison unavailable: supplied states contain invalid plain data.'
      )
    ).toBeTruthy();
    expect(view.queryByText('No changes in the supplied states.')).toBeNull();
    expect(view.queryByLabelText(`${label} JSON`)).toBeNull();
    const healthy = { field: ['ready'] };
    f.values(healthy);
    view.rerender(content(healthy));
    expect(supplied.before).toBe(invalid);
    expect(supplied.after).toBe(healthy);
    expect(
      view.getByText(
        'Comparison unavailable: supplied states contain invalid plain data.'
      )
    ).toBeTruthy();
    fireEvent.click(controls(view).clear);
    expect(
      view.queryByRole('region', { name: label, hidden: true })
    ).toBeNull();
    fireEvent.click(controls(view).capture);
    expect(supplied.before).toBe(healthy);
    expect(view.getByText('No changes in the supplied states.')).toBeTruthy();
  }
);
it('does not fabricate unknown current values and preserves a baseline while unknown', () => {
  const initial = { count: 1 };
  const f = owner(initial);
  const content = (values: Values) => (
    <ObservedStateComparison
      application={f.application}
      threadId="a"
      values={values}
    />
  );
  const view = render(content(initial));
  fireEvent.click(controls(view).capture);
  f.values(undefined);
  view.rerender(content(undefined));
  expect((controls(view).capture as HTMLButtonElement).disabled).toBe(true);
  expect(view.getByText('Current observed state is unavailable.')).toBeTruthy();
  expect(view.queryByRole('region', { name: label, hidden: true })).toBeNull();
  const next = { count: 3 };
  f.values(next);
  view.rerender(content(next));
  expect(
    JSON.parse(view.getByLabelText(`${label} JSON`).textContent!)[0]
  ).toMatchObject({ before: 1, after: 3 });
  f.values(undefined);
  view.rerender(content(undefined));
  fireEvent.click(controls(view).clear);
  f.values(initial);
  view.rerender(content(initial));
  expect(view.queryByRole('region', { name: label, hidden: true })).toBeNull();
});
it('rejects live values, selection and readiness changes before render', () => {
  const values = { count: 1 };
  const f = owner(values);
  const view = render(
    <ObservedStateComparison
      application={f.application}
      threadId="a"
      values={values}
    />
  );
  const capture = callback(controls(view).capture);
  f.values({ count: 2 });
  act(capture);
  expect(view.queryByText('No changes in the supplied states.')).toBeNull();
  f.values(values);
  f.id('b');
  act(capture);
  expect(view.queryByText('No changes in the supplied states.')).toBeNull();
  f.id('a');
  f.status('pending');
  act(capture);
  expect(view.queryByText('No changes in the supplied states.')).toBeNull();
  f.status('ready');
  act(capture);
  const clear = callback(controls(view).clear);
  f.id('b');
  act(clear);
  expect(view.getByText('No changes in the supplied states.')).toBeTruthy();
});
it('retires owner and thread generations across A-B-A and unmount', () => {
  const values = { count: 1 };
  const f = owner(values);
  const g = owner(values);
  const content = (application: ReactApplication, threadId = 'a') => (
    <ObservedStateComparison
      application={application}
      threadId={threadId}
      values={values}
    />
  );
  const view = render(content(f.application));
  const staleCapture = callback(controls(view).capture);
  act(staleCapture);
  const staleClear = callback(controls(view).clear);
  view.rerender(content(g.application));
  expect(view.queryByText('No changes in the supplied states.')).toBeNull();
  view.rerender(content(f.application));
  act(staleCapture);
  expect(view.queryByText('No changes in the supplied states.')).toBeNull();
  fireEvent.click(controls(view).capture);
  act(staleClear);
  expect(view.getByText('No changes in the supplied states.')).toBeTruthy();
  f.id('b');
  view.rerender(content(f.application, 'b'));
  expect(view.queryByText('No changes in the supplied states.')).toBeNull();
  f.id('a');
  view.rerender(content(f.application));
  act(staleCapture);
  expect(view.queryByText('No changes in the supplied states.')).toBeNull();
  const retired = callback(controls(view).capture);
  view.unmount();
  f.getSnapshot.mockClear();
  act(retired);
  expect(f.getSnapshot).not.toHaveBeenCalled();
});
it('keeps a baseline accepted during layout across StrictMode replay', () => {
  const values = { count: 1 };
  const f = owner(values);
  let accepted = false;
  function CaptureOnce() {
    useLayoutEffect(() => {
      if (!accepted) {
        accepted = true;
        const button = Array.from(document.querySelectorAll('button')).find(
          (node) => node.textContent === captureName
        )!;
        button.click();
      }
    }, []);
    return null;
  }
  const view = render(
    <StrictMode>
      <ObservedStateComparison
        application={f.application}
        threadId="a"
        values={values}
      />
      <CaptureOnce />
    </StrictMode>
  );
  expect(view.getByText('No changes in the supplied states.')).toBeTruthy();
});
it('preserves real App runtime, transcript, draft node/value, URL and I/O', async () => {
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
    fireEvent.click(view.getByText('Observed state comparison'));
    fireEvent.click(controls(view).capture);
    // Compare the runtime's actual observed values without copying or sanitizing
    // fixture tool data. This fixture's current observation fits the bounds.
    expect(view.getByText('No changes in the supplied states.')).toBeTruthy();
    await act(async () => {
      application.refresh();
    });
    expect(
      view.getByRole('region', { name: label, hidden: true })
    ).toBeTruthy();
    fireEvent.click(controls(view).clear);
    expect(
      view.queryByRole('region', { name: label, hidden: true })
    ).toBeNull();
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
it('clears the baseline on ready App owner replacement while preserving same-thread DOM and draft', async () => {
  const a = applicationFixture();
  const b = applicationFixture();
  const applicationA = createReactApplication(a.options);
  const applicationB = createReactApplication(b.options);
  try {
    applicationA.start();
    applicationB.start();
    await waitFor(() => {
      expect(applicationA.getSnapshot().selection.status).toBe('ready');
      expect(applicationB.getSnapshot().selection.status).toBe('ready');
    });
    const view = render(<App application={applicationA} />);
    const draft = view.getByRole('textbox', { name: 'Message' });
    fireEvent.change(draft, { target: { value: 'Owner replacement draft' } });
    const transcript = view.getByRole('region', {
      name: 'Conversation messages',
    });
    fireEvent.click(controls(view).capture);
    expect(
      view.getByRole('region', { name: label, hidden: true })
    ).toBeTruthy();
    const countersA = { ...a.counters },
      countersB = { ...b.counters };
    view.rerender(<App application={applicationB} />);
    expect(
      view.queryByRole('region', { name: label, hidden: true })
    ).toBeNull();
    expect(view.getAllByText('Observed state comparison')).toHaveLength(1);
    expect(view.getByRole('textbox', { name: 'Message' })).toBe(draft);
    expect((draft as HTMLTextAreaElement).value).toBe(
      'Owner replacement draft'
    );
    expect(view.getByRole('region', { name: 'Conversation messages' })).toBe(
      transcript
    );
    expect(a.options.history.currentUrl()).toBe(
      'http://example.test/?thread=a'
    );
    expect(b.options.history.currentUrl()).toBe(
      'http://example.test/?thread=a'
    );
    expect(a.counters).toEqual(countersA);
    expect(b.counters).toEqual(countersB);
  } finally {
    applicationA.dispose();
    applicationB.dispose();
  }
});
