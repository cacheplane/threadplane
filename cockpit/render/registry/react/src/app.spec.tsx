import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RegistryDemo } from './app';
import { createPlayback } from './playback';
import { REGISTRY_SAMPLES } from './specs';

afterEach(cleanup);
function fixture() {
  const callbacks: FrameRequestCallback[] = [];
  const playback = createPlayback(REGISTRY_SAMPLES, {
    request: (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    },
    cancel: () => undefined,
  });
  const ready = vi.fn();
  render(
    <RegistryDemo
      playback={playback}
      samples={REGISTRY_SAMPLES.map((sample) => sample.label)}
      onReady={ready}
    />
  );
  return { playback, ready, callbacks };
}
const click = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name }));
const output = () => screen.getByRole('region', { name: 'Render output' });
const mode = (value: string) =>
  fireEvent.change(screen.getByRole('combobox', { name: 'Badge display' }), {
    target: { value },
  });
const choose = (value: number) =>
  fireEvent.change(screen.getByRole('combobox', { name: 'Sample' }), {
    target: { value: String(value) },
  });
const source = () =>
  screen.getByRole('region', { name: 'Streaming JSON' }).querySelector('pre')
    ?.textContent;

it('starts Registered and empty with an owned readiness callback', () => {
  const { ready, playback } = fixture();
  expect(ready).toHaveBeenCalledTimes(1);
  expect(playback.getSnapshot().position).toBe(0);
  expect(
    (
      screen.getByRole('combobox', {
        name: 'Badge display',
      }) as HTMLSelectElement
    ).value
  ).toBe('registered');
  expect(output().textContent).toContain('Play a sample');
  expect(source()).toBe('');
});

it('uses the native registry to register, omit or fallback for each known Badge without changing source', () => {
  const { playback } = fixture();
  for (const [sample, count] of [
    [0, 1],
    [1, 1],
    [2, 2],
  ]) {
    choose(sample);
    mode('registered');
    click('Finish');
    expect(output().querySelectorAll('[data-registry-badge]')).toHaveLength(
      count
    );
    expect(output().querySelectorAll('[data-registry-fallback]')).toHaveLength(
      0
    );
    const json = source(),
      position = playback.getSnapshot().position;
    mode('omitted');
    expect(output().querySelectorAll('[data-registry-badge]')).toHaveLength(0);
    expect(output().querySelectorAll('[data-registry-fallback]')).toHaveLength(
      0
    );
    mode('fallback');
    expect(output().querySelectorAll('[data-registry-fallback]')).toHaveLength(
      count
    );
    expect(source()).toBe(json);
    expect(playback.getSnapshot().position).toBe(position);
    mode('registered');
    expect(output().querySelectorAll('[data-registry-badge]')).toHaveLength(
      count
    );
  }
});

it('passes native resolved props, exact element key and loading to the authored fallback', () => {
  const { playback } = fixture();
  mode('fallback');
  act(() => playback.seek(REGISTRY_SAMPLES[0].json.length - 2));
  const fallback = output().querySelector('[data-registry-fallback]');
  expect(fallback?.getAttribute('data-fallback-key')).toBe('badge');
  expect(fallback?.textContent).toBe('Fallback: Registered');
  expect(fallback?.getAttribute('aria-busy')).toBe('true');
  click('Finish');
  expect(
    output()
      .querySelector('[data-registry-fallback]')
      ?.getAttribute('aria-busy')
  ).toBe('false');
});

it('keeps registry choice through active and stale playback, rewind, Reset and selection', () => {
  const { playback, callbacks } = fixture();
  mode('fallback');
  click('Play');
  const stale = callbacks.at(-1)!;
  click('Pause');
  const paused = playback.getSnapshot();
  act(() => stale(0));
  expect(playback.getSnapshot()).toBe(paused);
  click('Finish');
  act(() => playback.seek(0));
  click('Finish');
  expect(output().querySelectorAll('[data-registry-fallback]')).toHaveLength(1);
  click('Reset');
  choose(2);
  click('Finish');
  expect(output().querySelectorAll('[data-registry-fallback]')).toHaveLength(2);
  expect(
    (
      screen.getByRole('combobox', {
        name: 'Badge display',
      }) as HTMLSelectElement
    ).value
  ).toBe('fallback');
});

it('displays native children exactly once in each authored container', () => {
  fixture();
  choose(2);
  click('Finish');
  expect(output().querySelectorAll('article')).toHaveLength(2);
  for (const text of [
    'First Section',
    'Second Section',
    'Text inside the first card section.',
    'Text inside the second card section.',
  ])
    expect(output().textContent?.split(text)).toHaveLength(2);
});

it('mounts every actual prefix through all native registry modes without executable markup', () => {
  const { playback } = fixture();
  for (const choice of ['registered', 'omitted', 'fallback']) {
    mode(choice);
    for (let sample = 0; sample < REGISTRY_SAMPLES.length; sample++) {
      choose(sample);
      for (
        let position = 0;
        position <= REGISTRY_SAMPLES[sample].json.length;
        position++
      )
        act(() => playback.seek(position));
      expect(playback.getSnapshot().phase).toBe('complete');
    }
  }
  expect(output().querySelector('script')).toBeNull();
});
