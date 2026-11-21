// libs/angular/chat/src/lib/compositions/chat-popup/chat-popup.component.spec.ts
import { Component, input, output } from '@angular/core';
import { By } from '@angular/platform-browser';
import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { Agent } from '../../agent';
import { mockAgent } from '../../testing/mock-agent';
import { ChatInterruptTemplateDirective } from '../chat/chat-interrupt-template.directive';
import { ChatComponent } from '../chat/chat.component';
import { ChatPopupComponent } from './chat-popup.component';

@Component({
  selector: 'chat',
  standalone: true,
  template: '<ng-content />',
})
class PopupTestChatComponent {
  readonly agent = input<unknown>();
  readonly views = input<unknown>();
  readonly clientTools = input<unknown>();
  readonly modelOptions = input<unknown>();
  readonly showModelPicker = input<unknown>();
  readonly selectedModel = input<unknown>();
  readonly rate = output<{ messageIndex: number; rating: 'up' | 'down' }>();
  readonly regenerate = output<void>();
  readonly messageCopy = output<{ messageIndex: number; content: string }>();
  readonly selectedModelChange = output<string>();
}

function createPopupFixture() {
  TestBed.configureTestingModule({ imports: [ChatPopupComponent] });
  TestBed.overrideComponent(ChatPopupComponent, {
    remove: { imports: [ChatComponent] },
    add: { imports: [PopupTestChatComponent] },
  });

  const fixture = TestBed.createComponent(ChatPopupComponent);
  fixture.componentRef.setInput('agent', {} as Agent);
  fixture.detectChanges();

  return {
    fixture,
    innerChat: fixture.debugElement.query(By.directive(PopupTestChatComponent))
      .componentInstance as PopupTestChatComponent,
  };
}

describe('ChatPopupComponent', () => {
  it('makes closed content inert and returns focused drafts to the launcher on close', () => {
    const { fixture } = createPopupFixture();
    const host = fixture.nativeElement as HTMLElement;
    const panel = host.querySelector<HTMLElement>('.chat-popup__window')!;
    const close = host.querySelector<HTMLButtonElement>('.chat-popup__close')!;
    const launcher = host.querySelector<HTMLButtonElement>('.chat-popup__launcher button')!;
    const draft = document.createElement('textarea');
    draft.value = 'Keep this draft';
    panel.append(draft);
    expect(panel.hasAttribute('inert')).toBe(true);
    fixture.componentInstance.openWindow();
    fixture.detectChanges();
    expect(panel.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(close);
    draft.focus();
    fixture.componentInstance.closeWindow();
    fixture.detectChanges();
    expect(document.activeElement).toBe(launcher);
    expect(panel.hasAttribute('inert')).toBe(true);
    expect(draft.value).toBe('Keep this draft');
  });

  it('tracks keyboard height and Safari pan without resizing during pinch zoom', () => {
    const previous = Object.getOwnPropertyDescriptor(window, 'visualViewport');
    const viewport = Object.assign(new EventTarget(), { height: 714, offsetTop: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    try {
      const { fixture } = createPopupFixture();
      const host = fixture.nativeElement as HTMLElement;
      expect(host.style.getPropertyValue('--tplane-chat-viewport-height')).toBe('714px');
      viewport.height = 377;
      viewport.offsetTop = 206;
      viewport.dispatchEvent(new Event('resize'));
      expect(host.style.getPropertyValue('--tplane-chat-viewport-height')).toBe('377px');
      expect(host.style.getPropertyValue('--tplane-chat-viewport-top')).toBe('206px');
      viewport.offsetTop = 309;
      viewport.dispatchEvent(new Event('scroll'));
      expect(host.style.getPropertyValue('--tplane-chat-viewport-top')).toBe('309px');
      viewport.scale = 2;
      viewport.height = 200;
      viewport.dispatchEvent(new Event('resize'));
      expect(host.style.getPropertyValue('--tplane-chat-viewport-height')).toBe('377px');
      fixture.destroy();
      viewport.scale = 1;
      viewport.height = 714;
      viewport.dispatchEvent(new Event('resize'));
      expect(host.style.getPropertyValue('--tplane-chat-viewport-height')).toBe('377px');
    } finally {
      if (previous) Object.defineProperty(window, 'visualViewport', previous);
      else Reflect.deleteProperty(window, 'visualViewport');
    }
  });

  it('class is defined and imports resolve', () => {
    expect(ChatPopupComponent).toBeDefined();
    expect(typeof ChatPopupComponent).toBe('function');
  });

  it('toggle/openWindow/closeWindow flip the open model', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const popup = new ChatPopupComponent();
      expect(popup.open()).toBe(false);
      popup.toggle();
      expect(popup.open()).toBe(true);
      popup.toggle();
      expect(popup.open()).toBe(false);
      popup.openWindow();
      expect(popup.open()).toBe(true);
      popup.closeWindow();
      expect(popup.open()).toBe(false);
    });
  });

  it('forwards rate events from the inner chat unchanged', () => {
    const { fixture, innerChat } = createPopupFixture();
    const rateEvents: Array<{ messageIndex: number; rating: 'up' | 'down' }> = [];
    fixture.componentInstance.rate.subscribe((event) => rateEvents.push(event));
    innerChat.rate.emit({ messageIndex: 2, rating: 'down' });

    expect(rateEvents).toEqual([{ messageIndex: 2, rating: 'down' }]);
  });

  it('forwards regenerate events from the inner chat', () => {
    const { fixture, innerChat } = createPopupFixture();
    let regenerateCount = 0;
    fixture.componentInstance.regenerate.subscribe(() => regenerateCount++);

    innerChat.regenerate.emit();

    expect(regenerateCount).toBe(1);
  });

  it('forwards message copy events from the inner chat unchanged', () => {
    const { fixture, innerChat } = createPopupFixture();
    const copyEvents: Array<{ messageIndex: number; content: string }> = [];
    fixture.componentInstance.messageCopy.subscribe((event) => copyEvents.push(event));
    const event = { messageIndex: 3, content: 'copied text' };

    innerChat.messageCopy.emit(event);

    expect(copyEvents).toEqual([event]);
  });
});

