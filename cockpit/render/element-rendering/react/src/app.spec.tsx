import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { createRenderState } from '@threadplane/content/render-state';
import { ElementRenderingDemo } from './app';
import { createPlayback } from './playback';
import { ELEMENT_RENDERING_SAMPLES } from './specs';

const disposals: (() => void)[] = [];
afterEach(() => {
  cleanup();
  disposals.splice(0).forEach((dispose) => dispose());
});
function stateFixture(showDetail: unknown = true) {
  const owner = createRenderState({ showDetail });
  const set = vi.spyOn(owner, 'set');
  const update = vi.spyOn(owner, 'update');
  const dispose = vi.spyOn(owner, 'dispose');
  const notify = vi.fn();
  let active = 0;
  const observer = {
    getSnapshot: owner.getSnapshot,
    subscribe(listener: () => void) {
      active++;
      const unsubscribe = owner.subscribe(() => {
        notify();
        listener();
      });
      let live = true;
      return () => {
        if (live) active--;
        live = false;
        unsubscribe();
      };
    },
  };
  disposals.push(() => owner.dispose());
  return { owner, observer, set, update, dispose, notify, active: () => active };
}
function fixture(showDetail: unknown = true, strict = false) {
  const state = stateFixture(showDetail);
  const callbacks: FrameRequestCallback[] = [];
  const playback = createPlayback(ELEMENT_RENDERING_SAMPLES, {
    request: (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    },
    cancel: () => undefined,
  });
  const ready = vi.fn();
  const demo = (current = state) => (
    <ElementRenderingDemo
      playback={playback}
      renderState={current.observer}
      onShowDetailChange={(value) => current.owner.set('/showDetail', value)}
      samples={ELEMENT_RENDERING_SAMPLES.map((sample) => sample.label)}
      onReady={ready}
    />
  );
  const view = render(strict ? <StrictMode>{demo()}</StrictMode> : demo());
  disposals.push(() => playback.dispose());
  return { playback, callbacks, ready, state, view, demo };
}
const output = () => screen.getByRole('region', { name: 'Render output' });
const detail = () =>
  screen.getByRole('checkbox', { name: 'Show detail' }) as HTMLInputElement;
const source = () =>
  screen.getByRole('region', { name: 'Streaming JSON' }).querySelector('pre')
    ?.textContent;
const click = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name }));
const choose = (value: number) =>
  fireEvent.change(screen.getByRole('combobox', { name: 'Sample' }), {
    target: { value: String(value) },
  });

it('starts with caller-owned detail shown and an empty ready playback', () => {
  const { playback, ready } = fixture();
  expect(detail().checked).toBe(true);
  expect(ready).toHaveBeenCalledTimes(1);
  expect(playback.getSnapshot().position).toBe(0);
  expect(output().textContent).toContain('Play a sample');
  expect(source()).toBe('');
});

it('renders native ordered siblings and nested supplied children exactly once', () => {
  fixture();
  click('Finish');
  expect(
    [...output().querySelectorAll('p')].map((node) => node.textContent)
  ).toEqual([
    'First child text element rendered beneath the parent heading.',
    'Second child text element demonstrating sibling rendering.',
  ]);
  choose(1);
  click('Finish');
  const cards = output().querySelectorAll('article');
  expect(cards).toHaveLength(2);
  expect(cards[0].contains(cards[1])).toBe(true);
  expect(output().querySelectorAll('p')).toHaveLength(1);
  expect(output().textContent).toContain('Deeply nested text');
});

it('never flashes hidden conditional text at any actual prefix with detail disabled', () => {
  const { playback } = fixture();
  choose(2);
  fireEvent.click(detail());
  // Resolve stable regions once; inspect their live contents at every prefix.
  const outputRegion = output();
  const sourceRegion = screen.getByRole('region', { name: 'Streaming JSON' });
  const json = ELEMENT_RENDERING_SAMPLES[2].json;
  for (let position = 0; position <= json.length; position++) {
    act(() => playback.seek(position));
    expect(outputRegion.isConnected).toBe(true);
    expect(sourceRegion.isConnected).toBe(true);
    expect(
      outputRegion.querySelector('[data-element-key="conditional"]')
    ).toBeNull();
    expect(sourceRegion.querySelector('pre')?.textContent).toBe(
      json.slice(0, position)
    );
  }
  const before = playback.getSnapshot();
  fireEvent.click(detail());
  expect(
    output().querySelector('[data-element-key="conditional"]')?.textContent
  ).toContain('conditionally visible');
  expect(playback.getSnapshot()).toBe(before);
  fireEvent.click(detail());
  expect(output().querySelector('[data-element-key="conditional"]')).toBeNull();
});

it('shows a conditional node only after native visibility metadata is admitted', () => {
  const { playback } = fixture();
  choose(2);
  const outputRegion = output();
  for (
    let position = 0;
    position <= ELEMENT_RENDERING_SAMPLES[2].json.length;
    position++
  ) {
    act(() => playback.seek(position));
    const conditional = playback.getSnapshot().spec?.elements.conditional;
    expect(outputRegion.isConnected).toBe(true);
    expect(
      Boolean(outputRegion.querySelector('[data-element-key="conditional"]'))
    ).toBe(Boolean(conditional));
    if (conditional)
      expect(conditional.visible).toEqual({ $state: '/showDetail' });
  }
});

