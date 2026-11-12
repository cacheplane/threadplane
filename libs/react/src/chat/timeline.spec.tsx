import { type ComponentProps } from 'react';
import { renderToString } from 'react-dom/server';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as chat from './index';

const Timeline = chat.Timeline;

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  vi.restoreAllMocks();
});

describe('Timeline', () => {
  it('exports the controlled timeline from the chat entry', () => {
    expect(Timeline).toBeTypeOf('function');
  });

  it('retains frozen order, literal text and exact raw selection IDs', () => {
    const items = Object.freeze([
      Object.freeze({
        id: '  z/<raw>  ',
        label: '<b>Later</b>',
        description: '<img src=x onerror=bad()>',
      }),
      Object.freeze({ id: 'a', label: 'Earlier' }),
    ]);
    const onSelect = vi.fn();
    const view = render(<Timeline items={items} onSelect={onSelect} />);
    const list = view.getByRole('list', { name: 'Checkpoints' });
    expect(list.tagName).toBe('OL');
    expect(
      view
        .getAllByRole('listitem')
        .map((row) => row.querySelector('.tp-timeline__label')?.textContent)
    ).toEqual(['<b>Later</b>', 'Earlier']);
    expect(view.getByText('<img src=x onerror=bad()>')).toBeTruthy();
    expect(list.querySelector('b, img')).toBeNull();
    const buttons = view.getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('type'))).toEqual([
      'button',
      'button',
    ]);
    expect(
      buttons.map(
        (button) => button.querySelector('[aria-hidden="true"]')?.textContent
      )
    ).toEqual(['1', '2']);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(buttons[0]);
    expect(onSelect.mock.calls).toEqual([['  z/<raw>  ']]);
    expect(
      buttons.every((button) => !button.hasAttribute('aria-current'))
    ).toBe(true);
  });

  it('keeps selection controlled and keyed DOM focus across reorder', () => {
    const items = [
      { id: ' a ', label: 'Alpha' },
      { id: 'a', label: 'Beta' },
    ];
    const onSelect = vi.fn();
    const view = render(
      <Timeline
        items={items}
        onSelect={onSelect}
        selectedId=" a "
        label="Loaded history"
        className="custom"
      />
    );
    const list = view.getByRole('list', { name: 'Loaded history' });
    expect(list.classList.contains('tp-timeline')).toBe(true);
    expect(list.classList.contains('custom')).toBe(true);
    const alpha = view.getByRole('button', { name: 'Alpha' });
    const beta = view.getByRole('button', { name: 'Beta' });
    const row = alpha.parentElement;
    expect(alpha.getAttribute('aria-current')).toBe('true');
    expect(beta.hasAttribute('aria-current')).toBe(false);
    fireEvent.click(beta);
    expect(alpha.getAttribute('aria-current')).toBe('true');
    expect(beta.hasAttribute('aria-current')).toBe(false);
    alpha.focus();
    view.rerender(
      <Timeline
        items={[items[1], items[0]]}
        onSelect={onSelect}
        selectedId="a"
      />
    );
    expect(view.getByRole('button', { name: 'Alpha' })).toBe(alpha);
    expect(alpha.parentElement).toBe(row);
    expect(document.activeElement).toBe(alpha);
    expect(alpha.hasAttribute('aria-current')).toBe(false);
    expect(beta.getAttribute('aria-current')).toBe('true');
    expect(
      view
        .getAllByRole('listitem')
        .map((entry) => entry.querySelector('.tp-timeline__label')?.textContent)
    ).toEqual(['Beta', 'Alpha']);
    for (const selectedId of [null, undefined, 'missing']) {
      view.rerender(
        <Timeline items={items} onSelect={onSelect} selectedId={selectedId} />
      );
      expect(view.container.querySelector('[aria-current]')).toBeNull();
    }
    expect(onSelect.mock.calls).toEqual([['a']]);
  });

  it.each([true, false, undefined, 'true', 1, {}, []].map((value) => [value]))(
    'disables only strict true: %s',
    (disabled) => {
      const onSelect = vi.fn();
      const items = [
        { id: 'raw', label: 'Checkpoint', disabled },
      ] as ComponentProps<typeof Timeline>['items'];
      const view = render(<Timeline items={items} onSelect={onSelect} />);
      const button = view.getByRole('button') as HTMLButtonElement;
      expect(button.disabled).toBe(disabled === true);
      fireEvent.click(button);
      expect(onSelect.mock.calls).toEqual(disabled === true ? [] : [['raw']]);
    }
  );

  it('passes original frozen objects, exact selection and supplied indexes to complete row renderers', () => {
    const items = Object.freeze([
      Object.freeze({
        id: ' b ',
        label: 'Default Beta',
        description: 'Hidden description',
        disabled: true,
      }),
      Object.freeze({ id: 'b', label: 'Default Alpha' }),
    ]);
    const onSelect = vi.fn();
    const renderItem = vi.fn(
      (item: { readonly id: string }, selected: boolean, index: number) => (
        <input
          aria-label={`${item.id}-${selected}-${index}`}
          defaultValue="Draft"
        />
      )
    );
    const view = render(
      <Timeline
        items={items}
        onSelect={onSelect}
        selectedId="b"
        renderItem={renderItem}
      />
    );
    expect(renderItem.mock.calls).toEqual([
      [items[0], false, 0],
      [items[1], true, 1],
    ]);
    expect(renderItem.mock.calls[0][0]).toBe(items[0]);
    expect(renderItem.mock.calls[1][0]).toBe(items[1]);
    expect(view.queryByRole('button')).toBeNull();
    expect(view.queryByText('Default Beta')).toBeNull();
    expect(view.queryByText('Hidden description')).toBeNull();
    expect(
      view.container.querySelector(
        '[aria-current], [disabled], .tp-timeline__marker'
      )
    ).toBeNull();
    const input = view.getAllByRole('textbox')[0] as HTMLInputElement;
    const row = input.parentElement;
    input.focus();
    fireEvent.change(input, { target: { value: 'Retained' } });
    view.rerender(
      <Timeline
        items={[items[1], items[0]]}
        onSelect={onSelect}
        renderItem={(item) => (
          <input aria-label={item.id} defaultValue="Changed" />
        )}
      />
    );
    expect(view.getAllByRole('textbox')[1]).toBe(input);
    expect(input.parentElement).toBe(row);
    expect(input.value).toBe('Retained');
    expect(document.activeElement).toBe(input);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it.each([null, false, undefined])(
    'honors empty complete-row output %s',
    (content) => {
      const view = render(
        <Timeline
          items={[{ id: 'a', label: 'Default' }]}
          onSelect={() => undefined}
          renderItem={() => content}
        />
      );
      expect(view.getAllByRole('listitem')).toHaveLength(1);
      expect(view.getByRole('listitem').innerHTML).toBe('');
      expect(view.queryByRole('button')).toBeNull();
    }
  );

  describe('replay and fork requests', () => {
    const items = Object.freeze([
      Object.freeze({ id: 'cp-1', label: 'Search <b>flights</b>', description: 'Two results' }),
      Object.freeze({ id: 'cp-2', label: 'Pick a seat', disabled: true }),
      Object.freeze({ id: '  raw/3  ', label: 'Book' }),
    ]);

    it('renders no action buttons, and the plain row, without the callbacks', () => {
      const view = render(<Timeline items={items} onSelect={vi.fn()} />);
      expect(view.getAllByRole('button')).toHaveLength(3);
      expect(view.container.querySelector('.tp-timeline__row')).toBeNull();
      expect(view.container.querySelector('li')?.firstElementChild?.tagName).toBe('BUTTON');
    });

    it('adds a named Replay and Fork button after each selection button', () => {
      const view = render(<Timeline items={items} onSelect={vi.fn()} onReplay={vi.fn()} onFork={vi.fn()} />);
      const rows = [...view.container.querySelectorAll('li')];
      expect(rows.map((row) => [...row.querySelectorAll('button')].map((node) => node.className))).toEqual(
        Array(3).fill(['tp-timeline__button', 'tp-timeline__action', 'tp-timeline__action'])
      );
      expect(view.getByRole('button', { name: 'Replay from Search <b>flights</b>' }).textContent).toBe('Replay');
      expect(view.getByRole('button', { name: 'Fork from Book' }).textContent).toBe('Fork');
      expect(view.container.querySelector('b')).toBeNull();
      for (const node of view.getAllByRole('button')) expect(node.getAttribute('type')).toBe('button');
    });

    it('shows only the action whose callback was supplied', () => {
      const view = render(<Timeline items={items} onSelect={vi.fn()} onFork={vi.fn()} />);
      expect(view.queryAllByRole('button', { name: /^Replay from/ })).toHaveLength(0);
      expect(view.getAllByRole('button', { name: /^Fork from/ })).toHaveLength(3);
    });

    it('requests with the exact raw id once per press, and never selects', () => {
      const onSelect = vi.fn();
      const onReplay = vi.fn();
      const onFork = vi.fn();
      const view = render(<Timeline items={items} onSelect={onSelect} selectedId="cp-1" onReplay={onReplay} onFork={onFork} />);
      fireEvent.click(view.getByRole('button', { name: 'Replay from Book' }));
      fireEvent.click(view.getByRole('button', { name: 'Fork from Search <b>flights</b>' }));
      expect(onReplay.mock.calls).toEqual([['  raw/3  ']]);
      expect(onFork.mock.calls).toEqual([['cp-1']]);
      expect(onSelect).not.toHaveBeenCalled();
      // Selection stays where the owner put it.
      expect(view.container.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
      expect(view.getByRole('button', { name: /Search/, current: true })).toBeTruthy();
    });

    it('disables the actions of a disabled item', () => {
      const onReplay = vi.fn();
      const onFork = vi.fn();
      const view = render(<Timeline items={items} onSelect={vi.fn()} onReplay={onReplay} onFork={onFork} />);
      const replay = view.getByRole('button', { name: 'Replay from Pick a seat' }) as HTMLButtonElement;
      const fork = view.getByRole('button', { name: 'Fork from Pick a seat' }) as HTMLButtonElement;
      expect([replay.disabled, fork.disabled]).toEqual([true, true]);
      fireEvent.click(replay);
      fireEvent.click(fork);
      expect(onReplay).not.toHaveBeenCalled();
      expect(onFork).not.toHaveBeenCalled();
      expect((view.getByRole('button', { name: 'Replay from Book' }) as HTMLButtonElement).disabled).toBe(false);
    });

    it('calls the handler of the latest render', () => {
      const first = vi.fn();
      const second = vi.fn();
      const view = render(<Timeline items={items} onSelect={vi.fn()} onReplay={first} />);
      const button = view.getByRole('button', { name: 'Replay from Book' });
      view.rerender(<Timeline items={items} onSelect={vi.fn()} onReplay={second} />);
      expect(view.getByRole('button', { name: 'Replay from Book' })).toBe(button);
      fireEvent.click(button);
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });

    it('leaves a complete row renderer in charge of its own actions', () => {
      const onReplay = vi.fn();
      const view = render(<Timeline items={items} onSelect={vi.fn()} onReplay={onReplay} renderItem={(item) => <em>{item.label}</em>} />);
      expect(view.queryAllByRole('button')).toHaveLength(0);
      expect(view.container.querySelectorAll('em')).toHaveLength(3);
    });

    it('server renders the actions', () => {
      const html = renderToString(<Timeline items={items} onSelect={() => undefined} onReplay={() => undefined} />);
      expect(html).toContain('aria-label="Replay from Book"');
      expect(html).not.toContain('Fork');
    });
  });

  it('renders an empty labelled ordered list without owner messages or callbacks', () => {
    const onSelect = vi.fn();
    const renderItem = vi.fn();
    const view = render(
      <Timeline items={[]} onSelect={onSelect} renderItem={renderItem} />
    );
    const list = view.getByRole('list', { name: 'Checkpoints' });
    expect(list.tagName).toBe('OL');
    expect(list.innerHTML).toBe('');
    expect(onSelect).not.toHaveBeenCalled();
    expect(renderItem).not.toHaveBeenCalled();
  });

  it('imports and server renders without browser globals or I/O', async () => {
    const onSelect = vi.fn();
    const fetch = vi.fn(() => {
      throw new Error('Unexpected request');
    });
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('fetch', fetch);
    vi.resetModules();
    try {
      const entry = await import('./index');
      const Component = entry.Timeline;
      const html = renderToString(
        <Component
          items={[
            {
              id: 'a',
              label: '<script>literal</script>',
              description: '<em>details</em>',
            },
          ]}
          selectedId="a"
          onSelect={onSelect}
        />
      );
      expect(html).toContain('aria-label="Checkpoints"');
      expect(html).toContain('aria-current="true"');
      expect(html).toContain('&lt;script&gt;literal&lt;/script&gt;');
      expect(html).toContain('&lt;em&gt;details&lt;/em&gt;');
      expect(onSelect).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
