import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { signal, computed, Component, viewChildren } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { mockAgent } from '../../testing/mock-agent';
import type { Agent, AgentPlan, Message, ToolCall } from '../../agent';
import { staticDelivery } from '../../agent';
import { ChatToolCallsComponent } from './chat-tool-calls.component';
import { ChatToolCallTemplateDirective } from './chat-tool-call-template.directive';
import { ChatToolResultTemplateDirective } from './chat-tool-result-template.directive';
import type { ToolActivityInfo, ToolActivityOutcome } from '../chat-tool-activity/chat-tool-activity.component';

describe('ToolCallsComponent — toolCalls computed', () => {
  it('returns agent.toolCalls() when no message is provided', () => {
    const mockToolCalls: ToolCall[] = [
      { id: 'call_1', name: 'get_weather', args: { city: 'NYC' }, status: 'complete', result: 'sunny' },
    ];
    const agent = mockAgent({ toolCalls: mockToolCalls });

    const agent$ = signal(agent);
    const toolCalls = computed(() => agent$().toolCalls());

    expect(toolCalls()).toHaveLength(1);
    expect(toolCalls()[0].id).toBe('call_1');
  });

  it('returns agent.toolCalls() when message is a user message (no tool_use blocks)', () => {
    const agent = mockAgent();
    const msg: Message = {
      id: '1',
      role: 'user',
      content: 'hello',
      delivery: staticDelivery('1'),
    };

    const agent$ = signal(agent);
    const message$ = signal<Message | undefined>(msg);

    const toolCalls = computed((): ToolCall[] => {
      const m = message$();
      if (m && m.role === 'assistant' && Array.isArray(m.content)) {
        const blocks = m.content.filter((b: any) => b.type === 'tool_use') as Array<{
          type: 'tool_use'; id: string; name: string; args: unknown;
        }>;
        const all = agent$().toolCalls();
        return blocks
          .map(b => all.find(tc => tc.id === b.id))
          .filter((x): x is ToolCall => !!x);
      }
      return agent$().toolCalls();
    });

    expect(toolCalls()).toHaveLength(0);
  });

  it('returns matched ToolCalls when message has tool_use content blocks', () => {
    const mockToolCalls: ToolCall[] = [
      { id: 'call_2', name: 'search', args: { query: 'test' }, status: 'complete', result: 'results' },
    ];
    const agent = mockAgent({ toolCalls: mockToolCalls });

    const msg: Message = {
      id: '2',
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'call_2', name: 'search', args: { query: 'test' } }],
      delivery: staticDelivery('2'),
    };

    const agent$ = signal(agent);
    const message$ = signal<Message | undefined>(msg);

    const toolCalls = computed((): ToolCall[] => {
      const m = message$();
      if (m && m.role === 'assistant' && Array.isArray(m.content)) {
        const blocks = m.content.filter((b: any) => b.type === 'tool_use') as Array<{
          type: 'tool_use'; id: string; name: string; args: unknown;
        }>;
        const all = agent$().toolCalls();
        return blocks
          .map(b => all.find(tc => tc.id === b.id))
          .filter((x): x is ToolCall => !!x);
      }
      return agent$().toolCalls();
    });

    expect(toolCalls()).toHaveLength(1);
    expect(toolCalls()[0].id).toBe('call_2');
    expect(toolCalls()[0].name).toBe('search');
  });

  it('toolCalls updates reactively when agent changes', () => {
    const emptyAgent = mockAgent();
    const loadedAgent = mockAgent({
      toolCalls: [{ id: 'call_3', name: 'calculator', args: {}, status: 'complete' }],
    });

    const agent$ = signal(emptyAgent);
    const toolCalls = computed(() => agent$().toolCalls());

    expect(toolCalls()).toHaveLength(0);
    agent$.set(loadedAgent);
    expect(toolCalls()).toHaveLength(1);
  });
});

@Component({
  standalone: true,
  imports: [ChatToolCallsComponent, ChatToolCallTemplateDirective],
  template: `
    <chat-tool-calls [agent]="agent" [grouping]="grouping" [groupRelated]="groupRelated">
      @if (registerSearchWeb) {
        <ng-template chatToolCallTemplate="search_web" let-call>
          <span data-tpl="search_web">{{ call.name }}-{{ call.id }}</span>
        </ng-template>
      }
      @if (registerWildcard) {
        <ng-template chatToolCallTemplate="*" let-call>
          <span data-tpl="wildcard">{{ call.name }}-{{ call.id }}</span>
        </ng-template>
      }
    </chat-tool-calls>
  `,
})
class GroupingHost {
  agent!: Agent;
  grouping: 'auto' | 'none' = 'auto';
  groupRelated = false;
  registerSearchWeb = false;
  registerWildcard = false;
}

