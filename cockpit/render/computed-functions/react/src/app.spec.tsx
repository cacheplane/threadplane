import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ComputedDemo } from './app';
import { createPlayback } from './playback';
import { localSamples } from './specs';

afterEach(cleanup);
function fixture() {
  const playback = createPlayback(localSamples, {
    request: () => 1,
    cancel: () => undefined,
  });
  const ready = vi.fn();
  render(
    <ComputedDemo
      playback={playback}
      samples={localSamples.map((sample) => sample.label)}
      onReady={ready}
    />
  );
  return { playback, ready };
}
it('starts empty, paused and ready with labelled playback controls', () => {
  const { playback, ready } = fixture();
  expect(ready).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole('heading', { name: 'Computed Functions' })
  ).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('Paused · 0 characters');
  expect(screen.getByRole('combobox', { name: 'Sample' })).toBeTruthy();
  expect(
    screen.getByRole('slider', { name: 'Playback position' })
  ).toBeTruthy();
  expect(playback.getSnapshot().spec).toBeNull();
});
it.each([
  [0, ['HELLO WORLD', 'gnimaerts']],
  [1, [new Date('2024-06-15T12:00:00Z').toLocaleDateString(), '42']],
  [
    2,
    [
      '60',
      'COMPUTED FUNCTIONS',
      new Date('2025-01-01T00:00:00Z').toLocaleDateString(),
    ],
  ],
] as const)(
  'resolves sample %i through native registered pure callbacks',
  (index, expected) => {
    const { playback } = fixture();
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: String(index) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    const output = within(
      screen.getByRole('region', { name: 'Render output' })
    );
    for (const value of expected) expect(output.getByText(value)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Complete');
    expect(
      screen
        .getByRole('region', { name: 'Streaming JSON' })
        .querySelector('pre')?.textContent
    ).toBe(localSamples[index].json);
    expect(playback.getSnapshot().spec).toEqual(
      JSON.parse(localSamples[index].json)
    );
  }
);
it('rewinds, pauses and resets native computed output without retaining stale sample values', () => {
  const { playback } = fixture();
  fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
  expect(screen.getByText('HELLO WORLD')).toBeTruthy();
  fireEvent.change(screen.getByRole('slider'), { target: { value: '5' } });
  expect(screen.queryByText('HELLO WORLD')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Play' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
  expect(playback.getSnapshot().playing).toBe(false);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
  expect(screen.getByText('COMPUTED FUNCTIONS')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  expect(playback.getSnapshot()).toMatchObject({
    selected: 2,
    position: 0,
    rawJson: '',
    spec: null,
    phase: 'paused',
  });
});
