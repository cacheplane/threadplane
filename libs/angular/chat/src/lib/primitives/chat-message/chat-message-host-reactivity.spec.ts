import { beforeEach, describe, expect, it } from 'vitest';
import { computed, isSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChatMessageComponent } from './chat-message.component';

describe('Chat message host input scheduling', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [ChatMessageComponent] }));
  it('updates all host attributes through actual input scheduling and preserves public computed signals', async () => {
    const fixture = TestBed.createComponent(ChatMessageComponent);
    fixture.componentRef.setInput('role', 'user');
    fixture.detectChanges(); await fixture.whenStable();
    const message = fixture.componentInstance, host = fixture.nativeElement as HTMLElement;
    const publicState = computed(() => `${message.role()}:${message.currentStr()}:${message.streamingStr()}:${message.prevRole()}`);
    expect(isSignal(message.role)).toBe(true);
    expect(isSignal(message.currentStr)).toBe(true); expect(isSignal(message.streamingStr)).toBe(true);
    expect(publicState()).toBe('user:false:false:undefined');
    expect(host.getAttribute('data-role')).toBe('user');
    expect(host.getAttribute('data-current')).toBe('false'); expect(host.getAttribute('data-streaming')).toBe('false');
    expect(host.getAttribute('data-prev-role')).toBeNull();
    fixture.componentRef.setInput('role', 'assistant');
    fixture.componentRef.setInput('prevRole', 'user');
    fixture.componentRef.setInput('current', true); fixture.componentRef.setInput('streaming', true);
    expect(publicState()).toBe('assistant:true:true:user');
    // No detectChanges after input writes: verify genuine framework scheduling.
    await fixture.whenStable();
    expect(host.getAttribute('data-role')).toBe('assistant'); expect(host.getAttribute('data-prev-role')).toBe('user');
    expect(host.getAttribute('data-current')).toBe('true'); expect(host.getAttribute('data-streaming')).toBe('true');
    fixture.componentRef.setInput('role', 'tool'); fixture.componentRef.setInput('prevRole', undefined);
    fixture.componentRef.setInput('current', false); fixture.componentRef.setInput('streaming', false);
    expect(publicState()).toBe('tool:false:false:undefined');
    await fixture.whenStable();
    expect(host.getAttribute('data-role')).toBe('tool'); expect(host.getAttribute('data-prev-role')).toBeNull();
    expect(host.getAttribute('data-current')).toBe('false'); expect(host.getAttribute('data-streaming')).toBe('false');
    fixture.destroy();
  });
});