describe('ChatToolCallsComponent — grouping + per-tool templates', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [GroupingHost] });
  });

  it('groups three sequential search_web calls into one strip', () => {
    const fixture = TestBed.createComponent(GroupingHost);
    fixture.componentInstance.agent = mockAgent({
      toolCalls: [
        { id: 'a', name: 'search_web', args: {}, status: 'complete', result: 'r' },
        { id: 'b', name: 'search_web', args: {}, status: 'complete', result: 'r' },
        { id: 'c', name: 'search_web', args: {}, status: 'complete', result: 'r' },
      ],
    });
    fixture.detectChanges();
    const strips = fixture.nativeElement.querySelectorAll('[data-group="true"]');
    expect(strips.length).toBe(1);
    expect(strips[0].textContent).toContain('Used 3 tools');
  });

  it('does not group when names differ', () => {
    const fixture = TestBed.createComponent(GroupingHost);
    fixture.componentInstance.agent = mockAgent({
      toolCalls: [
        { id: 'a', name: 'search_web', args: {}, status: 'complete' },
        { id: 'b', name: 'read_file', args: {}, status: 'complete' },
        { id: 'c', name: 'search_web', args: {}, status: 'complete' },
      ],
    });
    fixture.detectChanges();
    const strips = fixture.nativeElement.querySelectorAll('[data-group="true"]');
    expect(strips.length).toBe(0);
    const cards = fixture.nativeElement.querySelectorAll('chat-tool-activity');
    expect(cards.length).toBe(3);
  });

  it('keeps custom templates between separate compact built-in groups', () => {
    const fixture = TestBed.createComponent(GroupingHost);
    fixture.componentInstance.groupRelated = true;
    fixture.componentInstance.registerSearchWeb = true;
    fixture.componentInstance.agent = mockAgent({ toolCalls: [
      { id: 'a', name: 'read_file', args: {}, status: 'running' },
      { id: 'custom', name: 'search_web', args: {}, status: 'running' },
      { id: 'b', name: 'read_file', args: {}, status: 'running' },
    ] });
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelectorAll('[data-group="true"]')).toHaveLength(2);
    expect(root.querySelector('[data-tpl="search_web"]')!.closest('.ctc__group')).toBeNull();
  });


  it('does not group when [grouping]="none"', () => {
    const fixture = TestBed.createComponent(GroupingHost);
    fixture.componentInstance.grouping = 'none';
    fixture.componentInstance.agent = mockAgent({
      toolCalls: [
        { id: 'a', name: 'search_web', args: {}, status: 'complete' },
        { id: 'b', name: 'search_web', args: {}, status: 'complete' },
      ],
    });
    fixture.detectChanges();
    const strips = fixture.nativeElement.querySelectorAll('[data-group="true"]');
    expect(strips.length).toBe(0);
  });

  it('routes each call through a per-tool template when registered', () => {
    const fixture = TestBed.createComponent(GroupingHost);
    fixture.componentInstance.registerSearchWeb = true;
    fixture.componentInstance.agent = mockAgent({
      toolCalls: [
        { id: 'a', name: 'search_web', args: {}, status: 'complete' },
        { id: 'b', name: 'search_web', args: {}, status: 'complete' },
      ],
    });
    fixture.detectChanges();
    const tplNodes = fixture.nativeElement.querySelectorAll('[data-tpl="search_web"]');
    expect(tplNodes.length).toBe(2);
    expect(fixture.nativeElement.querySelectorAll('[data-group="true"]').length).toBe(0);
    expect(fixture.nativeElement.querySelectorAll('chat-tool-activity').length).toBe(0);
  });

  it('falls back to wildcard "*" template when no per-tool template matches', () => {
    const fixture = TestBed.createComponent(GroupingHost);
    fixture.componentInstance.registerWildcard = true;
    fixture.componentInstance.agent = mockAgent({
      toolCalls: [
        { id: 'a', name: 'read_file', args: {}, status: 'complete' },
      ],
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[data-tpl="wildcard"]').length).toBe(1);
    expect(fixture.nativeElement.querySelectorAll('chat-tool-activity').length).toBe(0);
  });

  it('per-tool template wins over wildcard for matching name', () => {
    const fixture = TestBed.createComponent(GroupingHost);
    fixture.componentInstance.registerSearchWeb = true;
    fixture.componentInstance.registerWildcard = true;
    fixture.componentInstance.agent = mockAgent({
      toolCalls: [
        { id: 'a', name: 'search_web', args: {}, status: 'complete' },
        { id: 'b', name: 'read_file', args: {}, status: 'complete' },
      ],
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[data-tpl="search_web"]').length).toBe(1);
    expect(fixture.nativeElement.querySelectorAll('[data-tpl="wildcard"]').length).toBe(1);
  });
});

describe('summarize-group label registry', () => {
  let summarize: typeof import('./group-summary').summarizeGroup;
  beforeEach(async () => {
    summarize = (await import('./group-summary')).summarizeGroup;
  });

  it('does not guess resource kinds from search prefixes', () => {
    expect(summarize('search_web', 5)).toBe('5 tool activities');
    expect(summarize('search_files', 1)).toBe('1 tool activity');
  });

  it('uses a truthful count for generate prefixes', () => {
    expect(summarize('generate_image', 3)).toBe('3 tool activities');
  });

  it('uses a truthful count for unknown names', () => {
    expect(summarize('foo', 4)).toBe('4 tool activities');
  });
});

import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import type { Agent, ToolCall } from '../../agent';
import { ChatToolCallsComponent } from './chat-tool-calls.component';

function makeStubAgent(toolCalls: ToolCall[]): Agent {
  return {
    messages: signal([]),
    status: signal('idle'),
    isLoading: signal(false),
    error: signal(undefined),
    toolCalls: signal(toolCalls),
    state: signal({}),
    interrupt: signal(undefined),
    subagents: signal(new Map()),
    events$: { subscribe: () => ({ unsubscribe: () => undefined }) },
    submit: () => Promise.resolve(),
    stop: () => undefined,
  } as unknown as Agent;
}

const mkCall = (name: string, id: string): ToolCall => ({
  id,
  name,
  args: {},
  status: 'complete',
});

@Component({
  standalone: true,
  imports: [ChatToolCallsComponent],
  template: `<chat-tool-calls [agent]="agent" [excludeToolNames]="excluded" />`,
})
class FilterHost {
  agent = makeStubAgent([
    mkCall('generate_a2ui_schema', 'tc-1'),
    mkCall('search_documents', 'tc-2'),
    mkCall('research', 'tc-3'),
  ]);
  excluded: readonly string[] = [];
}

describe('ChatToolCallsComponent — excludeToolNames filter', () => {
  it('renders all groups when excludeToolNames is empty (default)', () => {
    TestBed.configureTestingModule({ imports: [FilterHost] });
    const fx = TestBed.createComponent(FilterHost);
    fx.detectChanges();
    const text = fx.nativeElement.textContent ?? '';
    expect(text).toContain('search_documents');
    expect(text).toContain('research');
  });

  it('omits a group whose name is in excludeToolNames', () => {
    TestBed.configureTestingModule({ imports: [FilterHost] });
    const fx = TestBed.createComponent(FilterHost);
    fx.componentInstance.excluded = ['generate_a2ui_schema'];
    fx.detectChanges();
    const text = fx.nativeElement.textContent ?? '';
    expect(text).not.toContain('generate_a2ui_schema');
    expect(text).toContain('search_documents');
    expect(text).toContain('research');
  });

  it('omits ALL groups when every tool name is excluded', () => {
    TestBed.configureTestingModule({ imports: [FilterHost] });
    const fx = TestBed.createComponent(FilterHost);
    fx.componentInstance.excluded = [
      'generate_a2ui_schema',
      'search_documents',
      'research',
    ];
    fx.detectChanges();
    const text = fx.nativeElement.textContent?.trim() ?? '';
    expect(text).not.toContain('generate_a2ui_schema');
    expect(text).not.toContain('search_documents');
    expect(text).not.toContain('research');
  });
});

describe('ChatToolCallsComponent — breathing room before downstream content', () => {
  it('host has bottom margin >= 16px so the next sibling gets clear separation', () => {
    TestBed.configureTestingModule({ imports: [FilterHost] });
    const fx = TestBed.createComponent(FilterHost);
    fx.detectChanges();
    const host = fx.nativeElement.querySelector('chat-tool-calls') as HTMLElement;
    document.body.appendChild(host);
    const computed = getComputedStyle(host);
    const marginBottom = parseFloat(computed.marginBottom || '0');
    expect(marginBottom).toBeGreaterThanOrEqual(16);
    document.body.removeChild(host);
  });
});

import type { Message as ChatMessage } from '../../agent';
import type { Subagent } from '../../agent/subagent';

@Component({
  standalone: true,
  imports: [ChatToolCallsComponent],
  template: `<chat-tool-calls [agent]="agent" [message]="message" />`,
})
class SubagentHost {
  agent!: Agent;
  message?: ChatMessage;
}

describe('ChatToolCallsComponent — subagent cards anchored to spawning task call', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [SubagentHost] });
  });

  it('renders a subagent card for the spawning task call and a tool-call card for the sibling', () => {
    const agent = mockAgent({
      withSubagents: true,
      toolCalls: [
        { id: 'call_t', name: 'task', args: {}, status: 'success' as never },
        { id: 'call_s', name: 'search', args: {}, status: 'success' as never },
      ],
    });
    const sub: Subagent = {
      toolCallId: 'call_t',
      name: 'research',
      status: signal('running'),
      messages: signal([{
        id: 'm1',
        role: 'assistant',
        content: 'hello from research',
        delivery: staticDelivery('m1'),
      }]),
      state: signal({}),
    };
    agent.subagents!.set(new Map([['call_t', sub]]));

    const fixture = TestBed.createComponent(SubagentHost);
    fixture.componentInstance.agent = agent;
    fixture.componentInstance.message = {
      id: 'a1',
      role: 'assistant',
      content: '',
      toolCallIds: ['call_t', 'call_s'],
      delivery: staticDelivery('a1'),
    };
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('chat-subagent-card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('research');

    // The sibling search call still renders a generic tool-call card.
    const toolCards = fixture.nativeElement.querySelectorAll('chat-tool-activity');
    expect(toolCards.length).toBe(1);

    // The task call does NOT render a generic tool-call card.
    const fullText = fixture.nativeElement.textContent ?? '';
    expect(fullText).toContain('search');
  });

  it('anchors the card by the Subagent.toolCallId FIELD even when the map key differs', () => {
    // The AG-UI adapter keys subagents() by subagentRunId (e.g. `<toolCallId>-sub`
    // for Strands' native SUBAGENT_* events) — only the wrapper's toolCallId
    // field is guaranteed to match the spawning call.
    const agent = mockAgent({
      withSubagents: true,
      toolCalls: [
        { id: 'call_t', name: 'research_availability', args: {}, status: 'success' as never },
      ],
    });
    const sub: Subagent = {
      toolCallId: 'call_t',
      name: 'availability_researcher',
      status: signal('running'),
      messages: signal([{
        id: 'm1',
        role: 'assistant',
        content: 'checking calendars',
        delivery: staticDelivery('m1'),
      }]),
      state: signal({}),
    };
    agent.subagents!.set(new Map([['call_t-sub', sub]]));

    const fixture = TestBed.createComponent(SubagentHost);
    fixture.componentInstance.agent = agent;
    fixture.componentInstance.message = {
      id: 'a1',
      role: 'assistant',
      content: '',
      toolCallIds: ['call_t'],
      delivery: staticDelivery('a1'),
    };
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('chat-subagent-card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('availability_researcher');
    // The spawning call renders AS the card, not as a generic tool-call chip.
    expect(fixture.nativeElement.querySelectorAll('chat-tool-activity').length).toBe(0);
  });

  it('renders two separate subagent cards for two task calls (not collapsed into one strip)', () => {
    const agent = mockAgent({
      withSubagents: true,
      toolCalls: [
        { id: 'call_t1', name: 'task', args: {}, status: 'success' as never },
        { id: 'call_t2', name: 'task', args: {}, status: 'success' as never },
      ],
    });
    const sub1: Subagent = {
      toolCallId: 'call_t1',
      name: 'research_one',
      status: signal('running'),
      messages: signal([{
        id: 'm1',
        role: 'assistant',
        content: 'one',
        delivery: staticDelivery('m1'),
      }]),
      state: signal({}),
    };
    const sub2: Subagent = {
      toolCallId: 'call_t2',
      name: 'research_two',
      status: signal('running'),
      messages: signal([{
        id: 'm2',
        role: 'assistant',
        content: 'two',
        delivery: staticDelivery('m2'),
      }]),
      state: signal({}),
    };
    agent.subagents!.set(new Map([
      ['call_t1', sub1],
      ['call_t2', sub2],
    ]));

    const fixture = TestBed.createComponent(SubagentHost);
    fixture.componentInstance.agent = agent;
    fixture.componentInstance.message = {
      id: 'a1',
      role: 'assistant',
      content: '',
      toolCallIds: ['call_t1', 'call_t2'],
      delivery: staticDelivery('a1'),
    };
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('chat-subagent-card');
    expect(cards.length).toBe(2);
    // Not collapsed into a grouped strip.
    expect(fixture.nativeElement.querySelectorAll('[data-group="true"]').length).toBe(0);
  });
});

