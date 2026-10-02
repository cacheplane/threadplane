import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { SubgraphsSnapshot } from './application';
import { SubgraphsDemo } from './app';
const factory = vi.hoisted(() => vi.fn());
vi.mock('./connection', () => ({ createConnectedApplication: factory }));
afterEach(cleanup);
function setup(update: Partial<SubgraphsSnapshot> = {}) {
  const state: SubgraphsSnapshot = {
    threadId: null,
    rows: [],
    route: 'awaiting',
    topic: null,
    brief: null,
    children: [],
    busy: false,
    canSubmit: true,
    activity: 'idle',
    outcome: null,
    error: null,
    viewGeneration: 0,
    ...update,
  };
  const application = {
    getSnapshot: () => state,
    subscribe: () => () => undefined,
    submit: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    newConversation: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
  factory.mockReturnValue(application);
  const onReady = vi.fn(),
    view = render(
      <SubgraphsDemo
        connection={{ apiUrl: 'https://example.test', headers: {} }}
        onReady={onReady}
      />
    );
  return { state, application, view, onReady };
}
it('starts without executing or fabricating a direct route and uses native chat', () => {
  const h = setup();
  expect(
    h.view.getByRole('heading', { name: 'LangGraph subgraphs' })
  ).toBeTruthy();
  expect(
    h.view.getByRole('region', { name: 'Research boundary' }).textContent
  ).toContain('Awaiting the current route.');
  expect(h.view.container.querySelector('.tp-chat-list')).toBeTruthy();
  expect(h.view.getByRole('status').textContent).toBe('Ready.');
  expect(h.application.submit).not.toHaveBeenCalled();
  expect(h.onReady).toHaveBeenCalledTimes(1);
});
it('renders confirmed boundary and full namespace segments as literal readonly observations', () => {
  const h = setup({
    route: 'nested',
    topic: '<img src=x onerror=alert(1)>',
    brief: '<script>child brief</script>',
    children: [
      { namespace: ['research:outer|literal', '<b>research:inner</b>'] },
    ],
  });
  const panel = h.view.getByRole('region', { name: 'Research boundary' });
  expect(panel.textContent).toContain('Nested — research boundary confirmed.');
  expect(panel.textContent).toContain('<img src=x onerror=alert(1)>');
  expect(panel.textContent).toContain('<script>child brief</script>');
  const children = h.view.getByRole('region', { name: 'Child observations' });
  expect(children.textContent).toContain('research:outer|literal');
  expect(children.textContent).toContain('<b>research:inner</b>');
  expect(children.textContent).toContain('Observed child stream');
  expect(children.querySelector('button')).toBeNull();
  expect(children.textContent).not.toContain('complete');
  expect(children.textContent).not.toContain('running');
  expect(h.view.container.querySelector('img, script, b')).toBeNull();
});
it('a direct turn has empty boundary and no child lifecycle claim', () => {
  const h = setup({
    route: 'direct',
    topic: '',
    brief: '',
    outcome: 'success',
  });
  expect(
    h.view.getByRole('region', { name: 'Research boundary' }).textContent
  ).toContain('Direct — no child observed for this turn.');
  expect(
    h.view.getByRole('region', { name: 'Child observations' }).textContent
  ).toContain('No child stream observed for this turn.');
  expect(h.view.getByRole('status').textContent).toBe('Response complete.');
});
it('shows observed streams during a held turn without claiming the route is final', () => {
  const h = setup({
    busy: true,
    activity: 'running',
    canSubmit: false,
    children: [{ namespace: ['research:held'] }],
  });
  expect(
    h.view.getByRole('region', { name: 'Research boundary' }).textContent
  ).toContain('Awaiting the current route.');
  expect(
    h.view.getByRole('region', { name: 'Child observations' }).textContent
  ).toContain('research:held');
  expect(
    (
      h.view.getByRole('button', {
        name: 'New conversation',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  fireEvent.click(h.view.getByRole('button', { name: 'Stop', exact: true }));
  expect(h.application.stop).toHaveBeenCalledTimes(1);
});
it('unconfirmed and unsafe outcomes block text and offer New without child commands', () => {
  const h = setup({
    route: 'unconfirmed',
    canSubmit: false,
    error: 'The current route could not be confirmed.',
  });
  expect(h.view.getByRole('alert').textContent).toBe(
    'The current route could not be confirmed.'
  );
  expect(
    (
      h.view.getByRole('textbox', {
        name: 'Message',
        exact: true,
      }) as HTMLTextAreaElement
    ).disabled
  ).toBe(true);
  expect(
    h.view.queryByRole('button', { name: /retry|resume|check status/i })
  ).toBeNull();
  fireEvent.click(h.view.getByRole('button', { name: 'New conversation' }));
  expect(h.application.newConversation).toHaveBeenCalledTimes(1);
});
it('unmount detaches the owner during child observation', () => {
  const h = setup({ busy: true, activity: 'running', canSubmit: false });
  h.view.unmount();
  expect(h.application.dispose).toHaveBeenCalledTimes(1);
});
it('the native composer admits the original text once', () => {
  const h = setup();
  fireEvent.change(
    h.view.getByRole('textbox', { name: 'Message', exact: true }),
    { target: { value: 'A fictional question' } }
  );
  fireEvent.click(h.view.getByRole('button', { name: 'Send', exact: true }));
  expect(h.application.submit).toHaveBeenCalledWith('A fictional question');
});
