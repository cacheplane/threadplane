import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ChatComponent } from './chat.component';
import { ChatRunActivityTemplateDirective } from './chat-run-activity-template.directive';
import { ChatInterruptTemplateDirective } from './chat-interrupt-template.directive';
import { mockAgent, type MockAgent } from '../../testing/mock-agent';
import { staticDelivery, type Message } from '../../agent';

const user = (id: string, content = 'hello'): Message => ({ id, role: 'user', content, delivery: staticDelivery(id) });
const assistant = (id: string, content = ''): Message => ({ id, role: 'assistant', content, delivery: staticDelivery(id) });

@Component({
  standalone: true,
  imports: [ChatComponent, ChatRunActivityTemplateDirective, ChatInterruptTemplateDirective],
  template: `
    <chat [agent]="agent">
      @if (withRunActivity) {
        <ng-template
          chatRunActivityTemplate
          let-ctxAgent
          let-running="running"
          let-hasAssistantMessage="hasAssistantMessage"
          let-messages="messages"
        >
          <div
            class="run-activity"
            [attr.data-same-agent]="ctxAgent === agent"
            [attr.data-running]="running"
            [attr.data-has-assistant]="hasAssistantMessage"
            [attr.data-messages]="messages.length"
          ></div>
        </ng-template>
      }
      @if (withInterrupt) {
        <ng-template chatInterruptTemplate let-ctxAgent let-interrupt="interrupt">
          <div
            class="interrupt-card"
            [attr.data-same-agent]="ctxAgent === agent"
            [attr.data-interrupt]="interrupt.id"
          ></div>
        </ng-template>
      }
    </chat>
  `,
})
class HostComponent {
  agent: MockAgent = mockAgent({ messages: [user('u1')], withInterrupt: true });
  withRunActivity = true;
  withInterrupt = true;
}

function create(configure: (host: HostComponent) => void = () => undefined): ComponentFixture<HostComponent> {
  const fixture = TestBed.createComponent(HostComponent);
  configure(fixture.componentInstance);
  fixture.detectChanges();
  return fixture;
}

const el = (fixture: ComponentFixture<HostComponent>) => fixture.nativeElement as HTMLElement;

describe('ChatComponent — chatRunActivityTemplate', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
  });

  it('renders while a run is active and has no assistant message, replacing the typing indicator', () => {
    const fixture = create((h) => h.agent.isLoading.set(true));
    const activity = el(fixture).querySelector<HTMLElement>('.run-activity');
    expect(activity).not.toBeNull();
    expect(activity!.dataset['sameAgent']).toBe('true');
    expect(activity!.dataset['running']).toBe('true');
    expect(activity!.dataset['hasAssistant']).toBe('false');
    expect(activity!.dataset['messages']).toBe('0');
    expect(el(fixture).querySelector('chat-typing-indicator')).toBeNull();
    const region = el(fixture).querySelector('.chat-run-activity');
    expect(region?.getAttribute('role')).toBe('status');
    expect(region?.parentElement?.classList.contains('chat-scroll')).toBe(true);
  });

  it('is not shown when the agent is idle', () => {
    const fixture = create();
    expect(el(fixture).querySelector('.run-activity')).toBeNull();
    expect(el(fixture).querySelector('.chat-run-activity')).toBeNull();
  });

  it('hides when the first assistant message of the run arrives', () => {
    const fixture = create((h) => h.agent.isLoading.set(true));
    expect(el(fixture).querySelector('.run-activity')).not.toBeNull();
    fixture.componentInstance.agent.messages.update((m) => [...m, assistant('a1')]);
    fixture.detectChanges();
    expect(el(fixture).querySelector('.run-activity')).toBeNull();
    // Outside its window the default indicator behaves as before.
    expect(el(fixture).querySelector('chat-typing-indicator')).not.toBeNull();
  });

  it('scopes the run to messages after the last user message', () => {
    const fixture = create((h) => {
      h.agent.messages.set([user('u1'), assistant('a1', 'earlier answer'), user('u2', 'next')]);
      h.agent.isLoading.set(true);
    });
    const activity = el(fixture).querySelector<HTMLElement>('.run-activity');
    expect(activity).not.toBeNull();
    expect(activity!.dataset['messages']).toBe('0');
  });

  it('hides when the run ends', () => {
    const fixture = create((h) => h.agent.isLoading.set(true));
    fixture.componentInstance.agent.isLoading.set(false);
    fixture.detectChanges();
    expect(el(fixture).querySelector('.run-activity')).toBeNull();
  });

  it('leaves the default typing indicator unchanged without the template', () => {
    const fixture = create((h) => {
      h.withRunActivity = false;
      h.agent.isLoading.set(true);
    });
    expect(el(fixture).querySelector('.chat-run-activity')).toBeNull();
    const indicator = el(fixture).querySelector('chat-typing-indicator');
    expect(indicator).not.toBeNull();
    expect(indicator!.querySelector('[role="status"]')).not.toBeNull();
  });
});