describe('ChatToolCallsComponent — group header disclosure semantics', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [GroupingHost] });
  });

  function renderTwoGroups() {
    const fixture = TestBed.createComponent(GroupingHost);
    fixture.componentInstance.agent = mockAgent({
      toolCalls: [
        { id: 'a', name: 'search_web', args: {}, status: 'complete', result: 'r' },
        { id: 'b', name: 'search_web', args: {}, status: 'complete', result: 'r' },
        { id: 'c', name: 'read_file', args: {}, status: 'complete', result: 'r' },
        { id: 'd', name: 'read_file', args: {}, status: 'complete', result: 'r' },
      ],
    });
    fixture.detectChanges();
    const headers = Array.from(
      fixture.nativeElement.querySelectorAll('.ctc__group-header'),
    ) as HTMLButtonElement[];
    return { fixture, headers };
  }

  it('reports collapsed state and controls nothing while collapsed', () => {
    const { headers } = renderTwoGroups();
    expect(headers).toHaveLength(2);
    for (const header of headers) {
      expect(header.getAttribute('aria-expanded')).toBe('false');
      expect(header.hasAttribute('aria-controls')).toBe(false);
    }
  });

  it('reports expanded state and points aria-controls at the rendered body', () => {
    const { fixture, headers } = renderTwoGroups();
    headers[0].click();
    fixture.detectChanges();

    expect(headers[0].getAttribute('aria-expanded')).toBe('true');
    const controls = headers[0].getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    const body = fixture.nativeElement.querySelector(`#${controls}`) as HTMLElement | null;
    expect(body?.classList.contains('ctc__group-body')).toBe(true);
    expect(headers[1].getAttribute('aria-expanded')).toBe('false');
  });

  it('gives each group body a unique id', () => {
    const { fixture, headers } = renderTwoGroups();
    headers[0].click();
    headers[1].click();
    fixture.detectChanges();

    const ids = headers.map((header) => header.getAttribute('aria-controls'));
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) {
      expect(fixture.nativeElement.querySelector(`#${id}`)).toBeTruthy();
    }
  });

  it('gives the group header a focus ring and a target at least 24px tall', () => {
    renderTwoGroups();
    const css = Array.from(document.head.querySelectorAll('style'))
      .map((style) => style.textContent ?? '')
      .join('\n');
    expect(css).toMatch(
      /\.ctc__group-header(\[[^\]]*\])?:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--tplane-chat-focus-ring\)/,
    );
    expect(css).toMatch(/\.ctc__group-header(\[[^\]]*\])?\s*\{[^}]*min-height:\s*32px/);
  });
});

