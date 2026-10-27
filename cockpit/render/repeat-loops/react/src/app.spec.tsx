import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RepeatDemo } from './app';
import { createPlayback } from './playback';
import { REPEAT_SAMPLES } from './specs';
import { createRenderState } from '@threadplane/content/render-state';
import { StrictMode } from 'react';
import { createItems, createItemCommands, type ItemsObserver } from './items';

afterEach(cleanup);
function fixture() {
  const callbacks: FrameRequestCallback[] = [];
  const playback = createPlayback(REPEAT_SAMPLES, {
    request: (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    },
    cancel: () => undefined,
  });
  const ready = vi.fn();
  const owner = createRenderState(createItems());
  const renderState: ItemsObserver = {
    getSnapshot: owner.getSnapshot as ItemsObserver['getSnapshot'],
    subscribe: owner.subscribe,
  };
  render(
    <RepeatDemo
      playback={playback}
      samples={REPEAT_SAMPLES.map((sample) => sample.label)}
      onReady={ready}
      renderState={renderState}
      commands={createItemCommands(owner)}
    />
  );
  return { playback, ready, callbacks };
}
const click = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name }));
const output = () => screen.getByRole('region', { name: 'Render output' });
const rows = () => [...output().querySelectorAll('[data-repeat-row]')];
const ids = () => rows().map((row) => row.getAttribute('data-repeat-row'));
const source = () =>
  screen.getByRole('region', { name: 'Streaming JSON' }).querySelector('pre')
    ?.textContent;
const choose = (index: number) =>
  fireEvent.change(screen.getByRole('combobox', { name: 'Sample' }), {
    target: { value: String(index) },
  });

it('borrows the supplied current owner and follows external reorder with keyed rows', () => {
  const owner = createRenderState({
    items: [
      { id: 'custom', label: 'Custom' },
      { id: 'other', label: 'Other' },
    ],
    nextId: 8,
  });
  const subscribe = vi.fn(owner.subscribe);
  const playback = createPlayback(REPEAT_SAMPLES);
  const view = render(
    <RepeatDemo
      playback={playback}
      samples={['Items']}
      onReady={() => undefined}
      renderState={{
        getSnapshot: owner.getSnapshot as ItemsObserver['getSnapshot'],
        subscribe,
      }}
      commands={{ add: vi.fn(), remove: vi.fn(), reverse: vi.fn() }}
    />
  );
  click('Finish');
  expect(ids()).toEqual(['custom', 'other']);
  expect(subscribe).toHaveBeenCalledTimes(1);
  const original = rows();
  act(() =>
    owner.set('/items', [
      { id: 'other', label: 'Other' },
      { id: 'custom', label: 'Custom' },
    ])
  );
  expect(ids()).toEqual(['other', 'custom']);
  expect(rows()[0]).toBe(original[1]);
  expect(rows()[1]).toBe(original[0]);
  view.unmount();
  playback.dispose();
  owner.dispose();
});

