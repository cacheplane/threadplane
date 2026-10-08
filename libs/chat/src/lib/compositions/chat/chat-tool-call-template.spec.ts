import { describe, it, expect, beforeEach } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChatComponent } from './chat.component';
import { ChatActivityTemplateDirective } from './chat-activity-template.directive';
import { ChatToolCallsComponent } from '../../primitives/chat-tool-calls/chat-tool-calls.component';
import { ChatToolCallTemplateDirective } from '../../primitives/chat-tool-calls/chat-tool-call-template.directive';
import { mockAgent, type MockAgent } from '../../testing/mock-agent';
import { staticDelivery, type ToolCall } from '../../agent';

function buildAgent(): MockAgent {
  return mockAgent({
    messages: [
      { id: 'u1', role: 'user', content: 'find things', delivery: staticDelivery('u1') },
      {
        id: 'a1',
        role: 'assistant',
        content: 'Looking.',
        toolCallIds: ['c_search', 'c_read'],
        delivery: staticDelivery('a1'),
      },
    ],
    toolCalls: [
      { id: 'c_search', name: 'search_web', args: { q: 'x' }, status: 'complete', result: 'r' },
      { id: 'c_read', name: 'read_file', args: {}, status: 'running' },
    ] as ToolCall[],
  });
}

@Component({
  standalone: true,
  imports: [ChatComponent, ChatActivityTemplateDirective, ChatToolCallsComponent, ChatToolCallTemplateDirective],
  template: `
    <chat [agent]="agent">
      @if (withActivity) {
        <ng-template chatActivityTemplate let-message let-ctxAgent="agent">
          <div class="activity">
            @if (nestToolCalls) {
              <chat-tool-calls [agent]="ctxAgent" [message]="message">
                <ng-template chatToolCallTemplate="search_web" let-call>
                  <span class="nested-tpl">{{ call.id }}</span>
                </ng-template>
              </chat-tool-calls>
            }
          </div>
        </ng-template>
      }
      @if (withNamed) {
        <ng-template chatToolCallTemplate="search_web" let-call let-status="status">
          <span class="named-tpl" [attr.data-status]="status">{{ call.id }}</span>
        </ng-template>
      }
      @if (withWildcard) {
        <ng-template chatToolCallTemplate="*" let-call>
          <span class="wildcard-tpl">{{ call.id }}</span>
        </ng-template>
      }
    </chat>
  `,
})
class HostComponent {
  agent: MockAgent = buildAgent();
  withActivity = false;
  nestToolCalls = false;
  withNamed = false;
  withWildcard = false;
}

function render(configure: (host: HostComponent) => void): HTMLElement {
  const fixture = TestBed.createComponent(HostComponent);
  configure(fixture.componentInstance);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

function texts(host: HTMLElement, selector: string): string[] {
  return [...host.querySelectorAll(selector)].map((el) => el.textContent?.trim() ?? '');
}

describe('ChatComponent — chatToolCallTemplate projected through <chat>', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
  });

  it('renders a named template for its tool and the default card for the rest', () => {
    const host = render((h) => { h.withNamed = true; });
    expect(texts(host, '.named-tpl')).toEqual(['c_search']);
    expect(host.querySelector('.named-tpl')?.getAttribute('data-status')).toBe('complete');
    expect(host.querySelectorAll('chat-tool-call-card').length).toBe(1);
  });

  it('renders a wildcard template for every tool call', () => {
    const host = render((h) => { h.withWildcard = true; });
    expect(texts(host, '.wildcard-tpl')).toEqual(['c_search', 'c_read']);
    expect(host.querySelector('chat-tool-call-card')).toBeNull();
  });

  it('prefers the named template over the wildcard', () => {
    const host = render((h) => { h.withNamed = true; h.withWildcard = true; });
    expect(texts(host, '.named-tpl')).toEqual(['c_search']);
    expect(texts(host, '.wildcard-tpl')).toEqual(['c_read']);
  });

  it('renders default cards when no template is projected', () => {
    const host = render(() => undefined);
    expect(host.querySelectorAll('chat-tool-call-card').length).toBe(2);
  });

  it('does not use projected tool-call templates while an activity template is present', () => {
    const host = render((h) => { h.withActivity = true; h.withNamed = true; h.withWildcard = true; });
    expect(host.querySelectorAll('.activity').length).toBe(1);
    expect(host.querySelector('.named-tpl')).toBeNull();
    expect(host.querySelector('.wildcard-tpl')).toBeNull();
  });

  it('keeps per-tool templates registered on a <chat-tool-calls> inside the activity template', () => {
    const host = render((h) => { h.withActivity = true; h.nestToolCalls = true; });
    expect(texts(host, '.nested-tpl')).toEqual(['c_search']);
    expect(host.querySelectorAll('chat-tool-call-card').length).toBe(1);
  });
});