@Component({
  standalone: true,
  imports: [ChatToolCallsComponent, ChatToolCallTemplateDirective],
  template: `
    <ng-template #supplied chatToolCallTemplate="search_web" let-call>
      <span data-tpl="input-search_web">{{ call.id }}</span>
    </ng-template>
    <ng-template #supplied chatToolCallTemplate="*" let-call>
      <span data-tpl="input-wildcard">{{ call.id }}</span>
    </ng-template>
    <chat-tool-calls [agent]="agent" grouping="none" [toolCallTemplates]="suppliedTemplates()">
      @if (registerOwnSearchWeb) {
        <ng-template chatToolCallTemplate="search_web" let-call>
          <span data-tpl="own-search_web">{{ call.id }}</span>
        </ng-template>
      }
    </chat-tool-calls>
  `,
})
class SuppliedTemplatesHost {
  agent: Agent = mockAgent({
    toolCalls: [
      { id: 'a', name: 'search_web', args: {}, status: 'complete' },
      { id: 'b', name: 'read_file', args: {}, status: 'complete' },
    ],
  });
  registerOwnSearchWeb = false;
  readonly suppliedTemplates = viewChildren('supplied', { read: ChatToolCallTemplateDirective });
}

describe('ChatToolCallsComponent — [toolCallTemplates] input', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [SuppliedTemplatesHost] });
  });

  function render(registerOwn: boolean): HTMLElement {
    const fixture = TestBed.createComponent(SuppliedTemplatesHost);
    fixture.componentInstance.registerOwnSearchWeb = registerOwn;
    fixture.detectChanges();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function rendered(host: HTMLElement): string[] {
    return [...host.querySelectorAll<HTMLElement>('chat-tool-calls [data-tpl]')]
      .map((el) => `${el.dataset['tpl']}:${el.textContent?.trim()}`);
  }

  it('dispatches calls to supplied named and wildcard templates', () => {
    expect(rendered(render(false))).toEqual(['input-search_web:a', 'input-wildcard:b']);
  });

  it('lets its own content-child templates override supplied ones by name', () => {
    expect(rendered(render(true))).toEqual(['own-search_web:a', 'input-wildcard:b']);
  });
});

