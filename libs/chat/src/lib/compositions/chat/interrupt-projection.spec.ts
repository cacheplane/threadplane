import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { staticDelivery } from '../../agent';
import { mockAgent } from '../../testing/mock-agent';
import { ChatPopupComponent } from '../chat-popup/chat-popup.component';
import { ChatSidebarComponent } from '../chat-sidebar/chat-sidebar.component';
import { ChatInterruptTemplateDirective } from './chat-interrupt-template.directive';

@Component({
  standalone: true,
  imports: [ChatPopupComponent, ChatSidebarComponent, ChatInterruptTemplateDirective],
  template: `
    @if (mode === 'popup') {
      <chat-popup [agent]="agent" [open]="true">
        <ng-template chatInterruptTemplate let-current let-interrupt="interrupt">
          <button class="approval" (click)="approve(current)">{{ interrupt.value.reason }}</button>
        </ng-template>
      </chat-popup>
    } @else {
      <chat-sidebar [agent]="agent" [open]="true">
        <p class="app-content">Application content</p>
        <ng-template chatInterruptTemplate let-current let-interrupt="interrupt">
          <button class="approval" (click)="approve(current)">{{ interrupt.value.reason }}</button>
        </ng-template>
      </chat-sidebar>
    }
  `,
})
class InterruptHost {
  mode: 'popup' | 'sidebar' = 'popup';
  readonly agent = mockAgent({
    withInterrupt: true,
    messages: [{ id: 'ask', role: 'user', content: 'Review the plan', delivery: staticDelivery('ask') }],
  });
  approvedAgent: unknown;
  approve(agent: unknown): void { this.approvedAgent = agent; }
}

@Component({
  standalone: true,
  imports: [ChatPopupComponent, ChatSidebarComponent],
  template: `
    @if (mode === 'popup') {
      <chat-popup [agent]="agent" [open]="true" />
    } @else {
      <chat-sidebar [agent]="agent" [open]="true" />
    }
  `,
})
class NoInterruptTemplateHost extends InterruptHost {}

describe.each(['popup', 'sidebar'] as const)('%s interrupt projection', (mode) => {
  it('keeps the default interrupt region absent when no template was supplied', () => {
    TestBed.configureTestingModule({ imports: [NoInterruptTemplateHost] });
    const fixture = TestBed.createComponent(NoInterruptTemplateHost);
    fixture.componentInstance.mode = mode;
    fixture.componentInstance.agent.interrupt!.set({ id: 'pending', value: 'Review needed', resumable: true });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.chat-interrupt-region')).toBeNull();
  });

  it('renders the pending decision in the transcript with its context and removes it when resolved', () => {
    TestBed.configureTestingModule({ imports: [InterruptHost] });
    const fixture = TestBed.createComponent(InterruptHost);
    const host = fixture.componentInstance;
    host.mode = mode;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.approval')).toBeNull();

    host.agent.interrupt!.set({ id: 'pending', value: { reason: 'Approve this plan' }, resumable: true });
    fixture.detectChanges();
    const decisions = fixture.nativeElement.querySelectorAll('.chat-scroll .approval');
    expect(decisions).toHaveLength(1);
    expect(decisions[0].textContent).toBe('Approve this plan');
    expect(decisions[0].closest('chat-message')).toBeNull();
    decisions[0].click();
    expect(host.approvedAgent).toBe(host.agent);
    if (mode === 'sidebar') {
      expect(fixture.nativeElement.querySelector('.chat-sidebar__content .app-content')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('.chat-sidebar__content .approval')).toBeNull();
    }

    host.agent.interrupt!.set(undefined);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.approval')).toBeNull();
  });
});