it('retains host state through pause, stale frames, rewind, reset and sample changes', () => {
  const { playback, callbacks } = fixture();
  choose(2);
  fireEvent.click(detail());
  click('Play');
  act(() => callbacks[0](0));
  click('Pause');
  const paused = playback.getSnapshot();
  act(() => callbacks[0](0));
  expect(playback.getSnapshot()).toBe(paused);
  click('Finish');
  click('Reset');
  expect(detail().checked).toBe(false);
  choose(0);
  click('Finish');
  choose(2);
  click('Finish');
  expect(detail().checked).toBe(false);
  expect(output().querySelector('[data-element-key="conditional"]')).toBeNull();
  expect(source()).toBe(ELEMENT_RENDERING_SAMPLES[2].json);
  act(() => playback.seek(0));
  expect(detail().checked).toBe(false);
});

it('preserves an externally supplied initial false without mount commands', () => {
  const { playback, state } = fixture(false);
  expect(detail().checked).toBe(false);
  expect(state.set).not.toHaveBeenCalled();
  expect(state.update).not.toHaveBeenCalled();
  expect(playback.getSnapshot().position).toBe(0);
});

it('observes external writes without changing playback or JSON', () => {
  const { playback, state } = fixture();
  choose(2);
  click('Finish');
  const before = playback.getSnapshot();
  const raw = source();
  act(() => state.owner.set('/showDetail', false));
  expect(detail().checked).toBe(false);
  expect(output().querySelector('[data-element-key="conditional"]')).toBeNull();
  act(() => state.owner.set('/showDetail', true));
  expect(detail().checked).toBe(true);
  expect(output().querySelector('[data-element-key="conditional"]')).not.toBeNull();
  act(() => state.owner.set('/showDetail', false));
  expect(detail().checked).toBe(false);
  expect(output().querySelector('[data-element-key="conditional"]')).toBeNull();
  expect(playback.getSnapshot()).toBe(before);
  expect(source()).toBe(raw);
  expect(Object.isFrozen(state.owner.getSnapshot())).toBe(true);
});

it('releases only observation and reads writes made while the view is absent on remount', () => {
  const { state, view, demo } = fixture(false);
  choose(2);
  click('Finish');
  expect(output().querySelector('[data-element-key="conditional"]')).toBeNull();
  expect(state.active()).toBeGreaterThan(0);
  view.unmount();
  expect(state.active()).toBe(0);
  expect(state.set).not.toHaveBeenCalled();
  expect(state.update).not.toHaveBeenCalled();
  expect(state.dispose).not.toHaveBeenCalled();
  act(() => state.owner.set('/showDetail', true));
  const snapshot = state.owner.getSnapshot();
  const remounted = render(demo());
  expect(detail().checked).toBe(true);
  expect(output().querySelector('[data-element-key="conditional"]')).not.toBeNull();
  expect(state.owner.getSnapshot()).toBe(snapshot);
  expect(state.set).toHaveBeenCalledTimes(1);
  remounted.unmount();
  expect(state.active()).toBe(0);
  expect(state.dispose).not.toHaveBeenCalled();
});

it('borrows the owner through StrictMode without commands, reset or terminal disposal', () => {
  const { state, view } = fixture(false, true);
  expect(detail().checked).toBe(false);
  expect(state.active()).toBeGreaterThan(0);
  expect(state.owner.getSnapshot()).toEqual({ showDetail: false });
  expect(state.set).not.toHaveBeenCalled();
  expect(state.update).not.toHaveBeenCalled();
  expect(state.dispose).not.toHaveBeenCalled();
  view.unmount();
  expect(state.active()).toBe(0);
  expect(state.set).not.toHaveBeenCalled();
  expect(state.update).not.toHaveBeenCalled();
  expect(state.dispose).not.toHaveBeenCalled();
  state.owner.set('/showDetail', true);
  expect(state.owner.getSnapshot().showDetail).toBe(true);
});

it('switches observers and explicit commands to the replacement owner', () => {
  const { state: old, view, demo } = fixture(true);
  const next = stateFixture(false);
  view.rerender(demo(next));
  expect(detail().checked).toBe(false);
  expect(old.active()).toBe(0);
  expect(next.active()).toBeGreaterThan(0);
  old.notify.mockClear();
  act(() => old.owner.set('/showDetail', false));
  act(() => old.owner.set('/showDetail', true));
  expect(old.notify).not.toHaveBeenCalled();
  expect(detail().checked).toBe(false);
  fireEvent.click(detail());
  expect(next.set).toHaveBeenCalledExactlyOnceWith('/showDetail', true);
  expect(next.owner.getSnapshot().showDetail).toBe(true);
  act(() => next.owner.set('/showDetail', false));
  expect(detail().checked).toBe(false);
  expect(old.set).toHaveBeenCalledTimes(2);
  expect(old.owner.getSnapshot().showDetail).toBe(true);
  expect(old.dispose).not.toHaveBeenCalled();
  expect(next.dispose).not.toHaveBeenCalled();
  view.unmount();
  expect(next.active()).toBe(0);
  expect(next.set).toHaveBeenCalledTimes(2);
  expect(next.update).not.toHaveBeenCalled();
  expect(old.update).not.toHaveBeenCalled();
  expect(old.dispose).not.toHaveBeenCalled();
  expect(next.dispose).not.toHaveBeenCalled();
});
