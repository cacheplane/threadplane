import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { createRenderState } from '@threadplane/content/render-state';
import { createInitialState, createStateEditor, type DemoState } from './state';
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
  const supplied = suppliedOwner(30);
  render(
    <StateDemo
      renderState={supplied.observer}
      onStateEdit={supplied.edit}
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

// The wrapper records commands and active listeners while delegating all storage
// and notification behavior to the actual render-state implementation.
function suppliedOwner(age = 42) {
  const owner = createRenderState({
    ...createInitialState(),
    user: { name: 'Alice', age },
  });
  let active = 0;
  const set = vi.fn(owner.set);
  const update = vi.fn(owner.update);
  const dispose = vi.fn(owner.dispose);
  const observer = {
    getSnapshot: owner.getSnapshot as () => DemoState,
    subscribe: (notify: () => void) => {
      active++;
      const release = owner.subscribe(notify);
      return () => {
        active--;
        release();
      };
    },
  };
  const edit = vi.fn(createStateEditor({ set }));
  return { owner, observer, set, update, dispose, edit, active: () => active };
}

function borrowedFixture(supplied = suppliedOwner(), strict = false) {
  const playback = createPlayback(STATE_SAMPLES, {
    request: () => 1,
    cancel: () => undefined,
  });
  const ready = vi.fn();
  const ui = (source: ReturnType<typeof suppliedOwner>) => {
    const demo = (
      <StateDemo
        playback={playback}
        renderState={source.observer}
        onStateEdit={source.edit}
        samples={STATE_SAMPLES.map((sample) => sample.label)}
        onReady={ready}
      />
    );
    return strict ? <StrictMode>{demo}</StrictMode> : demo;
  };
  const view = render(ui(supplied));
  return {
    ...view,
    playback,
    replace: (source: ReturnType<typeof suppliedOwner>) =>
      view.rerender(ui(source)),
  };
}
const ageControl = () =>
  screen.getByRole('spinbutton', { name: 'Age' }) as HTMLInputElement;
const ageEdit = (value: string) =>
  fireEvent.change(ageControl(), { target: { value } });

it('borrows the supplied current owner snapshot and observes external field writes', () => {
  const supplied = suppliedOwner();
  borrowedFixture(supplied);
  expect(ageControl().value).toBe('42');
  choose(1);
  finish();
  const old = supplied.owner.getSnapshot();
  act(() => {
    supplied.owner.set('/user/name', 'External');
    supplied.owner.set('/user/age', 41);
    supplied.owner.set('/settings/theme', 'light');
  });
  expect(
    screen.getByRole('textbox', { name: 'Name' }).getAttribute('value')
  ).toBe('External');
  expect(ageControl().value).toBe('41');
  expect(within(output()).getByText('External')).toBeTruthy();
  expect(within(output()).getByText('41')).toBeTruthy();
  expect(within(output()).getByText('light')).toBeTruthy();
  expect(old.user).toEqual({ name: 'Alice', age: 42 });
  expect(supplied.set).not.toHaveBeenCalled();
});

it('retains accepted age spelling until a committed different age retires it', () => {
  const supplied = suppliedOwner();
  borrowedFixture(supplied);
  ageEdit('042');
  expect(ageControl().value).toBe('042');
  expect(supplied.owner.get('/user/age')).toBe(42);
  act(() => supplied.owner.set('/user/name', 'Other'));
  expect(ageControl().value).toBe('042');
  act(() => supplied.owner.set('/user/age', 41));
  expect(ageControl().value).toBe('41');
  // Separate act commits are essential: returning to 42 must not revive 042.
  act(() => supplied.owner.set('/user/age', 42));
  expect(ageControl().value).toBe('42');
});

it('keeps an invalid draft and error while rendering the latest external owner value', () => {
  const supplied = suppliedOwner();
  borrowedFixture(supplied);
  choose(1);
  finish();
  ageEdit('151');
  expect(screen.getByRole('alert').textContent).toBe(
    'Enter a whole age from 0 to 150.'
  );
  act(() => {
    supplied.owner.set('/user/age', 41);
    supplied.owner.set('/user/name', 'External');
    supplied.owner.set('/settings/theme', 'light');
  });
  expect(ageControl().value).toBe('151');
  expect(ageControl().getAttribute('aria-invalid')).toBe('true');
  expect(within(output()).getByText('41')).toBeTruthy();
  expect(within(output()).getByText('External')).toBeTruthy();
  expect(within(output()).getByText('light')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toBe(
    'Enter a whole age from 0 to 150.'
  );
  expect(supplied.set).not.toHaveBeenCalled();
  ageEdit('0');
  expect(supplied.set).toHaveBeenLastCalledWith('/user/age', 0);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('releases replaced observers, resets drafts and uses the current callback without disposal', () => {
  const first = suppliedOwner();
  const second = suppliedOwner(51);
  const view = borrowedFixture(first);
  expect(first.active()).toBe(1);
  ageEdit('151');
  view.replace(second);
  expect(first.active()).toBe(0);
  expect(second.active()).toBe(1);
  expect(ageControl().value).toBe('51');
  expect(screen.queryByRole('alert')).toBeNull();
  ageEdit('052');
  expect(first.set).not.toHaveBeenCalled();
  expect(second.set).toHaveBeenLastCalledWith('/user/age', 52);
  expect(ageControl().value).toBe('052');
  view.unmount();
  expect(second.active()).toBe(0);
  expect(first.dispose).not.toHaveBeenCalled();
  expect(second.dispose).not.toHaveBeenCalled();
});

it('resets accepted spelling and invalid errors when replacement observers have the same age', () => {
  const first = suppliedOwner();
  const second = suppliedOwner();
  const third = suppliedOwner();
  const view = borrowedFixture(first);
  ageEdit('042');
  expect(ageControl().value).toBe('042');
  view.replace(second);
  expect(ageControl().value).toBe('42');
  ageEdit('151');
  expect(screen.getByRole('alert')).toBeTruthy();
  view.replace(third);
  expect(ageControl().value).toBe('42');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(first.active()).toBe(0);
  expect(second.active()).toBe(0);
  expect(third.active()).toBe(1);
  expect(second.set).not.toHaveBeenCalled();
  expect(third.set).not.toHaveBeenCalled();
});

it('releases only its subscription in StrictMode and remounts from writes made while absent', () => {
  const supplied = suppliedOwner();
  const view = borrowedFixture(supplied, true);
  expect(supplied.active()).toBe(1);
  expect(supplied.set).not.toHaveBeenCalled();
  expect(supplied.update).not.toHaveBeenCalled();
  ageEdit('042');
  ageEdit('151');
  view.unmount();
  expect(supplied.active()).toBe(0);
  expect(supplied.dispose).not.toHaveBeenCalled();
  act(() => supplied.owner.set('/user/age', 63));
  const remount = borrowedFixture(supplied, true);
  expect(ageControl().value).toBe('63');
  expect(screen.queryByRole('alert')).toBeNull();
  remount.unmount();
  expect(supplied.active()).toBe(0);
  expect(supplied.set).toHaveBeenCalledTimes(1);
  expect(supplied.dispose).not.toHaveBeenCalled();
  supplied.dispose();
  expect(supplied.dispose).toHaveBeenCalledTimes(1);
  expect(() => supplied.owner.set('/user/age', 64)).toThrow('disposed');
});