describe('ChatComponent — chatInterruptTemplate', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
  });

  it('renders the pending interrupt at the end of the transcript', () => {
    const fixture = create((h) => h.agent.interrupt!.set({ id: 'approve-1', value: {}, resumable: true }));
    const card = el(fixture).querySelector<HTMLElement>('.interrupt-card');
    expect(card).not.toBeNull();
    expect(card!.dataset['interrupt']).toBe('approve-1');
    expect(card!.dataset['sameAgent']).toBe('true');
    const region = el(fixture).querySelector('.chat-interrupt-region')!;
    expect(region.getAttribute('role')).toBe('status');
    const scroll = el(fixture).querySelector('.chat-scroll')!;
    expect(region.parentElement).toBe(scroll);
    expect(scroll.lastElementChild).toBe(region);
  });

  it('renders after the run activity', () => {
    const fixture = create((h) => {
      h.agent.isLoading.set(true);
      h.agent.interrupt!.set({ id: 'approve-1', value: {}, resumable: true });
    });
    const run = el(fixture).querySelector('.chat-run-activity')!;
    const pending = el(fixture).querySelector('.chat-interrupt-region')!;
    expect(run.compareDocumentPosition(pending) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is absent when no interrupt is pending', () => {
    const fixture = create();
    expect(el(fixture).querySelector('.interrupt-card')).toBeNull();
    expect(el(fixture).querySelector('.chat-interrupt-region')).toBeNull();
  });

  it('is removed when the interrupt clears', () => {
    const fixture = create((h) => h.agent.interrupt!.set({ id: 'approve-1', value: {}, resumable: true }));
    fixture.componentInstance.agent.interrupt!.set(undefined);
    fixture.detectChanges();
    expect(el(fixture).querySelector('.interrupt-card')).toBeNull();
  });

  it('renders nothing for a pending interrupt without the template', () => {
    const fixture = create((h) => {
      h.withInterrupt = false;
      h.agent.interrupt!.set({ id: 'approve-1', value: {}, resumable: true });
    });
    expect(el(fixture).querySelector('.chat-interrupt-region')).toBeNull();
  });
});

describe('ChatComponent — run-slot scrolling', () => {
  let observers: Array<{ callback: () => void; observed: Element[] }>;
  const original = globalThis.ResizeObserver;

  beforeEach(() => {
    observers = [];
    globalThis.ResizeObserver = class {
      private readonly entry: { callback: () => void; observed: Element[] };
      constructor(callback: () => void) {
        this.entry = { callback, observed: [] };
        observers.push(this.entry);
      }
      observe(target: Element) { this.entry.observed.push(target); }
      unobserve() { return; }
      disconnect() { this.entry.observed = []; }
    } as unknown as typeof ResizeObserver;
    TestBed.configureTestingModule({ imports: [HostComponent] });
  });

  afterEach(() => {
    globalThis.ResizeObserver = original;
  });

  function scrollState(fixture: ComponentFixture<HostComponent>) {
    const scroll = el(fixture).querySelector<HTMLElement>('.chat-scroll')!;
    Object.defineProperty(scroll, 'scrollHeight', { configurable: true, value: 900 });
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 300 });
    return scroll;
  }

  it('observes the new regions and follows them to the bottom while pinned', () => {
    const fixture = create((h) => {
      h.agent.isLoading.set(true);
      h.agent.interrupt!.set({ id: 'approve-1', value: {}, resumable: true });
    });
    fixture.detectChanges();
    const live = observers.find((o) => o.observed.length > 0);
    expect(live?.observed.map((e) => e.className)).toEqual(['chat-run-activity', 'chat-interrupt-region']);
    const scroll = scrollState(fixture);
    scroll.scrollTop = 0;
    live!.callback();
    expect(scroll.scrollTop).toBe(900);
  });

  it('does not move the scroller after the user scrolls up', () => {
    const fixture = create((h) => h.agent.isLoading.set(true));
    fixture.detectChanges();
    const live = observers.find((o) => o.observed.length > 0)!;
    const scroll = scrollState(fixture);
    // The user scrolled up: the view is no longer pinned.
    const chat = fixture.debugElement.query(By.directive(ChatComponent)).componentInstance as unknown as {
      pinned: { set(value: boolean): void };
    };
    chat.pinned.set(false);
    scroll.scrollTop = 0;
    live.callback();
    expect(scroll.scrollTop).toBe(0);
  });
});
