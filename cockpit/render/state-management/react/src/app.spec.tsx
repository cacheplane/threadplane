import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StateDemo } from './app';
import { createPlayback, type FrameScheduler } from './playback';
import { STATE_SAMPLES } from './specs';

afterEach(cleanup);

function fixture() {
  const callbacks: FrameRequestCallback[] = [];
  const clock: FrameScheduler = {
    request: (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    },
    cancel: () => undefined,
  };
  const playback = createPlayback(STATE_SAMPLES, clock);
  const ready = vi.fn();
  render(
    <StateDemo
      playback={playback}
      samples={STATE_SAMPLES.map((sample) => sample.label)}
      onReady={ready}
    />
  );
  return { playback, ready, callbacks };
}
const output = () => screen.getByRole('region', { name: 'Render output' });
const json = () =>
  screen.getByRole('region', { name: 'Streaming JSON' }).querySelector('pre')
    ?.textContent;
const finish = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
const choose = (index: number) =>
  fireEvent.change(screen.getByRole('combobox', { name: 'Sample' }), {
    target: { value: String(index) },
  });

it('mounts empty with the three labelled seeded host controls', () => {
  const { ready, playback } = fixture();
  expect(ready).toHaveBeenCalledTimes(1);
  expect(playback.getSnapshot().position).toBe(0);
  expect(
    screen.getByRole('textbox', { name: 'Name' }).getAttribute('value')
  ).toBe('Alice');
  expect(
    (screen.getByRole('spinbutton', { name: 'Age' }) as HTMLInputElement).value
  ).toBe('30');
  expect(
    (screen.getByRole('combobox', { name: 'Theme' }) as HTMLSelectElement).value
  ).toBe('dark');
  expect(output().textContent).toContain('Play a sample');
  expect(json()).toBe('');
});

it('updates every native binding immediately without changing the completed source', () => {
  const { playback } = fixture();
  choose(1);
  finish();
  expect(output().textContent).toContain('Alice');
  expect(output().textContent).toContain('30');
  expect(output().textContent).toContain('dark');
  const source = json(),
    position = playback.getSnapshot().position;
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
    target: { value: '<script>Ada</script>' },
  });
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Age' }), {
    target: { value: '42' },
  });
  fireEvent.change(screen.getByRole('combobox', { name: 'Theme' }), {
    target: { value: 'light' },
  });
  expect(within(output()).getByText('<script>Ada</script>')).toBeTruthy();
  expect(within(output()).getByText('42')).toBeTruthy();
  expect(within(output()).getByText('light')).toBeTruthy();
  expect(output().querySelector('script')).toBeNull();
  expect(json()).toBe(source);
  expect(playback.getSnapshot().position).toBe(position);
});

it('preserves edits through active and stale frames, rewind, Reset and sample selection', () => {
  const { playback, callbacks } = fixture();
  choose(1);
  act(() => playback.seek(STATE_SAMPLES[1].json.indexOf('    "userAge":')));
  fireEvent.click(screen.getByRole('button', { name: 'Play' }));
  const stale = callbacks.at(-1)!;
  const position = playback.getSnapshot().position;
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
    target: { value: 'Grace' },
  });
  expect(output().textContent).toContain('Grace');
  expect(playback.getSnapshot().position).toBe(position);
  act(() => stale(0));
  expect(output().textContent).toContain('Grace');
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
  act(() => stale(0));
  fireEvent.change(screen.getByRole('slider', { name: 'Playback position' }), {
    target: { value: '0' },
  });
  finish();
  expect(output().textContent).toContain('Grace');
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  choose(2);
  finish();
  expect(within(output()).getByText('Grace')).toBeTruthy();
  expect(
    (screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value
  ).toBe('Grace');
  expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps the last valid bound age while an invalid draft is visible, then recovers', () => {
  fixture();
  choose(1);
  finish();
  const control = screen.getByRole('spinbutton', { name: 'Age' });
  fireEvent.change(control, { target: { value: '42' } });
  for (const value of ['', '-1', '151', '1.5']) {
    fireEvent.change(control, { target: { value } });
    expect(within(output()).getByText('42')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(
      'Enter a whole age from 0 to 150.'
    );
    expect(control.getAttribute('aria-invalid')).toBe('true');
  }
  fireEvent.change(control, { target: { value: '0' } });
  expect(within(output()).getByText('0')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(control.getAttribute('aria-invalid')).toBe('false');
});

it('keeps host edits after disposal without allowing an obsolete frame to publish', () => {
  const { playback, callbacks } = fixture();
  fireEvent.click(screen.getByRole('button', { name: 'Play' }));
  const stale = callbacks.at(-1)!;
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
    target: { value: 'Retained' },
  });
  act(() => playback.dispose());
  const snapshot = playback.getSnapshot();
  act(() => stale(0));
  expect(playback.getSnapshot()).toBe(snapshot);
  expect(
    (screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value
  ).toBe('Retained');
});
