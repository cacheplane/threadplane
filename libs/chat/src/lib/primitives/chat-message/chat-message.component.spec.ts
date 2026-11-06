// libs/chat/src/lib/primitives/chat-message/chat-message.component.spec.ts
import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ChatMessageComponent } from './chat-message.component';
import { CitationsResolverService } from '../../markdown/citations-resolver.service';

describe('ChatMessageComponent', () => {
  it('instantiates without error', () => {
    TestBed.configureTestingModule({ providers: [CitationsResolverService] });
    let component!: ChatMessageComponent;
    TestBed.runInInjectionContext(() => {
      component = new ChatMessageComponent();
    });
    expect(component).toBeTruthy();
  });

  it('keeps every host attribute reactive to independent input changes', () => {
    const fixture = TestBed.createComponent(ChatMessageComponent);
    fixture.componentRef.setInput('role', 'user');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const attributes = () => [
      host.getAttribute('data-role'), host.getAttribute('data-current'),
      host.getAttribute('data-streaming'), host.getAttribute('data-prev-role'),
    ];
    expect(attributes()).toEqual(['user', 'false', 'false', null]);
    expect(host.textContent).toContain('You:');
    expect(host.querySelector('.chat-message__bubble')).not.toBeNull();

    fixture.componentRef.setInput('role', 'assistant');
    fixture.componentRef.setInput('current', true);
    fixture.componentRef.setInput('streaming', true);
    fixture.componentRef.setInput('prevRole', 'user');
    fixture.detectChanges();
    expect(fixture.nativeElement).toBe(host);
    expect(attributes()).toEqual(['assistant', 'true', 'true', 'user']);
    expect(fixture.componentInstance.currentStr()).toBe('true');
    expect(fixture.componentInstance.streamingStr()).toBe('true');
    expect(host.textContent).toContain('Assistant:');
    expect(host.querySelector('.chat-message__assistant-body')).not.toBeNull();

    fixture.componentRef.setInput('current', false);
    fixture.detectChanges();
    expect(attributes()).toEqual(['assistant', 'false', 'true', 'user']);
    fixture.componentRef.setInput('streaming', false);
    fixture.detectChanges();
    expect(attributes()).toEqual(['assistant', 'false', 'false', 'user']);
    fixture.componentRef.setInput('prevRole', undefined);
    fixture.detectChanges();
    expect(attributes()).toEqual(['assistant', 'false', 'false', null]);
    fixture.componentRef.setInput('role', 'tool');
    fixture.detectChanges();
    expect(attributes()).toEqual(['tool', 'false', 'false', null]);
    expect(host.querySelector('.chat-message__plain')).not.toBeNull();
    expect(fixture.componentInstance.currentStr()).toBe('false');
    expect(fixture.componentInstance.streamingStr()).toBe('false');
  });
});
