import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { ChatApprovalCardComponent } from './chat-approval-card.component';
import { mockAgent } from '../../testing/mock-agent';
import type { AgentInterrupt } from '../../agent/agent-interrupt';

@Component({
  standalone: true,
  imports: [ChatApprovalCardComponent],
  template: `
    <chat-approval-card
      [agent]="agent"
      [matchKind]="matchKind"
      [showEdit]="showEdit"
      (action)="lastAction = $event"
    >
      <ng-template #body let-payload>
        <span class="amount">{{ payload.amount }}</span>
        <span class="customer">{{ payload.customer_id }}</span>
      </ng-template>
    </chat-approval-card>
  `,
})
class HostComponent {
  agent = mockAgent({ withInterrupt: true });
  matchKind: string | undefined = undefined;
  showEdit = false;
  lastAction: string | undefined = undefined;
}

describe('ChatApprovalCardComponent', () => {
  let host: HostComponent;
  let fixture: ReturnType<typeof TestBed.createComponent<HostComponent>>;

  beforeEach(() => {
    // jsdom doesn't implement HTMLDialogElement.showModal/close.
    // Stub them so the component's effect can call them under test.
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function () {
        (this as unknown as { open: boolean }).open = true;
      };
    }
    if (!HTMLDialogElement.prototype.close) {
      HTMLDialogElement.prototype.close = function () {
        (this as unknown as { open: boolean }).open = false;
      };
    }
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  it('renders the projected body template with payload bound', () => {
    const interrupt: AgentInterrupt = {
      id: 'int-1',
      value: { kind: 'refund_approval', amount: 47.5, customer_id: 'cus_a8x2k' },
      resumable: true,
    };
    host.agent.interrupt!.set(interrupt);
    fixture.detectChanges();

    const amount = fixture.nativeElement.querySelector('.amount')?.textContent?.trim();
    const customer = fixture.nativeElement.querySelector('.customer')?.textContent?.trim();
    expect(amount).toBe('47.5');
    expect(customer).toBe('cus_a8x2k');
  });

  it('renders body when matchKind matches the interrupt kind', () => {
    host.matchKind = 'refund_approval';
    host.agent.interrupt!.set({
      id: 'int-1',
      value: { kind: 'refund_approval', amount: 47.5, customer_id: 'cus_a' },
      resumable: true,
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.amount')?.textContent?.trim()).toBe('47.5');
  });

  it('renders nothing when matchKind does not match', () => {
    host.matchKind = 'refund_approval';
    host.agent.interrupt!.set({
      id: 'int-2',
      value: { kind: 'delete_approval', target: 'user_42' },
      resumable: true,
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.amount')).toBeNull();
  });

  it('emits "approve" when the Approve button is clicked', () => {
    host.agent.interrupt!.set({
      id: 'int-3',
      value: { kind: 'refund_approval', amount: 10, customer_id: 'cus_a' },
      resumable: true,
    });
    fixture.detectChanges();
    const approve = fixture.nativeElement.querySelector('.btn-primary') as HTMLButtonElement;
    approve.click();
    expect(host.lastAction).toBe('approve');
  });

  it('emits "cancel" when the Cancel button is clicked', () => {
    host.agent.interrupt!.set({
      id: 'int-4',
      value: { kind: 'refund_approval', amount: 10, customer_id: 'cus_a' },
      resumable: true,
    });
    fixture.detectChanges();
    const cancel = fixture.nativeElement.querySelector('.btn-text') as HTMLButtonElement;
    cancel.click();
    expect(host.lastAction).toBe('cancel');
  });

  it('hides the Edit button when showEdit is false', () => {
    host.showEdit = false;
    host.agent.interrupt!.set({
      id: 'int-5',
      value: { kind: 'refund_approval', amount: 10, customer_id: 'cus_a' },
      resumable: true,
    });
    fixture.detectChanges();
    const editButtons = fixture.nativeElement.querySelectorAll('button.btn-secondary');
    expect(editButtons.length).toBe(0);
  });

  it('shows the Edit button and emits "edit" when showEdit is true', () => {
    host.showEdit = true;
    host.agent.interrupt!.set({
      id: 'int-6',
      value: { kind: 'refund_approval', amount: 10, customer_id: 'cus_a' },
      resumable: true,
    });
    fixture.detectChanges();
    const edit = fixture.nativeElement.querySelector('.btn-secondary') as HTMLButtonElement;
    expect(edit).not.toBeNull();
    edit.click();
    expect(host.lastAction).toBe('edit');
  });

  it('keeps the dialog open after Edit (non-terminal), closes after Approve', () => {
    host.showEdit = true;
    host.agent.interrupt!.set({
      id: 'int-edit-open',
      value: { kind: 'refund_approval', amount: 10, customer_id: 'cus_a' },
      resumable: true,
    });
    fixture.detectChanges();
    const dialog = fixture.nativeElement.querySelector('dialog.chat-approval-card') as HTMLDialogElement;
    expect(dialog.open).toBe(true);

    // Edit is non-terminal — dialog must stay open so the caller can reveal
    // an inline editor in the body slot.
    (fixture.nativeElement.querySelector('.btn-secondary') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(dialog.open).toBe(true);

    // Approve is terminal — dialog closes.
    (fixture.nativeElement.querySelector('.btn-primary') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(dialog.open).toBe(false);
  });

  it('opens the dialog when an interrupt becomes present, closes when it goes away', () => {
    const dialog = fixture.nativeElement.querySelector('dialog.chat-approval-card') as HTMLDialogElement;
    expect(dialog.open).toBe(false);

    host.agent.interrupt!.set({
      id: 'int-open',
      value: { kind: 'refund_approval', amount: 1, customer_id: 'cus_a' },
      resumable: true,
    });
    fixture.detectChanges();
    expect(dialog.open).toBe(true);

    host.agent.interrupt!.set(undefined);
    fixture.detectChanges();
    expect(dialog.open).toBe(false);
  });

  it('emits "cancel" when the native dialog cancel event fires (Escape)', () => {
    host.agent.interrupt!.set({
      id: 'int-esc',
      value: { kind: 'refund_approval', amount: 1, customer_id: 'cus_a' },
      resumable: true,
    });
    fixture.detectChanges();
    const dialog = fixture.nativeElement.querySelector('dialog.chat-approval-card') as HTMLDialogElement;
    // Native dialog dispatches 'cancel' on Escape. Simulate it directly.
    const cancelEvent = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancelEvent);
    expect(host.lastAction).toBe('cancel');
    expect(cancelEvent.defaultPrevented).toBe(true);
  });
});

@Component({
  standalone: true,
  imports: [ChatApprovalCardComponent],
  template: `
    <chat-approval-card
      [agent]="agent"
      presentation="inline"
      [destructive]="destructive"
      title="Save the comparison note to your workspace?"
      approveLabel="Save note"
      cancelLabel="Don't save"
      (action)="lastAction = $event"
    >
      <ng-template #body let-payload><code class="args">save_note · folder: {{ payload.folder }}</code></ng-template>
    </chat-approval-card>
  `,
})
class InlineHost {
  agent = mockAgent({ withInterrupt: true });
  destructive = false;
  lastAction: string | undefined = undefined;
}

describe('ChatApprovalCardComponent — inline', () => {
  function render(destructive = false) {
    const fixture = TestBed.createComponent(InlineHost);
    fixture.componentInstance.destructive = destructive;
    document.body.appendChild(fixture.nativeElement);
    fixture.componentInstance.agent.interrupt!.set({ id: 'i1', value: { folder: 'Comparisons' }, resumable: true });
    fixture.detectChanges();
    TestBed.tick();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  it('renders a warning status panel in place and never opens the dialog', () => {
    const { root } = render();
    expect(root.querySelector('dialog')!.open).toBe(false);
    const panel = root.querySelector<HTMLElement>('.chat-approval-card--inline')!;
    expect(panel.getAttribute('data-tone')).toBe('warning');
    expect(panel.querySelector('.tp-status-panel__lead')!.textContent!.trim()).toBe('Waiting for your approval.');
    expect(panel.textContent).toContain('Save the comparison note to your workspace?');
    expect(panel.querySelector('.args')!.textContent).toBe('save_note · folder: Comparisons');
    const buttons = Array.from(panel.querySelectorAll('button')).map((b) => b.textContent!.trim());
    expect(buttons).toEqual(['Save note', "Don't save"]);
    expect(panel.closest('[role="alert"]')).toBeNull();
  });

  it('moves focus to the first action when it appears', () => {
    const { root } = render();
    expect(document.activeElement).toBe(root.querySelector('.chat-approval-card--inline button'));
  });

  it('emits approve and cancel from the named actions', () => {
    const { fixture, root } = render();
    root.querySelectorAll<HTMLButtonElement>('.chat-approval-card--inline button')[1].click();
    expect(fixture.componentInstance.lastAction).toBe('cancel');
    root.querySelectorAll<HTMLButtonElement>('.chat-approval-card--inline button')[0].click();
    expect(fixture.componentInstance.lastAction).toBe('approve');
  });

  it('uses the danger tint and states that a destructive action cannot be undone', () => {
    const { root } = render(true);
    const panel = root.querySelector<HTMLElement>('.chat-approval-card--inline')!;
    expect(panel.getAttribute('data-tone')).toBe('danger');
    expect(panel.querySelector('.tp-status-panel__lead')!.textContent!.trim()).toBe("This can't be undone.");
    expect(panel.querySelector('button')!.classList.contains('btn-danger')).toBe(true);
  });

  it('renders nothing while no interrupt is pending', () => {
    const fixture = TestBed.createComponent(InlineHost);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.chat-approval-card--inline')).toBeNull();
  });
});