@Component({
  standalone: true,
  imports: [ChatPopupComponent, ChatInterruptTemplateDirective],
  template: `
    <chat-popup [agent]="agent" [open]="true">
      <ng-template chatInterruptTemplate let-ctxAgent let-interrupt="interrupt" let-interrupts="interrupts">
        <div
          class="interrupt-card"
          [attr.data-interrupt]="interrupt.id"
          [attr.data-batch]="ids(interrupts)"
          [attr.data-same-agent]="ctxAgent === agent"
        ></div>
      </ng-template>
    </chat-popup>
  `,
})
class InterruptTemplateHost {
  agent = mockAgent({ messages: [{ id: 'u1', role: 'user', content: 'Refund both' }] });
  ids(interrupts: readonly { id: string }[]): string {
    return interrupts.map((entry) => entry.id).join(',');
  }
}

describe('ChatPopupComponent — projected chatInterruptTemplate', () => {
  it('forwards the agent, the first interrupt and the whole pending batch to the inner chat', () => {
    TestBed.configureTestingModule({ imports: [InterruptTemplateHost] });
    const fixture = TestBed.createComponent(InterruptTemplateHost);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.interrupt-card')).toBeNull();

    fixture.componentInstance.agent.interrupts.set([
      { id: 'approve-1', value: {} },
      { id: 'approve-2', value: {} },
    ]);
    fixture.detectChanges();
    const card = root.querySelector<HTMLElement>('.chat-interrupt-region .interrupt-card');
    expect(card).not.toBeNull();
    expect(card?.dataset['interrupt']).toBe('approve-1');
    expect(card?.dataset['batch']).toBe('approve-1,approve-2');
    expect(card?.dataset['sameAgent']).toBe('true');

    fixture.componentInstance.agent.interrupts.set([{ id: 'approve-2', value: {} }]);
    fixture.detectChanges();
    const next = root.querySelector<HTMLElement>('.interrupt-card');
    expect(next?.dataset['interrupt']).toBe('approve-2');
    expect(next?.dataset['batch']).toBe('approve-2');

    fixture.componentInstance.agent.interrupts.set([]);
    fixture.detectChanges();
    expect(root.querySelector('.interrupt-card')).toBeNull();
    fixture.destroy();
  });
});
