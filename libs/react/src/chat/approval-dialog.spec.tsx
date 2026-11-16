import { StrictMode } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalCard } from './index';

// jsdom has no modal dialog; model only the open attribute.
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    }),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const actions = (approve = vi.fn(), decline = vi.fn()) =>
  [
    { id: 'approve', label: 'Save note', onSelect: approve },
    { id: 'edit', label: 'Edit', onSelect: vi.fn() },
    { id: 'decline', label: "Don't save", onSelect: decline },
  ] as const;

describe('ApprovalCard dialog presentation', () => {
  it('stays an inline region by default and opens no dialog', () => {
    const view = render(
      <ApprovalCard actions={actions()}>
        <p>Body</p>
      </ApprovalCard>
    );
    expect(view.container.querySelector('dialog')).toBeNull();
    expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled();
    expect(view.container.querySelector('section.tp-approval-card')).not.toBeNull();
  });

  it('opens the same content as a named modal and focuses the first action', () => {
    const view = render(
      <ApprovalCard presentation="dialog" title="Save the note?" actions={actions()}>
        <p>Body</p>
      </ApprovalCard>
    );
    const dialog = view.container.querySelector('dialog')!;
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce();
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.className).toBe(
      'tp-approval-card tp-status-panel tp-approval-card--dialog'
    );
    expect(dialog.getAttribute('data-tone')).toBe('warning');
    const title = view.getByRole('heading', { name: 'Save the note?' });
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id);
    expect(view.getByText('Waiting for your approval.')).not.toBeNull();
    expect(view.getByText('Body')).not.toBeNull();
    expect(
      Array.from(dialog.querySelectorAll('button')).map((button) => button.textContent)
    ).toEqual(['Save note', 'Edit', "Don't save"]);
    expect(document.activeElement).toBe(view.getByRole('button', { name: 'Save note' }));
  });

  it('runs an action without closing itself: the app unmounts the card', () => {
    const approve = vi.fn();
    const view = render(
      <ApprovalCard presentation="dialog" actions={actions(approve)}>
        <p>Body</p>
      </ApprovalCard>
    );
    fireEvent.click(view.getByRole('button', { name: 'Save note' }));
    expect(approve).toHaveBeenCalledOnce();
    expect(HTMLDialogElement.prototype.close).not.toHaveBeenCalled();
    expect(view.container.querySelector('dialog')?.hasAttribute('open')).toBe(true);
  });

  it('asks the app on Escape and stays open', () => {
    const onDismiss = vi.fn();
    const view = render(
      <ApprovalCard presentation="dialog" actions={actions()} onDismiss={onDismiss}>
        <p>Body</p>
      </ApprovalCard>
    );
    const dialog = view.container.querySelector('dialog')!;
    const cancel = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(dialog.hasAttribute('open')).toBe(true);
  });

  it('ignores Escape without onDismiss, and uses the latest onDismiss', () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = render(
      <ApprovalCard presentation="dialog" actions={actions()}>
        <p>Body</p>
      </ApprovalCard>
    );
    const dialog = view.container.querySelector('dialog')!;
    const ignored = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(ignored);
    expect(ignored.defaultPrevented).toBe(true);
    expect(dialog.hasAttribute('open')).toBe(true);
    view.rerender(
      <ApprovalCard presentation="dialog" actions={actions()} onDismiss={first}>
        <p>Body</p>
      </ApprovalCard>
    );
    view.rerender(
      <ApprovalCard presentation="dialog" actions={actions()} onDismiss={second}>
        <p>Body</p>
      </ApprovalCard>
    );
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce();
  });

  it('closes when the card unmounts', () => {
    const view = render(
      <ApprovalCard presentation="dialog" actions={actions()}>
        <p>Body</p>
      </ApprovalCard>
    );
    view.unmount();
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalledOnce();
  });

  it('ends open exactly once under StrictMode', () => {
    const view = render(
      <StrictMode>
        <ApprovalCard presentation="dialog" actions={actions()}>
          <p>Body</p>
        </ApprovalCard>
      </StrictMode>
    );
    expect(view.container.querySelectorAll('dialog[open]')).toHaveLength(1);
  });

  it('marks a destructive request and keeps disabled actions inert', () => {
    const approve = vi.fn();
    const view = render(
      <ApprovalCard presentation="dialog" destructive disabled actions={actions(approve)}>
        <p>Body</p>
      </ApprovalCard>
    );
    expect(view.container.querySelector('dialog')?.getAttribute('data-tone')).toBe('danger');
    expect(view.getByText("This can't be undone.")).not.toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Save note' }));
    expect(approve).not.toHaveBeenCalled();
  });
});
