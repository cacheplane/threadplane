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
