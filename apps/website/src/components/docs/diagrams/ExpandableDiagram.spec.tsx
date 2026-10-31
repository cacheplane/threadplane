import React from 'react';
import {
  fireEvent,
  render,
  screen,
  cleanup,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExpandableDiagram } from './ExpandableDiagram';

const dialogMethods = new Map(
  ['showModal', 'close'].map((name) => [
    name,
    Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name),
  ])
);
beforeEach(() => {
  // jsdom has no top-layer implementation. Browser audit covers focus trapping
  // and Escape with the native dialog, rather than a simulated key handler.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    },
  });
});
afterEach(() => {
  cleanup();
  for (const [name, descriptor] of dialogMethods) {
    if (descriptor)
      Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});

describe('diagram expansion', () => {
  it('moves a single diagram into the dialog and returns focus when it closes', () => {
    render(
      <ExpandableDiagram
        label="Thread state"
        description="A thread owns checkpoints."
      >
        <svg role="img" aria-label="Thread" />
      </ExpandableDiagram>
    );
    const trigger = screen.getByRole('button', {
      name: 'Expand diagram: Thread state',
    });
    trigger.focus();
    fireEvent.click(trigger);
    const modal = screen.getByRole('dialog', { name: 'Thread state' });
    expect(within(modal).getByRole('img', { name: 'Thread' })).toBeTruthy();
    expect(screen.getAllByRole('img', { name: 'Thread' })).toHaveLength(1);
    expect(within(modal).getByText('A thread owns checkpoints.')).toBeTruthy();
    fireEvent.click(
      within(modal).getByRole('button', { name: 'Close diagram' })
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(screen.getAllByRole('img', { name: 'Thread' })).toHaveLength(1);
  });

  it('restores the reading view after the native dialog closes', () => {
    render(
      <ExpandableDiagram label="Turn">
        <p>One user message, many chunks.</p>
      </ExpandableDiagram>
    );
    const trigger = screen.getByRole('button', {
      name: 'Expand diagram: Turn',
    });
    fireEvent.click(trigger);
    fireEvent(screen.getByRole('dialog'), new Event('close'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByText('One user message, many chunks.')).toBeTruthy();
  });

  it('wraps keyboard focus between the first and last modal controls', () => {
    render(
      <ExpandableDiagram label="Turn">
        <p>One user message.</p>
      </ExpandableDiagram>
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Expand diagram: Turn' })
    );
    const modal = screen.getByRole('dialog');
    const close = within(modal).getByRole('button', { name: 'Close diagram' });
    const summary = within(modal).getByText('Read diagram description');
    close.focus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(summary);
    fireEvent.keyDown(summary, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
  });
});