describe('ChatToolCallsComponent — readable activity evidence', () => {
  it('defaults to one collapsed cross-name group and preserves label overrides and mixed active cues', () => {
    TestBed.configureTestingModule({ imports: [ChatToolCallsComponent] });
    const fixture = TestBed.createComponent(ChatToolCallsComponent);
    const agent = mockAgent({
      toolCalls: [{ id: 'a', name: 'read', args: {}, status: 'running' }],
    });
    fixture.componentRef.setInput('agent', agent);
    fixture.componentRef.setInput('toolLabel', () => 'Checking references');
    fixture.detectChanges();
    const header: HTMLButtonElement =
      fixture.nativeElement.querySelector('.ctc__group-header');
    expect(header.hidden).toBe(false);
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(header.textContent!.trim()).toBe('Checking references');
    expect(
      fixture.nativeElement.querySelector('.tp-tool-activity__progress')
    ).toBeNull();
    agent.toolCalls.update((calls) => [
      ...calls,
      {
        id: 'b',
        name: 'save',
        args: {},
        status: 'error',
        error: 'private diagnostic',
      },
    ]);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelectorAll('[data-group="true"]')
    ).toHaveLength(1);
    expect(header.querySelector('.tp-tool-activity__cue')!.textContent).toBe(
      'Failed'
    );
    expect(
      header
        .querySelector('.tp-tool-activity__label')!
        .getAttribute('data-active')
    ).toBe('true');
    fixture.componentRef.setInput('groupSummary', () => 'Preparing report');
    fixture.detectChanges();
    expect(header.querySelector('.tp-tool-activity__label')!.textContent).toBe(
      'Preparing report'
    );
    expect(header.querySelector('.tp-tool-activity__cue')!.textContent).toBe(
      'Failed'
    );
    const status = fixture.nativeElement.querySelector('[role="status"]');
    expect(status.classList.contains('tp-tool-activity__status')).toBe(true);
    expect(status.closest('[hidden]')).toBeNull();
    fixture.componentRef.setInput('groupRelated', false);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelectorAll('[data-group="true"]')
    ).toHaveLength(0);
  });

  it('projects authored outcomes once per call instead of invoking app callbacks for status counting', () => {
    TestBed.configureTestingModule({ imports: [ChatToolCallsComponent] });
    const fixture = TestBed.createComponent(ChatToolCallsComponent);
    const agent = mockAgent({ toolCalls: ['a', 'b'].map(id => ({ id, name: 'read', args: {}, status: 'complete' as const, result: 'ok' })) });
    const outcome = vi.fn(() => ({ text: 'Reference checked' }));
    fixture.componentRef.setInput('agent', agent);
    fixture.componentRef.setInput('toolOutcome', outcome);
    fixture.detectChanges();
    fixture.detectChanges();
    expect(outcome).toHaveBeenCalledTimes(2);
    agent.toolCalls.update(calls => calls.map(call => ({ ...call, result: 'new' })));
    fixture.detectChanges();
    expect(outcome).toHaveBeenCalledTimes(4);
  });
  it('retains group/member Details and focus when the first call changes through reordering', () => {
    TestBed.configureTestingModule({ imports: [ChatToolCallsComponent] });
    const fixture = TestBed.createComponent(ChatToolCallsComponent);
    const a: ToolCall = { id: 'a', name: 'query', status: 'running', args: {} }, b: ToolCall = { id: 'b', name: 'query', status: 'running', args: {} };
    const agent = mockAgent({ toolCalls: [a, b] });
    fixture.componentRef.setInput('agent', agent); fixture.detectChanges();
    fixture.nativeElement.querySelector('.ctc__group-header').click(); fixture.detectChanges();
    const group = fixture.nativeElement.querySelector('.ctc__group');
    const details: HTMLDetailsElement = fixture.nativeElement.querySelector('[data-tool-id="a"] details');
    details.open = true; const summary = details.querySelector('summary')!; summary.focus();
    agent.toolCalls.set([b, a]); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.ctc__group')).toBe(group);
    expect(fixture.nativeElement.querySelector('[data-tool-id="a"] details')).toBe(details);
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(summary);
  });
  it('keeps opted-in related grouping consistent for one call and exposes concise progress', () => {
    TestBed.configureTestingModule({ imports: [ChatToolCallsComponent] });
    const fixture = TestBed.createComponent(ChatToolCallsComponent);
    fixture.componentRef.setInput('agent', mockAgent({ toolCalls: [{ id: 'a', name: 'read', args: {}, status: 'running' }] }));
    fixture.componentRef.setInput('groupRelated', true);
    fixture.detectChanges();
    const header: HTMLButtonElement = fixture.nativeElement.querySelector('.ctc__group-header');
    expect(header.hidden).toBe(false);
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('1 running');
  });
  it('retains the first disclosure and focus when one related call grows to two', () => {
    TestBed.configureTestingModule({ imports: [ChatToolCallsComponent] });
    const fixture = TestBed.createComponent(ChatToolCallsComponent);
    const agent = mockAgent({
      toolCalls: [{ id: 'a', name: 'query', status: 'running', args: {} }],
    });
    fixture.componentRef.setInput('agent', agent);
    fixture.componentRef.setInput('groupRelated', true);
    fixture.detectChanges();
    const header: HTMLButtonElement = fixture.nativeElement.querySelector('.ctc__group-header');
    if (!header.hidden) { header.click(); fixture.detectChanges(); }
    const details: HTMLDetailsElement = fixture.nativeElement.querySelector(
      'chat-tool-activity details'
    );
    const summary = details.querySelector('summary')!;
    summary.focus();
    details.open = true;
    agent.toolCalls.update((calls) => [
      ...calls,
      { id: 'b', name: 'layout', status: 'running', args: {} },
    ]);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('chat-tool-activity details')
    ).toBe(details);
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(summary);
    expect(fixture.nativeElement.querySelector('.ctc__group-body').hidden).toBe(
      false
    );
  });
  it('renders the generic failure copy as a div alert with one paragraph in the inline group alert', () => {
    TestBed.configureTestingModule({ imports: [ChatToolCallsComponent] });
    const fixture = TestBed.createComponent(ChatToolCallsComponent);
    fixture.componentRef.setInput(
      'agent',
      mockAgent({
        toolCalls: [
          { id: 'a', name: 'read', status: 'complete', args: {} },
          { id: 'b', name: 'save', status: 'error', args: {}, error: 'private' },
        ],
      })
    );
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    // The failed member also renders its own <p role="alert">; the group
    // alert is the sole block-level alert outside Details.
    const alerts = Array.from(
      root.querySelectorAll<HTMLElement>('[role="alert"]')
    ).filter((el) => el.closest('details') === null && el.tagName === 'DIV');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].classList.contains('tp-tool-activity__error')).toBe(true);
    expect(
      Array.from(alerts[0].querySelectorAll('p')).map((p) => p.textContent!.trim())
    ).toEqual(['Some tools could not finish. Check Details before retrying.']);
    expect(root.querySelector('.ctc__group-header')!.textContent).toContain(
      'Used 2 tools · 1 failed'
    );
  });
  it('keeps an error-only diagnostic in Details and a safe failure outside', () => {
    TestBed.configureTestingModule({ imports: [ChatToolCallsComponent] });
    const fixture = TestBed.createComponent(ChatToolCallsComponent);
    fixture.componentRef.setInput(
      'agent',
      mockAgent({
        toolCalls: [
          {
            id: 'bad',
            name: 'query_private',
            status: 'error',
            args: {},
            error: 'diagnostic only',
          },
        ],
      })
    );
    fixture.detectChanges();
    const details = fixture.nativeElement.querySelector('details');
    expect(details?.textContent).toContain('diagnostic only');
    expect(details?.open).toBe(false);
    expect(
      fixture.nativeElement.querySelector('[role=alert]')?.closest('details')
    ).toBeNull();
  });
  it('opts into mixed-name grouping, keeps expansion by first call id and preserves none', () => {
    TestBed.configureTestingModule({ imports: [ChatToolCallsComponent] });
    const fixture = TestBed.createComponent(ChatToolCallsComponent);
    const agent = mockAgent({
      toolCalls: [
        { id: 'a', name: 'query', status: 'running', args: {} },
        { id: 'b', name: 'layout', status: 'running', args: {} },
      ],
    });
    fixture.componentRef.setInput('agent', agent);
    fixture.componentRef.setInput('groupRelated', true);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelectorAll('[data-group=true]')
    ).toHaveLength(1);
    const button = fixture.nativeElement.querySelector('.ctc__group-header');
    button.click();
    fixture.detectChanges();
    const inner = fixture.nativeElement.querySelector(
      'chat-tool-activity details'
    );
    inner.open = true;
    agent.toolCalls.update((calls) => [
      ...calls,
      { id: 'c', name: 'other', status: 'complete', args: {} },
    ]);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('chat-tool-activity details')
    ).toBe(inner);
    expect(inner.open).toBe(true);
    fixture.componentRef.setInput('grouping', 'none');
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelectorAll('[data-group=true]')
    ).toHaveLength(0);
  });
});

