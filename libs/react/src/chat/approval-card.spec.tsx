import { StrictMode } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApprovalCard } from './index';

afterEach(cleanup);
describe('ApprovalCard', () => {
  it('renders authored body/actions and invokes only explicitly activated callbacks', () => {
    const approve = vi.fn(),
      decline = vi.fn();
    const actions = [
      { id: 'approve', label: 'Approve request', onSelect: approve },
      { id: 'decline', label: 'Decline request', onSelect: decline },
    ] as const;
    const view = render(
      <ApprovalCard actions={actions}>
        <p>Supplied reason</p>
      </ApprovalCard>
    );
    expect(view.getByRole('region', { name: 'Approval request' })).toBeTruthy();
    expect(view.getByText('Supplied reason')).toBeTruthy();
    expect(approve).not.toHaveBeenCalled();
    expect(decline).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: 'Approve request' }));
    expect(approve).toHaveBeenCalledOnce();
    expect(decline).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: 'Decline request' }));
    expect(decline).toHaveBeenCalledOnce();
    expect(view.getByRole('region', { name: 'Approval request' })).toBeTruthy();
  });

  it('honors authoritative root and per-action disabled state', () => {
    const enabled = vi.fn(),
      disabled = vi.fn();
    const actions = [
      { id: 'enabled', label: 'Enabled', onSelect: enabled },
      { id: 'disabled', label: 'Disabled', onSelect: disabled, disabled: true },
    ];
    const view = render(
      <ApprovalCard actions={actions} disabled>
        Waiting
      </ApprovalCard>
    );
    for (const button of view.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(button);
    }
    expect(enabled).not.toHaveBeenCalled();
    expect(disabled).not.toHaveBeenCalled();
    view.rerender(<ApprovalCard actions={actions}>Ready</ApprovalCard>);
    fireEvent.click(view.getByRole('button', { name: 'Enabled' }));
    fireEvent.click(view.getByRole('button', { name: 'Disabled' }));
    expect(enabled).toHaveBeenCalledOnce();
    expect(disabled).not.toHaveBeenCalled();
  });

  it('uses current callbacks after same-ID action replacement without owning consumption', () => {
    const old = vi.fn(),
      current = vi.fn();
    const view = render(
      <ApprovalCard actions={[{ id: 'choice', label: 'Old', onSelect: old }]}>
        Old reason
      </ApprovalCard>
    );
    view.rerender(
      <ApprovalCard
        actions={[{ id: 'choice', label: 'Current', onSelect: current }]}
      >
        Current reason
      </ApprovalCard>
    );
    const button = view.getByRole('button', { name: 'Current' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(current).toHaveBeenCalledTimes(2);
    expect(old).not.toHaveBeenCalled();
    expect(view.getByText('Current reason')).toBeTruthy();
    view.rerender(
      <ApprovalCard
        actions={[{ id: 'choice', label: 'Current', onSelect: current }]}
        disabled
      >
        Pending
      </ApprovalCard>
    );
    fireEvent.click(button);
    expect(current).toHaveBeenCalledTimes(2);
  });

  it('supports app-authored body slots, labels, classes and arbitrary actions literally', () => {
    const edit = vi.fn();
    const view = render(
      <ApprovalCard
        title="Review itinerary"
        className="custom"
        actions={[{ id: 'edit', label: '<b>Edit</b>', onSelect: edit }]}
      >
        <label>
          Note
          <input aria-label="Note" />
        </label>
        <p>{'<script>unsafe()</script>'}</p>
      </ApprovalCard>
    );
    expect(
      view
        .getByRole('region', { name: 'Review itinerary' })
        .classList.contains('custom')
    ).toBe(true);
    expect(view.getByRole('textbox', { name: 'Note' })).toBeTruthy();
    expect(view.container.querySelector('script, b')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: '<b>Edit</b>' }));
    expect(edit).toHaveBeenCalledOnce();
  });

  it('uses stable unique heading targets and native non-submitting buttons', () => {
    const actions = [{ id: 'choice', label: 'Choose', onSelect: vi.fn() }];
    const tree = (
      <>
        <ApprovalCard actions={actions}>First</ApprovalCard>
        <ApprovalCard actions={actions}>Second</ApprovalCard>
      </>
    );
    const view = render(tree);
    const ids = view
      .getAllByRole('region', { name: 'Approval request' })
      .map((section) => section.getAttribute('aria-labelledby'));
    expect(new Set(ids).size).toBe(2);
    for (const heading of view.getAllByRole('heading', { level: 2 }))
      expect(ids).toContain(heading.id);
    for (const button of view.getAllByRole('button'))
      expect(button.getAttribute('type')).toBe('button');
    view.rerender(tree);
    expect(
      view
        .getAllByRole('region')
        .map((section) => section.getAttribute('aria-labelledby'))
    ).toEqual(ids);
    expect(view.container.querySelector('dialog, [aria-live]')).toBeNull();
  });

  it('stays inert through StrictMode, prop changes, unmount and remount', () => {
    const callback = vi.fn();
    const actions = [{ id: 'choice', label: 'Choose', onSelect: callback }];
    const view = render(
      <StrictMode>
        <ApprovalCard actions={actions}>Reason</ApprovalCard>
      </StrictMode>
    );
    view.rerender(
      <StrictMode>
        <ApprovalCard actions={actions} disabled>
          Pending
        </ApprovalCard>
      </StrictMode>
    );
    view.unmount();
    render(<ApprovalCard actions={actions}>Reason</ApprovalCard>);
    expect(callback).not.toHaveBeenCalled();
  });
});
