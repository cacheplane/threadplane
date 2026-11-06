import { Component, inject, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it } from 'vitest';
import { views } from '@threadplane/render';
import { ChatComponent } from './chat.component';
import { ChatMessageListComponent } from '../../primitives/chat-message-list/chat-message-list.component';
import { CHAT_LIFECYCLE } from '../../lifecycle';
import { mockAgent } from '../../testing/mock-agent';
import { staticDelivery } from '../../agent';

@Component({
  standalone: true,
  selector: 'chat-dynamic-view-injection-probe',
  template: `{{ query() }}`,
})
class DynamicViewInjectionProbe {
  readonly query = input('');
  readonly chat = inject(ChatComponent);
  readonly lifecycle = inject(CHAT_LIFECYCLE);
  readonly list = inject(ChatMessageListComponent, { optional: true });
}

describe('dynamic tool-view declaration injection contract', () => {
  it('retains Chat and lifecycle injection and the original optional list scope', async () => {
    const fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput(
      'agent',
      mockAgent({
        messages: [
          {
            id: 'a',
            role: 'assistant',
            content: 'tool answer',
            toolCallIds: ['tool'],
            delivery: staticDelivery('g'),
          },
        ],
        toolCalls: [
          {
            id: 'tool',
            name: 'lookup',
            args: { query: 'dynamic view' },
            status: 'running',
          },
        ],
      })
    );
    fixture.componentRef.setInput(
      'views',
      views({ lookup: DynamicViewInjectionProbe })
    );
    fixture.detectChanges();
    await fixture.whenStable();
    const probe = fixture.debugElement.query(
      By.directive(DynamicViewInjectionProbe)
    ).componentInstance as DynamicViewInjectionProbe;
    expect(probe.chat).toBe(fixture.componentInstance);
    expect(probe.lifecycle).toBe(
      fixture.debugElement.injector.get(CHAT_LIFECYCLE)
    );
    expect(fixture.nativeElement.textContent).toContain('dynamic view');
    process.stdout.write(
      `${JSON.stringify({
        schema: 'dynamic-tool-view-injection-observation-v1',
        chatAndLifecyclePreserved: true,
        optionalListPresent: probe.list !== null,
      })}\n`
    );
    // Actual stock036 source exposes its list to dynamically created view
    // components, unlike consumer-declared activity/tool templates.
    expect(probe.list).toBe(
      fixture.debugElement.query(By.directive(ChatMessageListComponent))
        .componentInstance
    );
    expect(probe.list).toBeInstanceOf(ChatMessageListComponent);
  });
});