@Component({
  standalone: true,
  imports: [ChatToolCallsComponent, ChatToolCallTemplateDirective, ChatToolResultTemplateDirective],
  template: `
    <chat-tool-calls
      [agent]="agent"
      [groupRelated]="groupRelated"
      [toolOutcome]="outcome"
      [toolResultTemplates]="suppliedList()"
    >
      @if (withResult) {
        <ng-template chatToolResultTemplate="*" let-activity>
          <span data-slot="any">{{ activity.id }}:{{ activity.phase }}</span>
          @if (activity.phase === 'error') {
            <button type="button">Retry {{ activity.id }}</button>
          }
        </ng-template>
      }
      @if (withNamed) {
        <ng-template chatToolResultTemplate="read_reference" let-activity>
          <span data-slot="named">{{ activity.id }}</span>
        </ng-template>
      }
      @if (withCallTemplate) {
        <ng-template chatToolCallTemplate="read_reference" let-call>
          <span data-slot="call">{{ call.id }}</span>
        </ng-template>
      }
    </chat-tool-calls>
    <ng-template #supplied chatToolResultTemplate="read_reference" let-activity>
      <span data-slot="supplied">{{ activity.id }}</span>
    </ng-template>
  `,
})
class ResultSlotHost {
  agent: Agent = mockAgent();
  groupRelated = true;
  withResult = true;
  withNamed = false;
  withCallTemplate = false;
  outcome: ((activity: ToolActivityInfo) => ToolActivityOutcome | undefined) | undefined;
  readonly suppliedTemplates = viewChildren('supplied', { read: ChatToolResultTemplateDirective });
  suppliedList() {
    return this.withSupplied ? this.suppliedTemplates() : [];
  }
  withSupplied = false;
}

