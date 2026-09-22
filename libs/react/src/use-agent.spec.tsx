import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
} from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useAgent } from './index';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Only this integration spec composes the private runtime; production imports core only.
import {
  bindingFixture,
  changed,
  delta,
  finalText,
  weatherCall,
} from '../../langgraph/src/runtime/testing/binding-fixture';

const fixtures: ReturnType<typeof bindingFixture>[] = [];
function fixture() {
  const value = bindingFixture();
  fixtures.push(value);
  return value;
}
afterEach(async () => {
  cleanup();
  await Promise.all(fixtures.splice(0).map((value) => value.cleanup()));
});

describe('useAgent borrowed session', () => {
  it('observes explicit history loads without owning reads, refreshes, or teardown', async () => {
    const f = fixture();
    let renders = 0;
    function History() {
      const snapshot = useAgent(f.session);
      renders++;
      return <output>{snapshot.messages.map((message) => message.content).join('\n')}</output>;
    }
    const view = render(<History />, { reactStrictMode: true });
    expect(f.session.load).toBeTypeOf('function');
    expect(f.history.reads).toBe(0);
    await act(async () => { await f.session.load(); });
    expect(view.getByRole('status').textContent).toBe('Saved question\nSaved answer');
    const snapshot = f.session.getSnapshot();
    const beforeRefresh = renders;
    await act(async () => { await f.session.load(); });
    expect(f.session.getSnapshot()).toBe(snapshot);
    expect(renders).toBe(beforeRefresh);
    expect(f.history.reads).toBe(2);
    view.unmount();
    const reattached = render(<History />, { reactStrictMode: true });
    expect(reattached.getByRole('status').textContent).toBe('Saved question\nSaved answer');
    expect(f.history.reads).toBe(2);
    reattached.unmount();
    f.history.value = [];
    await f.session.load();
    expect(f.session.getSnapshot().messages).toEqual([]);
    expect(f.history.reads).toBe(3);
    expect(f.handlerCalls).toBe(0);
    expect(f.streams).toHaveLength(0);
    expect(f.session.submitCalls + f.session.stopCalls + f.session.disposeCalls).toBe(0);
  });

  it('renders streamed text, tool results, errors and stop outcomes through native controls', async () => {
    const f = fixture();
    let run: ReturnType<typeof f.session.submit> | undefined;
    function Chat() {
      const snapshot = useAgent(f.session);
      return (
        <>
          <button
            onClick={() => {
              run = f.session.submit('Hello');
            }}
          >
            Send
          </button>
          <button
            onClick={() => {
              void f.session.stop();
            }}
          >
            Stop
          </button>
          <output data-testid="status">{snapshot.status}</output>
          <div data-testid="messages">
            {snapshot.messages.map((message) => message.content).join('\n')}
          </div>
          <div data-testid="delivery">
            {JSON.stringify(snapshot.messages.at(-1)?.delivery)}
          </div>
          <div data-testid="tools">{JSON.stringify(snapshot.toolCalls)}</div>
          <div role="alert">{snapshot.error?.message}</div>
        </>
      );
    }
    const view = render(<Chat />, { reactStrictMode: true });
    expect(view.getByTestId('status').textContent).toBe('idle');
    expect(f.streams).toHaveLength(0);
    await act(async () => {
      fireEvent.click(view.getByText('Send'));
      await f.started();
    });
    expect(view.getByTestId('status').textContent).toBe('running');
    await act(async () => {
      const observed = changed(
        f.session,
        (s) => s.messages.at(-1)?.content === 'Visible partial'
      );
      f.streams[0].release(delta('Visible partial'));
      await observed;
    });
    expect(view.getByTestId('messages').textContent).toContain(
      'Visible partial'
    );
    expect(view.getByTestId('delivery').textContent).toContain('streaming');
    await act(async () => {
      f.streams[0].release(finalText('Visible final'));
      f.streams[0].finish();
      expect(await run).toBe('success');
    });
    expect(view.getByTestId('messages').textContent).toContain('Visible final');
    expect(view.getByTestId('status').textContent).toBe('idle');
    expect(view.getByTestId('delivery').textContent).toContain('success');

    await act(async () => {
      fireEvent.click(view.getByText('Send'));
      await f.started(1);
      f.streams[1].release(weatherCall);
      f.streams[1].finish();
      await f.entered;
    });
    expect(view.getByTestId('tools').textContent).toContain('running');
    await act(async () => {
      f.toolResult.resolve({ temperature: 24 });
      await f.started(2);
      f.streams[2].release(finalText('24 degrees'));
      f.streams[2].finish();
      expect(await run).toBe('success');
    });
    expect(view.getByTestId('tools').textContent).toContain('"temperature":24');
    expect(view.getByTestId('messages').textContent).toContain('24 degrees');

    await act(async () => {
      fireEvent.click(view.getByText('Send'));
      await f.started(3);
      f.streams[3].release({ type: 'error', data: { message: 'Unavailable' } });
      expect(await run).toBe('error');
    });
    expect(view.getByTestId('status').textContent).toBe('error');
    expect(view.getByRole('alert').textContent).toBeTruthy();
    await act(async () => {
      fireEvent.click(view.getByText('Send'));
      await f.started(4);
      const observed = changed(
        f.session,
        (s) => s.messages.at(-1)?.delivery.phase === 'streaming'
      );
      f.streams[4].release(delta('Stopping', 'stopped-answer'));
      await observed;
    });
    await act(async () => {
      fireEvent.click(view.getByText('Stop'));
      expect(await run).toBe('aborted');
    });
    expect(view.getByTestId('status').textContent).toBe('idle');
    expect(view.getByTestId('delivery').textContent).toContain('aborted');
    expect(f.handlerCalls).toBe(1);
    expect(f.session.submitCalls).toBe(4);
    expect(f.streams).toHaveLength(5);
    expect(f.session.stopCalls).toBe(1);
    view.unmount();
    expect(f.session.disposeCalls).toBe(0);
    expect(f.session.subscriptions).toBe(f.session.releases);
  });

  it('reads inertly through a receiver-dependent session and survives StrictMode setup-cleanup-setup', () => {
    const f = fixture();
    const view = renderHook(() => useAgent(f.session), {
      reactStrictMode: true,
    });
    expect(view.result.current).toBe(f.session.getSnapshot());
    expect(f.session.subscriptions).toBe(2);
    expect(f.session.releases).toBe(1);
    view.rerender();
    expect(f.session.subscriptions).toBe(2);
    view.unmount();
    expect(f.session.releases).toBe(2);
    expect(f.session.submitCalls).toBe(0);
    expect(f.session.stopCalls).toBe(0);
    expect(f.session.disposeCalls).toBe(0);
    expect(f.streams).toHaveLength(0);
  });

  it('shares intermediate and final snapshots between two simultaneous observers', async () => {
    const f = fixture();
    const first = renderHook(() => useAgent(f.session));
    const second = renderHook(() => useAgent(f.session));
    let run!: ReturnType<typeof f.session.submit>;
    await act(async () => {
      run = f.session.submit('Hello');
      await f.started();
    });
    expect(first.result.current.status).toBe('running');
    await act(async () => {
      const observed = changed(
        f.session,
        (s) => s.messages.at(-1)?.content === 'Hel'
      );
      f.streams[0].release(delta('Hel'));
      await observed;
    });
    expect(first.result.current.messages.at(-1)?.content).toBe('Hel');
    expect(first.result.current).toBe(second.result.current);
    first.unmount();
    await act(async () => {
      f.streams[0].release(finalText('Hello world'));
      f.streams[0].finish();
      expect(await run).toBe('success');
    });
    expect(second.result.current).toBe(f.session.getSnapshot());
    expect(second.result.current.status).toBe('idle');
    expect(second.result.current.messages.at(-1)).toMatchObject({
      content: 'Hello world',
      delivery: { phase: 'complete', outcome: 'success' },
    });
    expect(f.session.submitCalls).toBe(1);
    expect(f.streams).toHaveLength(1);
    expect(f.session.stopCalls + f.session.disposeCalls).toBe(0);
  });

  it('keeps a pending tool alive after unmount and reattaches without executing it again', async () => {
    const f = fixture();
    const first = renderHook(() => useAgent(f.session));
    let run!: ReturnType<typeof f.session.submit>;
    await act(async () => {
      run = f.session.submit('Weather');
      await f.started();
      f.streams[0].release(weatherCall);
      f.streams[0].finish();
      await f.entered;
    });
    expect(first.result.current.toolCalls[0]).toMatchObject({
      name: 'weather',
      status: 'running',
    });
    first.unmount();
    expect(f.handlerSignal?.aborted).toBe(false);
    const second = renderHook(() => useAgent(f.session));
    expect(second.result.current.toolCalls[0].status).toBe('running');
    await act(async () => {
      f.toolResult.resolve({ temperature: 24 });
      await f.started(1);
      f.streams[1].release(finalText('24 degrees'));
      f.streams[1].finish();
      expect(await run).toBe('success');
    });
    expect(second.result.current.toolCalls[0]).toMatchObject({
      name: 'weather',
      args: { city: 'Paris' },
      status: 'complete',
      result: { temperature: 24 },
    });
    expect(second.result.current.messages.at(-1)?.content).toBe('24 degrees');
    expect(f.handlerCalls).toBe(1);
    expect(f.session.submitCalls).toBe(1);
    expect(f.streams).toHaveLength(2);
    expect(f.session.stopCalls + f.session.disposeCalls).toBe(0);
  });

  it('publishes runtime errors and a later app-owned stop', async () => {
    const f = fixture();
    const view = renderHook(() => useAgent(f.session));
    await act(async () => {
      const run = f.session.submit('Fail');
      await f.started();
      const partial = changed(
        f.session,
        (s) => s.messages.at(-1)?.delivery.phase === 'streaming'
      );
      f.streams[0].release(delta('Partial'));
      await partial;
      f.streams[0].release({ type: 'error', data: { message: 'Unavailable' } });
      expect(await run).toBe('error');
    });
    expect(view.result.current.status).toBe('error');
    expect(view.result.current.error).toBeDefined();
    expect(view.result.current.messages.at(-1)?.delivery).toMatchObject({
      phase: 'complete',
      outcome: 'error',
    });
    await act(async () => {
      const run = f.session.submit('Stop');
      await f.started(1);
      const partial = changed(
        f.session,
        (s) => s.messages.at(-1)?.delivery.phase === 'streaming'
      );
      f.streams[1].release(delta('Stopping', 'stopped-answer'));
      await partial;
      await f.session.stop();
      expect(await run).toBe('aborted');
    });
    expect(view.result.current.status).toBe('idle');
    expect(view.result.current.messages.at(-1)?.delivery).toMatchObject({
      phase: 'complete',
      outcome: 'aborted',
    });
    expect(f.session.submitCalls).toBe(2);
    expect(f.session.stopCalls).toBe(1);
    expect(f.session.disposeCalls).toBe(0);
  });

  it('transfers its subscription when the supplied session changes', async () => {
    const a = fixture();
    const b = fixture();
    const view = renderHook(({ session }) => useAgent(session), {
      initialProps: { session: a.session },
    });
    view.rerender({ session: b.session });
    expect(a.session.releases).toBe(1);
    expect(b.session.subscriptions).toBe(1);
    expect(view.result.current).toBe(b.session.getSnapshot());
    await act(async () => {
      const run = a.session.submit('Detached');
      await a.started();
      a.streams[0].release(finalText('Still alive'));
      a.streams[0].finish();
      expect(await run).toBe('success');
    });
    expect(view.result.current).toBe(b.session.getSnapshot());
    expect(a.session.stopCalls + a.session.disposeCalls).toBe(0);
    view.unmount();
    expect(b.session.releases).toBe(1);
  });
});
