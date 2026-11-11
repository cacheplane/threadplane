import { describe, it, expect, beforeEach } from 'vitest';
import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ChatComponent } from './chat.component';
import { ChatInterruptTemplateDirective } from './chat-interrupt-template.directive';
import { ChatApprovalCardComponent, type ChatApprovalAction, type ChatApprovalPresentation } from '../chat-approval-card/chat-approval-card.component';
import { mockAgent, type MockAgent } from '../../testing/mock-agent';
import { staticDelivery, type Message } from '../../agent';

const user = (id: string): Message => ({ id, role: 'user', content: 'save it', delivery: staticDelivery(id) });
const assistant = (id: string): Message => ({ id, role: 'assistant', content: 'Saving the note.', delivery: staticDelivery(id) });

@Component({
  standalone: true,
  imports: [ChatComponent, ChatInterruptTemplateDirective, ChatApprovalCardComponent],
  template: `
    <chat [agent]="agent">
      <ng-template chatInterruptTemplate let-ctxAgent>
        <chat-approval-card
          [agent]="ctxAgent"
          [presentation]="presentation"
          [showEdit]="true"
          [approveLabel]="approveLabel"
          (action)="answer($event)"
        >
          <ng-template #body let-payload><code>save_note</code></ng-template>
        </chat-approval-card>
      </ng-template>
    </chat>
  `,
})
class HostComponent {
  agent: MockAgent = mockAgent({ messages: [user('u1'), assistant('a1')], withInterrupt: true });
  presentation: ChatApprovalPresentation = 'inline';
  approveLabel = 'Save note';
  answer(action: ChatApprovalAction): void {
    // The app resumes the run; a terminal answer clears the interrupt.
    if (action !== 'edit') this.agent.interrupt!.set(undefined);
  }
}

function create(configure: (host: HostComponent) => void = () => undefined): ComponentFixture<HostComponent> {
  const fixture = TestBed.createComponent(HostComponent);
  configure(fixture.componentInstance);
  fixture.componentInstance.agent.interrupt!.set({ id: 'approve-1', value: { tool: 'save_note' }, resumable: true });
  fixture.detectChanges();
  return fixture;
}

const el = (fixture: ComponentFixture<HostComponent>) => fixture.nativeElement as HTMLElement;
const click = (fixture: ComponentFixture<HostComponent>, text: string) => {
  const buttons = Array.from(el(fixture).querySelectorAll<HTMLButtonElement>('.chat-approval-card--inline button'));
  buttons.find((b) => b.textContent!.trim() === text)!.click();
  fixture.detectChanges();
};
const records = (fixture: ComponentFixture<HostComponent>) =>
  Array.from(el(fixture).querySelectorAll<HTMLElement>('.chat-approval-record')).map((r) => r.textContent!.trim());

describe('ChatComponent — answered approval record', () => {
  beforeEach(() => {
    // jsdom has no HTMLDialogElement.showModal/close.
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.open = false;
    };
    TestBed.configureTestingModule({ imports: [HostComponent] });
  });

  it('shrinks an approved inline panel to one line after the message it followed', () => {
    const fixture = create();
    expect(records(fixture)).toEqual([]);
    click(fixture, 'Save note');
    expect(el(fixture).querySelector('.chat-approval-card--inline')).toBeNull();
    expect(records(fixture)).toEqual(['Approved: Save note']);
    const record = el(fixture).querySelector<HTMLElement>('.chat-approval-record')!;
    expect(record.dataset['verdict']).toBe('approved');
    const assistantMessage = Array.from(el(fixture).querySelectorAll('chat-message')).at(-1)!;
    expect(record.previousElementSibling).toBe(assistantMessage);
  });

  it('records a declined approval', () => {
    const fixture = create();
    click(fixture, 'Cancel');
    expect(records(fixture)).toEqual(['Declined: Save note']);
    expect(el(fixture).querySelector<HTMLElement>('.chat-approval-record')!.dataset['verdict']).toBe('declined');
  });

  it('keeps the record when the run continues with another message', () => {
    const fixture = create();
    click(fixture, 'Save note');
    fixture.componentInstance.agent.messages.update((m) => [...m, assistant('a2')]);
    fixture.detectChanges();
    const record = el(fixture).querySelector<HTMLElement>('.chat-approval-record')!;
    expect(record.textContent!.trim()).toBe('Approved: Save note');
    expect(record.nextElementSibling?.tagName.toLowerCase()).toBe('chat-message');
  });

  it('reads just "Approved" when the app named no action', () => {
    const fixture = create((h) => (h.approveLabel = 'Approve'));
    click(fixture, 'Approve');
    expect(records(fixture)).toEqual(['Approved']);
  });

  it('records at the end of the transcript when no assistant message came first', () => {
    const fixture = create((h) => h.agent.messages.set([user('u1')]));
    click(fixture, 'Save note');
    const record = el(fixture).querySelector<HTMLElement>('.chat-approval-record')!;
    expect(record.classList.contains('chat-approval-record--floor')).toBe(true);
    expect(record.textContent!.trim()).toBe('Approved: Save note');
  });

  it('leaves no record for Edit, which keeps the approval open', () => {
    const fixture = create();
    click(fixture, 'Edit');
    expect(records(fixture)).toEqual([]);
    expect(el(fixture).querySelector('.chat-approval-card--inline')).not.toBeNull();
  });

  it('leaves no record for the dialog presentation', () => {
    const fixture = create((h) => (h.presentation = 'dialog'));
    (el(fixture).querySelector('dialog .btn-primary') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(records(fixture)).toEqual([]);
  });

  it('hides records anchored to messages that are no longer in the transcript', () => {
    const fixture = create();
    click(fixture, 'Save note');
    fixture.componentInstance.agent.messages.set([user('other-thread')]);
    fixture.detectChanges();
    expect(records(fixture)).toEqual([]);
  });
});