describe('ChatToolCallsComponent — app-declared tool failures and result slot', () => {
  const calls = (results: readonly unknown[]): ToolCall[] =>
    results.map((result, i) => ({
      id: `c${i}`,
      name: 'read_reference',
      args: {},
      status: 'complete' as const,
      result,
    }));
  const failB = (activity: ToolActivityInfo): ToolActivityOutcome | undefined =>
    activity.id === 'c1' ? { status: 'failed', text: 'Reference B is unavailable.' } : undefined;
  function setup(
    results: readonly unknown[],
    configure: (host: ResultSlotHost) => void = () => undefined
  ) {
    TestBed.configureTestingModule({ imports: [ResultSlotHost] });
    const fixture = TestBed.createComponent(ResultSlotHost);
    const host = fixture.componentInstance;
    host.agent = mockAgent({ toolCalls: calls(results) });
    configure(host);
    fixture.detectChanges();
    fixture.detectChanges();
    return { fixture, root: fixture.nativeElement as HTMLElement, host };
  }

  it('partial failure shows one Complete and one Failed row', () => {
    const { root } = setup(['ok', { recoverable: true, error: 'x' }], (h) => {
      h.withResult = false;
      h.outcome = failB;
    });
    expect(root.querySelector('.ctc__group-header')!.textContent).toContain('Used 2 tools · 1 failed');
    expect(root.querySelector('[role="status"]')!.textContent!.trim()).toBe(
      'Used 2 tools · 1 failed. 1 complete · 1 failed.'
    );
    const alert = root.querySelector('div[role="alert"].tp-tool-activity__error')!;
    expect(alert.textContent!.trim()).toBe('Reference B is unavailable.');
    expect(alert.closest('.ctc__group-body')).toBeNull();
    const rowB = root.querySelector('chat-tool-activity [data-tool-id="c1"], [data-tool-id="c1"]')!;
    expect(rowB.getAttribute('data-phase')).toBe('error');
    expect(root.querySelector('[data-tool-id="c0"]')!.getAttribute('data-phase')).toBe('complete');
    expect(rowB.querySelector('details')!.textContent).toContain('"recoverable": true');
  });

  it.each([
    ['a single call with groupRelated off', ['ok'], false, 'auto', 'c0'],
    ['grouping none', ['ok', { recoverable: true, error: 'x' }], true, 'none', 'c1'],
  ] as const)('ungrouped failure (%s) shows exactly one alert with the failure text', (_, results, groupRelated, grouping, failedId) => {
    TestBed.configureTestingModule({ imports: [ChatToolCallsComponent] });
    const fixture = TestBed.createComponent(ChatToolCallsComponent);
    fixture.componentRef.setInput('agent', mockAgent({ toolCalls: calls(results) }));
    fixture.componentRef.setInput('groupRelated', groupRelated);
    fixture.componentRef.setInput('grouping', grouping);
    fixture.componentRef.setInput('toolOutcome', (activity: ToolActivityInfo): ToolActivityOutcome | undefined =>
      activity.id === failedId ? { status: 'failed', text: 'Reference B is unavailable.' } : undefined
    );
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const alerts = root.querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent!.trim()).toBe('Reference B is unavailable.');
    expect(root.textContent).not.toContain('Some tools could not finish');
  });

  it('a throwing toolOutcome leaves the call complete', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { root } = setup(['ok', 'ok2'], (h) => {
      h.withResult = false;
      h.outcome = (activity) => {
        if (activity.id === 'c1') throw new Error('boom');
        return undefined;
      };
    });
    expect(root.querySelector('.ctc__group-header')!.textContent).toContain('Used 2 tools');
    expect(root.querySelector('.ctc__group-header')!.textContent).not.toContain('failed');
    expect(
      [...root.querySelectorAll('.tp-tool-activity')].map((el) => el.getAttribute('data-phase'))
    ).toEqual(['complete', 'complete']);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('falsy literal results stay complete', () => {
    const { root } = setup([false, 0, '', [], null], (h) => {
      h.withResult = false;
      h.outcome = () => undefined;
    });
    expect(root.querySelector('.ctc__group-header')!.textContent).toContain('Used 5 tools');
    expect(
      [...root.querySelectorAll('.tp-tool-activity')].map((el) => el.getAttribute('data-phase'))
    ).toEqual(['complete', 'complete', 'complete', 'complete', 'complete']);
    expect(
      [...root.querySelectorAll('.tp-tool-activity details pre:nth-of-type(2)')].map((el) => el.textContent)
    ).toEqual(['false', '0', '', '[]', 'null']);
  });

  it('chatToolResultTemplate renders outside the collapsed group with the resolved activity', () => {
    const { root } = setup(['ok', { recoverable: true, error: 'x' }], (h) => {
      h.outcome = failB;
    });
    const body = root.querySelector('.ctc__group-body') as HTMLElement;
    expect(body.hidden).toBe(true);
    const buttons = root.querySelectorAll('button');
    const retry = [...buttons].filter((b) => b.textContent!.trim() === 'Retry c1');
    expect(retry).toHaveLength(1);
    expect(body.contains(retry[0])).toBe(false);
    expect(retry[0].closest('[data-tool-id]')!.getAttribute('data-tool-id')).toBe('c1');
    expect(retry[0].closest('.tp-tool-activity__results')).toBeTruthy();
    const seen = [...root.querySelectorAll('[data-slot="any"]')].map((el) => el.textContent);
    expect(seen).toEqual(['c0:complete', 'c1:error']);
  });

  it('renders no results container without a matching template', () => {
    const { root } = setup(['ok'], (h) => {
      h.withResult = false;
    });
    expect(root.querySelector('.tp-tool-activity__results')).toBeNull();
  });

  it('chatToolResultTemplate renders inside the call row when ungrouped', () => {
    const { root } = setup(['ok', 'bad'], (h) => {
      h.groupRelated = false;
      h.agent = mockAgent({
        toolCalls: [
          { id: 'c0', name: 'other_tool', args: {}, status: 'complete', result: 'ok' },
          { id: 'c1', name: 'read_reference', args: {}, status: 'complete', result: 'bad' },
        ],
      });
      h.outcome = failB;
    });
    const button = [...root.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Retry c1')!;
    expect(button.closest('.tp-tool-activity')!.getAttribute('data-tool-id')).toBe('c1');
  });

  it('a name template beats "*" for that tool', () => {
    const { root } = setup(['ok'], (h) => {
      h.withNamed = true;
    });
    expect(root.querySelector('[data-slot="named"]')).toBeTruthy();
    expect(root.querySelector('[data-slot="any"]')).toBeNull();
  });

  it('content-child result templates beat supplied ones for the same name', () => {
    const { root } = setup(['ok'], (h) => {
      h.withResult = false;
      h.withNamed = true;
      h.withSupplied = true;
    });
    expect(root.querySelector('[data-slot="named"]')).toBeTruthy();
    expect(root.querySelector('[data-slot="supplied"]')).toBeNull();
  });

  it('supplied result templates render when no content child matches', () => {
    const { root } = setup(['ok'], (h) => {
      h.withResult = false;
      h.withSupplied = true;
    });
    expect(root.querySelector('[data-slot="supplied"]')).toBeTruthy();
  });

  it('tools with a chatToolCallTemplate keep full replacement and get no result template', () => {
    const { root } = setup(['ok'], (h) => {
      h.withCallTemplate = true;
    });
    expect(root.querySelector('[data-slot="call"]')).toBeTruthy();
    expect(root.querySelector('[data-slot="any"]')).toBeNull();
    expect(root.querySelector('.tp-tool-activity__results')).toBeNull();
  });

  it('renders identical failure text from two failed calls once in the group alert', () => {
    const { root } = setup(['a', 'b'], (h) => {
      h.withResult = false;
      h.outcome = () => ({ status: 'failed', text: 'Reference is unavailable.' });
    });
    const paragraphs = root.querySelectorAll('div[role="alert"].tp-tool-activity__error > p');
    expect([...paragraphs].map((p) => p.textContent!.trim())).toEqual(['Reference is unavailable.']);
  });

  it('does not re-run toolOutcome on repeated change detection', () => {
    const outcome = vi.fn(failB);
    const { fixture } = setup(['ok', 'bad'], (h) => {
      h.withResult = false;
      h.outcome = outcome;
    });
    const before = outcome.mock.calls.length;
    const root = fixture.nativeElement as HTMLElement;
    // Toggling a signal the template reads re-renders the OnPush view
    // without changing the tool calls.
    (root.querySelector('.ctc__group-header') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(root.querySelector('.ctc__group-header')!.getAttribute('aria-expanded')).toBe('true');
    (root.querySelector('.ctc__group-header') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(outcome.mock.calls.length).toBe(before);
  });
});

describe('ChatToolCallsComponent — call-specific labels', () => {
  it('passes each call its own arguments so repeated calls get distinct labels', () => {
    TestBed.configureTestingModule({ imports: [ChatToolCallsComponent] });
    const fixture = TestBed.createComponent(ChatToolCallsComponent);
    const toolLabel = vi.fn((name: string, args?: unknown) =>
      name === 'read' ? `Read ${(args as { ref: string }).ref}` : undefined
    );
    fixture.componentRef.setInput('agent', mockAgent({
      toolCalls: [
        { id: 'a', name: 'read', args: { ref: 'toSorted' }, status: 'complete', result: 'ok' },
        { id: 'b', name: 'read', args: { ref: 'toReversed' }, status: 'complete', result: 'ok' },
      ],
    }));
    fixture.componentRef.setInput('toolLabel', toolLabel);
    fixture.detectChanges();
    expect(toolLabel).toHaveBeenCalledWith('read', { ref: 'toSorted' });
    const headings = Array.from(
      fixture.nativeElement.querySelectorAll('.tp-tool-activity__heading > span:first-child') as NodeListOf<HTMLElement>
    ).map((el) => el.textContent);
    expect(headings).toEqual(['Read toSorted', 'Read toReversed']);
  });
  it('keeps the failure message out of grouped rows', () => {
    TestBed.configureTestingModule({ imports: [ChatToolCallsComponent] });
    const fixture = TestBed.createComponent(ChatToolCallsComponent);
    fixture.componentRef.setInput('agent', mockAgent({
      toolCalls: [
        { id: 'a', name: 'read', args: { ref: 'A' }, status: 'complete', result: 'ok' },
        { id: 'b', name: 'read', args: { ref: 'B' }, status: 'error', error: 'boom' },
      ],
    }));
    fixture.detectChanges();
    const body: HTMLElement = fixture.nativeElement.querySelector('.ctc__group-body');
    expect(body.querySelector('[role="alert"]')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });
});

describe('ChatToolCallsComponent — progress view', () => {
  const running = (): ToolCall[] => [
    { id: 'a', name: 'read', args: { ref: 'toSorted' }, status: 'complete', result: 'ok' },
    { id: 'b', name: 'read', args: { ref: 'toReversed' }, status: 'running' },
    { id: 'c', name: 'save', args: {}, status: 'pending' },
  ];
  function render(calls: ToolCall[], isLoading = true) {
    TestBed.configureTestingModule({ imports: [ChatToolCallsComponent] });
    const fixture = TestBed.createComponent(ChatToolCallsComponent);
    const agent = mockAgent({ toolCalls: calls, isLoading });
    fixture.componentRef.setInput('agent', agent);
    fixture.componentRef.setInput('toolLabel', (name: string, args?: unknown) =>
      name === 'read' ? `Reading ${(args as { ref: string }).ref}` : 'Saving note'
    );
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    return { fixture, agent, root };
  }
  afterEach(() => vi.useRealTimers());

  it('collapsed: names the current step with the shimmer, then elapsed time and Stop', () => {
    vi.useFakeTimers();
    const { fixture, agent, root } = render(running());
    const label = root.querySelector('.ctc__group-header .tp-tool-activity__label')!;
    expect(label.textContent!.trim()).toBe('Reading toReversed');
    expect(label.getAttribute('data-active')).toBe('true');
    expect(root.querySelector('.ctc__group-elapsed')!.textContent!.trim()).toBe('0s');
    vi.advanceTimersByTime(65_000);
    fixture.detectChanges();
    expect(root.querySelector('.ctc__group-elapsed')!.textContent!.trim()).toBe('1m 05s');
    const stop = root.querySelector<HTMLButtonElement>('.ctc__group-stop')!;
    expect(stop.textContent!.trim()).toBe('Stop');
    expect(stop.closest('.ctc__group-header')).toBeNull();
    stop.click();
    expect(agent.stopCount).toBe(1);
  });

  it('expanded: a static count heading and the shimmer on the current row only', () => {
    const { fixture, root } = render(running());
    root.querySelector<HTMLButtonElement>('.ctc__group-header')!.click();
    fixture.detectChanges();
    const label = root.querySelector('.ctc__group-header .tp-tool-activity__label')!;
    expect(label.textContent!.trim()).toBe('Working · 1 of 3 done');
    expect(label.getAttribute('data-active')).toBe('false');
    const active = Array.from(root.querySelectorAll('.ctc__group-body [data-active="true"]'));
    expect(active.map((el) => el.textContent!.trim())).toEqual(['Reading toReversed']);
    expect(root.querySelector('.ctc__group-stop')).not.toBeNull();
  });

  it('keeps the live region on the current step while expanded', () => {
    const { fixture, root } = render(running());
    root.querySelector<HTMLButtonElement>('.ctc__group-header')!.click();
    fixture.detectChanges();
    expect(root.querySelector('[role="status"]')!.textContent).toContain('Reading toReversed');
  });

  it('finished: settles to the used line with no elapsed time or Stop', () => {
    const { root } = render(
      running().map((call) => ({ ...call, status: 'complete' as const, result: 'ok' })),
      false
    );
    expect(root.querySelector('.ctc__group-header .tp-tool-activity__label')!.textContent!.trim()).toBe('Used 3 tools');
    expect(root.querySelector('.ctc__group-elapsed')).toBeNull();
    expect(root.querySelector('.ctc__group-stop')).toBeNull();
  });

  it('offers no Stop when the agent is idle', () => {
    const { root } = render(running(), false);
    expect(root.querySelector('.ctc__group-stop')).toBeNull();
  });
});

describe('ChatToolCallsComponent — upcoming steps from a declared plan', () => {
  const calls: ToolCall[] = [
    { id: 'a', name: 'read', args: { ref: 'toSorted' }, status: 'complete', result: 'ok' },
    { id: 'b', name: 'read', args: { ref: 'toReversed' }, status: 'running' },
  ];
  const plan = signal<AgentPlan | undefined>([
    { label: 'Read toSorted', status: 'completed' },
    { label: 'Read toReversed', status: 'in_progress' },
    { label: 'Compare the two', status: 'pending' },
    { label: 'Write the note', status: 'pending' },
  ]);
  function render(toolCalls = calls, isLoading = true) {
    TestBed.configureTestingModule({ imports: [ChatToolCallsComponent] });
    const fixture = TestBed.createComponent(ChatToolCallsComponent);
    fixture.componentRef.setInput('agent', Object.assign(mockAgent({ toolCalls, isLoading }), { plan }));
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    (root.querySelector('.ctc__group-header') as HTMLButtonElement).click();
    fixture.detectChanges();
    return { fixture, root };
  }
  const steps = (root: HTMLElement) => [...root.querySelectorAll('.ctc__plan-step')].map((p) => p.textContent!.trim());

  it('lists the pending steps after the calls while the group runs', () => {
    const { root } = render();
    expect(steps(root)).toEqual(['Compare the two', 'Write the note']);
    const step = root.querySelector('.ctc__plan-step')!;
    expect(step.closest('.ctc__group-body')).toBeTruthy();
    expect(step.previousElementSibling?.tagName.toLowerCase()).toBe('chat-tool-activity');
  });

  it('follows the plan as steps finish', () => {
    const { fixture, root } = render();
    plan.update((p) => p!.map((s) => (s.label === 'Compare the two' ? { ...s, status: 'in_progress' as const } : s)));
    fixture.detectChanges();
    expect(steps(root)).toEqual(['Write the note']);
    plan.set(undefined);
  });

  it('shows no upcoming steps without a plan', () => {
    plan.set(undefined);
    const { root } = render();
    expect(steps(root)).toEqual([]);
  });

  it('shows no upcoming steps once the group has finished', () => {
    plan.set([{ label: 'Compare the two', status: 'pending' }]);
    const done: ToolCall[] = calls.map((c) => ({ ...c, status: 'complete' as const, result: 'ok' }));
    const { root } = render(done, false);
    expect(steps(root)).toEqual([]);
  });
});
