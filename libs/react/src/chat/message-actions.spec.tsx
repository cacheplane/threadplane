import { StrictMode } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageActions } from './index';

afterEach(cleanup);
describe('MessageActions', () => {
  it('renders an authored group with native buttons and literal labels', () => {
    const onSelect = vi.fn();
    const view = render(
      <MessageActions
        label="Answer controls"
        className="custom"
        actions={[{ id: 'copy', label: '<b>Copy</b>', onSelect }]}
      />
    );
    expect(view.getByRole('group', { name: 'Answer controls' }).className).toBe(
      'tp-message-actions custom'
    );
    const button = view.getByRole('button', { name: '<b>Copy</b>' });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.querySelector('b')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(onSelect.mock.calls).toEqual([[]]);
  });
  it('honors root and per-action disabled state', () => {
    const onSelect = vi.fn();
    const actions = [
      { id: 'one', label: 'One', onSelect },
      { id: 'two', label: 'Two', onSelect, disabled: true },
    ];
    const view = render(<MessageActions actions={actions} disabled />);
    for (const button of view.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(button);
    }
    expect(onSelect).not.toHaveBeenCalled();
    view.rerender(<MessageActions actions={actions} />);
    fireEvent.click(view.getByText('Two'));
    fireEvent.click(view.getByText('One'));
    expect(onSelect).toHaveBeenCalledOnce();
  });
  it('uses current same-ID callbacks without implicit consumption', () => {
    const old = vi.fn(),
      current = vi.fn();
    const view = render(
      <MessageActions actions={[{ id: 'one', label: 'Old', onSelect: old }]} />
    );
    view.rerender(
      <MessageActions
        actions={[{ id: 'one', label: 'Current', onSelect: current }]}
      />
    );
    fireEvent.click(view.getByText('Current'));
    fireEvent.click(view.getByText('Current'));
    expect(current).toHaveBeenCalledTimes(2);
    expect(old).not.toHaveBeenCalled();
    expect(view.getByRole('group', { name: 'Message actions' })).toBeTruthy();
  });
  it('is inert across StrictMode, replacement and remount, and hides empty groups', () => {
    const onSelect = vi.fn();
    const actions = [{ id: 'x', label: 'X', onSelect }];
    const view = render(
      <StrictMode>
        <MessageActions actions={actions} />
      </StrictMode>
    );
    view.rerender(
      <StrictMode>
        <MessageActions actions={[]} />
      </StrictMode>
    );
    expect(view.queryByRole('group')).toBeNull();
    view.unmount();
    render(<MessageActions actions={actions} />);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
