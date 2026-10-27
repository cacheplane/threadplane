import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SpecDemo } from './app';
import { createPlayback } from './playback';

afterEach(cleanup);

function fixture() {
  const store = createPlayback(
    [
      {
        label: 'Literal',
        json: JSON.stringify({
          root: 'root',
          elements: {
            root: {
              type: 'Heading',
              props: { content: 'Literal <script>heading</script>' },
              children: ['card'],
            },
            card: {
              type: 'Card',
              props: { title: 'Nested card' },
              children: ['badge', 'text'],
            },
            badge: { type: 'Badge', props: { label: 'First child' } },
            text: { type: 'Text', props: { content: 'Second child' } },
          },
        }),
      },
      {
        label: 'Other',
        json: JSON.stringify({
          root: 'root',
          elements: {
            root: { type: 'Text', props: { content: 'Other sample' } },
          },
        }),
      },
    ],
    { request: () => 1, cancel: () => undefined }
  );
  const ready = vi.fn();
  render(
    <SpecDemo playback={store} samples={['Literal', 'Other']} onReady={ready} />
  );
  return { store, ready };
}

it('mounts empty and exposes labelled local playback controls', () => {
  const { ready, store } = fixture();
  expect(ready).toHaveBeenCalledTimes(1);
  expect(store.getSnapshot().position).toBe(0);
  expect(screen.getByRole('status').textContent).toBe('Paused · 0 characters');
  expect(screen.getByRole('combobox', { name: 'Sample' })).toBeTruthy();
  expect(
    screen.getByRole('slider', { name: 'Playback position' })
  ).toBeTruthy();
  expect(
    screen.getByRole('region', { name: 'Render output' }).textContent
  ).toContain('Play a sample');
  expect(
    screen.getByRole('region', { name: 'Streaming JSON' }).querySelector('pre')
      ?.textContent
  ).toBe('');
});

it('renders literal native views and nested children in authored order on Finish', () => {
  fixture();
  fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
  const output = screen.getByRole('region', { name: 'Render output' });
  expect(
    within(output).getByRole('heading', {
      name: 'Literal <script>heading</script>',
    })
  ).toBeTruthy();
  expect(
    within(output).getByRole('heading', { name: 'Nested card' })
  ).toBeTruthy();
  expect(output.querySelector('script')).toBeNull();
  expect(output.textContent!.indexOf('First child')).toBeLessThan(
    output.textContent!.indexOf('Second child')
  );
  expect(screen.getByRole('status').textContent).toContain('Complete');
});

it('rewinds, resets and switches samples through the actual playback owner', () => {
  const { store } = fixture();
  fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
  fireEvent.change(screen.getByRole('slider'), { target: { value: '5' } });
  expect(store.getSnapshot().position).toBe(5);
  expect(screen.queryByText('Nested card')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Play' }));
  expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
  expect(store.getSnapshot().playing).toBe(false);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
  expect(
    within(screen.getByRole('region', { name: 'Render output' })).getByText(
      'Other sample'
    )
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  expect(store.getSnapshot()).toMatchObject({
    selected: 1,
    position: 0,
    spec: null,
  });
});
