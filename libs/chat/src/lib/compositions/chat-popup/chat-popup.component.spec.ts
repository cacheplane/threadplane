// libs/chat/src/lib/compositions/chat-popup/chat-popup.component.spec.ts
import { Component, input, output } from '@angular/core';
import { By } from '@angular/platform-browser';
import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { Agent } from '../../agent';
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
