import { type FormEvent } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import * as chat from './index';

afterEach(cleanup);

it('exports a controlled scrim with no DOM when closed', () => {
  expect(chat).toHaveProperty('ChatSidenavScrim');
  const view = render(
    <chat.ChatSidenavScrim open={false} onDismiss={vi.fn()} />
  );
  expect(view.container.childElementCount).toBe(0);
});

it('uses default and custom labels, additive classes and non-submit semantics', () => {
  expect(chat).toHaveProperty('ChatSidenavScrim');
  const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
  const view = render(
    <form onSubmit={onSubmit}>
      <chat.ChatSidenavScrim open onDismiss={vi.fn()} />
    </form>
  );
  const button = view.getByRole('button', {
    name: 'Close conversation navigation backdrop',
  });
  expect(button.getAttribute('type')).toBe('button');
  expect(button.classList.contains('tp-chat')).toBe(true);
  expect(button.classList.contains('tp-chat-sidenav-scrim')).toBe(true);
  fireEvent.click(button);
  expect(onSubmit).not.toHaveBeenCalled();
  view.rerender(
    <chat.ChatSidenavScrim
      open
      onDismiss={vi.fn()}
      label="Dismiss navigation"
      className="custom"
    />
  );
  expect(
    view
      .getByRole('button', { name: 'Dismiss navigation' })
      .classList.contains('custom')
  ).toBe(true);
});

it('only requests dismissal until its owner accepts closure', () => {
  expect(chat).toHaveProperty('ChatSidenavScrim');
  const onDismiss = vi.fn();
  const view = render(<chat.ChatSidenavScrim open onDismiss={onDismiss} />);
  const button = view.getByRole('button');
  button.focus();
  fireEvent.click(button);
  fireEvent.click(button);
  expect(onDismiss).toHaveBeenCalledTimes(2);
  expect(view.getByRole('button')).toBe(button);
  expect(document.activeElement).toBe(button);
  view.rerender(<chat.ChatSidenavScrim open={false} onDismiss={onDismiss} />);
  expect(view.queryByRole('button')).toBeNull();
});
