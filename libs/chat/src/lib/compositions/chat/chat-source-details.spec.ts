import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ChatComponent } from './chat.component';
import { mockAgent } from '../../testing/mock-agent';
import { staticDelivery } from '../../agent';
describe('rich response technical Details', () => {
  it('keeps the render surface mounted independently of collapsed source inspection', () => {
    const source = JSON.stringify({
      root: 'text',
      elements: { text: { type: 'Text', props: { text: 'Visible result' } } },
    });
    TestBed.configureTestingModule({ imports: [ChatComponent] });
    const fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput(
      'agent',
      mockAgent({
        messages: [
          {
            id: 'answer',
            role: 'assistant',
            content: source,
            delivery: staticDelivery('answer'),
          },
        ],
      })
    );
    fixture.detectChanges();
    const details: HTMLDetailsElement = fixture.nativeElement.querySelector(
      '.chat-source-details'
    );
    expect(details).toBeTruthy();
    expect(details.open).toBe(false);
    expect(details.textContent).toContain(source);
    const rich = fixture.nativeElement.querySelector('chat-generative-ui');
    expect(rich).toBeTruthy();
    expect(rich.closest('details')).toBeNull();
    details.open = true;
    fixture.detectChanges();
    details.open = false;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('chat-generative-ui')).toBe(
      rich
    );
  });
});
