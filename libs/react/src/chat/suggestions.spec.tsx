import { StrictMode } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Suggestions, type SuggestionItem } from './index';

afterEach(cleanup);
const items: readonly SuggestionItem[] = Object.freeze([
  Object.freeze({ id: 'a', label: '<b>Literal</b>', value: '  raw\n ' }),
  Object.freeze({ id: 'b', label: '<b>Literal</b>', value: '  raw\n ' }),
]);

it('exports a pure group of literal native buttons with exact values and no form submission', () => {
  const select = vi.fn();
  const submit = vi.fn((event) => event.preventDefault());
  const view = render(
    <form onSubmit={submit}>
      <Suggestions suggestions={items} onSelect={select} className="custom" />
    </form>
  );
  expect(
    view
      .getByRole('group', { name: 'Suggested replies' })
      .classList.contains('custom')
  ).toBe(true);
  expect(view.container.querySelector('b')).toBeNull();
  const buttons = view.getAllByRole('button', { name: '<b>Literal</b>' });
  for (const button of buttons) {
    expect(button.getAttribute('type')).toBe('button');
    expect(button.hasAttribute('aria-pressed')).toBe(false);
    fireEvent.click(button);
  }
  expect(select.mock.calls).toEqual([['  raw\n '], ['  raw\n ']]);
  expect(submit).not.toHaveBeenCalled();
});

it('renders nothing for an empty array and accepts a custom accessible group label', () => {
  const view = render(<Suggestions suggestions={[]} onSelect={vi.fn()} />);
  expect(view.container.childNodes).toHaveLength(0);
  view.rerender(
    <Suggestions suggestions={items} label="Next steps" onSelect={vi.fn()} />
  );
  expect(view.getByRole('group', { name: 'Next steps' })).toBeTruthy();
});

it('rejects duplicate IDs rather than duplicate labels or values', () => {
  expect(() =>
    render(
      <Suggestions suggestions={[items[0], items[0]]} onSelect={vi.fn()} />
    )
  ).toThrow(TypeError);
});

it.each([true, false, undefined, 'true', 1, {}, []].map((value) => [value]))(
  'disables group and item only for strict true: %s',
  (disabled) => {
    const select = vi.fn();
    const view = render(
      <Suggestions
        suggestions={[{ ...items[0], disabled: disabled as boolean }]}
        onSelect={select}
      />
    );
    const button = view.getByRole('button') as HTMLButtonElement;
    expect(button.disabled).toBe(disabled === true);
    fireEvent.click(button);
    view.rerender(
      <Suggestions
        suggestions={[items[0]]}
        disabled={disabled as boolean}
        onSelect={select}
      />
    );
    expect(button.disabled).toBe(disabled === true);
    fireEvent.click(button);
    expect(select.mock.calls).toEqual(
      disabled === true ? [] : [['  raw\n '], ['  raw\n ']]
    );
  }
);

it('suppresses a claimed event', () => {
  const select = vi.fn();
  const view = render(
    <div onClickCapture={(event) => event.preventDefault()}>
      <Suggestions suggestions={items} onSelect={select} />
    </div>
  );
  fireEvent.click(view.getAllByRole('button')[0]);
  expect(select).not.toHaveBeenCalled();
});

it('retains keyed buttons through reorder and uses updated values without lifecycle callbacks', () => {
  const select = vi.fn();
  const content = (suggestions = items) => (
    <StrictMode>
      <Suggestions suggestions={suggestions} onSelect={select} />
    </StrictMode>
  );
  const view = render(content());
  const button = view.getAllByRole('button')[0];
  button.focus();
  view.rerender(
    content(
      Object.freeze([
        items[1],
        Object.freeze({ ...items[0], value: 'updated' }),
      ])
    )
  );
  expect(view.getAllByRole('button')[1]).toBe(button);
  expect(document.activeElement).toBe(button);
  expect(select).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(select.mock.calls).toEqual([['updated']]);
  select.mockClear();
  view.unmount();
  expect(select).not.toHaveBeenCalled();
});
