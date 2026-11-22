// libs/angular/chat/src/lib/primitives/chat-message/chat-message.component.spec.ts
import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ChatMessageComponent } from './chat-message.component';
import { CitationsResolverService } from '@threadplane/angular/chat/shared';

describe('ChatMessageComponent', () => {
  it('instantiates without error', () => {
    TestBed.configureTestingModule({ providers: [CitationsResolverService] });
    let component!: ChatMessageComponent;
    TestBed.runInInjectionContext(() => {
      component = new ChatMessageComponent();
    });
    expect(component).toBeTruthy();
  });
});
