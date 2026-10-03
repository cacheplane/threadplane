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
  render(
    <RepeatDemo
      playback={playback}
      samples={REPEAT_SAMPLES.map((sample) => sample.label)}
      onReady={ready}
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