it('replaces the borrowed observer and uses the latest supplied command callbacks', () => {
  const first = createRenderState(createItems());
  const second = createRenderState({ items: [], nextId: 20 });
  const playback = createPlayback(REPEAT_SAMPLES);
  const observe = (owner: typeof first) => {
    const counts = { starts: 0, stops: 0, active: 0 };
    const observer: ItemsObserver = {
      getSnapshot: owner.getSnapshot as ItemsObserver['getSnapshot'],
      subscribe: (notify) => {
        counts.starts++;
        counts.active++;
        const release = owner.subscribe(notify);
        return () => {
          counts.stops++;
          counts.active--;
          release();
        };
      },
    };
    return { observer, counts };
  };
  const firstBorrow = observe(first),
    secondBorrow = observe(second);
  const lifecycleSpies = [first, second].flatMap((owner) => [
    vi.spyOn(owner, 'set'),
    vi.spyOn(owner, 'update'),
    vi.spyOn(owner, 'dispose'),
  ]);
  const oldCommands = { add: vi.fn(), remove: vi.fn(), reverse: vi.fn() };
  const commands = {
    add: vi.fn(createItemCommands(second).add),
    remove: vi.fn(createItemCommands(second).remove),
    reverse: vi.fn(createItemCommands(second).reverse),
  };
  const props = { playback, samples: ['Items'], onReady: vi.fn() };
  const ready = vi.fn();
  const view = render(
    <RepeatDemo
      {...props}
      renderState={firstBorrow.observer}
      commands={oldCommands}
    />
  );
  click('Finish');
  expect(firstBorrow.counts.active).toBe(1);
  expect(secondBorrow.counts.active).toBe(0);
  for (const spy of lifecycleSpies) expect(spy).not.toHaveBeenCalled();
  view.rerender(
    <RepeatDemo
      {...props}
      onReady={ready}
      renderState={secondBorrow.observer}
      commands={commands}
    />
  );
  expect(firstBorrow.counts.active).toBe(0);
  expect(firstBorrow.counts.stops).toBe(firstBorrow.counts.starts);
  expect(secondBorrow.counts.active).toBe(1);
  for (const spy of lifecycleSpies) expect(spy).not.toHaveBeenCalled();
  expect(ids()).toEqual([]);
  expect(
    (screen.getByRole('button', { name: 'Reverse items' }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  act(() => first.set('/items', []));
  expect(ids()).toEqual([]);
  expect(lifecycleSpies[0]).toHaveBeenCalledExactlyOnceWith('/items', []);
  for (const spy of lifecycleSpies.slice(1)) expect(spy).not.toHaveBeenCalled();
  for (const spy of lifecycleSpies) spy.mockClear();
  click('Add Item');
  click('Add Item');
  click('Reverse items');
  click('Remove Item 20');
  expect(ids()).toEqual(['item-21']);
  expect(commands.add).toHaveBeenCalledTimes(2);
  expect(commands.reverse).toHaveBeenCalledTimes(1);
  expect(commands.remove).toHaveBeenCalledExactlyOnceWith('item-20');
  expect(oldCommands.add).not.toHaveBeenCalled();
  expect(oldCommands.remove).not.toHaveBeenCalled();
  expect(oldCommands.reverse).not.toHaveBeenCalled();
  expect(ready).toHaveBeenCalledTimes(1);
  expect(lifecycleSpies[3]).toHaveBeenCalledTimes(2);
  expect(lifecycleSpies[4]).toHaveBeenCalledTimes(2);
  for (const index of [0, 1, 2, 5])
    expect(lifecycleSpies[index]).not.toHaveBeenCalled();
  for (const spy of lifecycleSpies) spy.mockClear();
  view.unmount();
  expect(firstBorrow.counts.active).toBe(0);
  expect(firstBorrow.counts.stops).toBe(firstBorrow.counts.starts);
  expect(secondBorrow.counts.active).toBe(0);
  expect(secondBorrow.counts.stops).toBe(secondBorrow.counts.starts);
  for (const spy of lifecycleSpies) expect(spy).not.toHaveBeenCalled();
  first.dispose();
  second.dispose();
  playback.dispose();
});

it('replays and releases StrictMode subscriptions without writes or owner disposal and remounts current data', () => {
  const owner = createRenderState(createItems());
  const set = vi.spyOn(owner, 'set'),
    update = vi.spyOn(owner, 'update'),
    dispose = vi.spyOn(owner, 'dispose');
  let active = 0,
    starts = 0,
    stops = 0;
  const renderState: ItemsObserver = {
    getSnapshot: owner.getSnapshot as ItemsObserver['getSnapshot'],
    subscribe: (notify) => {
      starts++;
      active++;
      const release = owner.subscribe(notify);
      return () => {
        stops++;
        active--;
        release();
      };
    },
  };
  const playback = createPlayback(REPEAT_SAMPLES);
  const props = {
    playback,
    samples: ['Items'],
    onReady: vi.fn(),
    renderState,
    commands: createItemCommands(owner),
  };
  const view = render(
    <StrictMode>
      <RepeatDemo {...props} />
    </StrictMode>
  );
  expect(starts).toBe(2);
  expect(stops).toBe(1);
  expect(active).toBe(1);
  view.unmount();
  expect(active).toBe(0);
  expect(stops).toBe(starts);
  expect(set).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(dispose).not.toHaveBeenCalled();
  owner.update({
    '/items': [{ id: 'offline', label: 'Offline' }],
    '/nextId': 42,
  });
  const current = owner.getSnapshot();
  set.mockClear();
  update.mockClear();
  const remount = render(
    <StrictMode>
      <RepeatDemo {...props} />
    </StrictMode>
  );
  click('Finish');
  expect(ids()).toEqual(['offline']);
  expect(owner.getSnapshot()).toBe(current);
  remount.unmount();
  expect(active).toBe(0);
  expect(stops).toBe(starts);
  expect(set).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(dispose).not.toHaveBeenCalled();
  owner.dispose();
  playback.dispose();
});

it('renders one native container with keyed children and preserves the exact DOM nodes on reorder', () => {
  const { ready, playback } = fixture();
  expect(ready).toHaveBeenCalledTimes(1);
  expect(playback.getSnapshot().position).toBe(0);
  click('Finish');
  expect(output().querySelectorAll('article')).toHaveLength(1);
  expect(ids()).toEqual(['alpha', 'beta', 'gamma']);
  expect(rows().map((row) => row.textContent)).toEqual([
    '1. Alpha',
    '2. Beta',
    '3. Gamma',
  ]);
  const original = rows(),
    json = source(),
    position = playback.getSnapshot().position;
  click('Reverse items');
  expect(ids()).toEqual(['gamma', 'beta', 'alpha']);
  expect(rows()[0]).toBe(original[2]);
  expect(rows()[2]).toBe(original[0]);
  expect(rows().map((row) => row.textContent)).toEqual([
    '1. Gamma',
    '2. Beta',
    '3. Alpha',
  ]);
  expect(source()).toBe(json);
  expect(playback.getSnapshot().position).toBe(position);
});

it('removes only the chosen item and never reuses an added identity', () => {
  fixture();
  click('Finish');
  click('Remove Beta');
  click('Add Item');
  expect(ids()).toEqual(['alpha', 'gamma', 'item-1']);
  click('Remove Item 1');
  click('Add Item');
  expect(ids()).toEqual(['alpha', 'gamma', 'item-2']);
});

it('keeps host edits through playback, stale frames, reset and all literal sample selections', () => {
  const { playback, callbacks } = fixture();
  click('Add Item');
  click('Play');
  const stale = callbacks.at(-1)!;
  click('Reverse items');
  click('Pause');
  const position = playback.getSnapshot().position;
  act(() => stale(0));
  expect(playback.getSnapshot().position).toBe(position);
  click('Finish');
  expect(ids()).toEqual(['item-1', 'gamma', 'beta', 'alpha']);
  act(() => playback.seek(0));
  click('Finish');
  expect(ids()[0]).toBe('item-1');
  click('Reset');
  click('Finish');
  expect(ids()[0]).toBe('item-1');
  choose(1);
  click('Finish');
  expect(output().textContent).toContain('Review pull request');
  expect(rows()).toHaveLength(0);
  choose(2);
  click('Finish');
  expect(output().textContent).toContain('Frontend Tasks');
  expect(output().textContent).toContain('Backend Tasks');
  choose(0);
  click('Finish');
  expect(ids()).toEqual(['item-1', 'gamma', 'beta', 'alpha']);
});

it('bounds the host list at 32 and recovers after removing every item', () => {
  fixture();
  click('Finish');
  for (let i = 0; i < 29; i++) click('Add Item');
  expect(rows()).toHaveLength(32);
  expect(
    (screen.getByRole('button', { name: 'Add Item' }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  for (const button of screen.getAllByRole('button', { name: /^Remove / }))
    fireEvent.click(button);
  expect(rows()).toHaveLength(0);
  expect(
    (screen.getByRole('button', { name: 'Reverse items' }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  click('Add Item');
  expect(ids()).toEqual(['item-30']);
});

it('mounts every actual streaming prefix through the native renderer without publishing false indexes', () => {
  const { playback } = fixture();
  for (let sample = 0; sample < REPEAT_SAMPLES.length; sample++) {
    choose(sample);
    for (
      let position = 0;
      position <= REPEAT_SAMPLES[sample].json.length;
      position++
    )
      act(() => playback.seek(position));
    expect(playback.getSnapshot().phase).toBe('complete');
  }
  expect(output().querySelector('script')).toBeNull();
});
