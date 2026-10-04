import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ElementRenderingDemo } from './app';
import { createPlayback } from './playback';
import { ELEMENT_RENDERING_SAMPLES } from './specs';

afterEach(cleanup);
function fixture() {
  const callbacks: FrameRequestCallback[] = [];
  const playback = createPlayback(ELEMENT_RENDERING_SAMPLES, {
    request: (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    },
    cancel: () => undefined,
  });
  const ready = vi.fn();
  render(
    <ElementRenderingDemo
      playback={playback}
      samples={ELEMENT_RENDERING_SAMPLES.map((sample) => sample.label)}
      onReady={ready}
    />
  );
  return { playback, callbacks, ready };
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
  const json = ELEMENT_RENDERING_SAMPLES[2].json;
  for (let position = 0; position <= json.length; position++) {
    act(() => playback.seek(position));
    expect(
      output().querySelector('[data-element-key="conditional"]')
    ).toBeNull();
    expect(source()).toBe(json.slice(0, position));
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
  for (
    let position = 0;
    position <= ELEMENT_RENDERING_SAMPLES[2].json.length;
    position++
  ) {
    act(() => playback.seek(position));
    const conditional = playback.getSnapshot().spec?.elements.conditional;
    expect(
      Boolean(output().querySelector('[data-element-key="conditional"]'))
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
