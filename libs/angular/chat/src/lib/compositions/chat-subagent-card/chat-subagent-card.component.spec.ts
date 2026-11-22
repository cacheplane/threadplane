import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ChatSubagentCardComponent, statusColor } from './chat-subagent-card.component';
import type { AgentSubagent } from '../../agent';
import { ChatStreamingMdComponent } from '../../streaming/streaming-markdown.component';
import { completeDelivery, staticDelivery, streamingDelivery, type ToolCall } from '../../agent';
import type { ToolActivityInfo } from '../../primitives/chat-tool-activity/chat-tool-activity.component';
import { CitationsResolverService } from '@threadplane/angular/chat/shared';

describe('ChatSubagentCardComponent', () => {
  it('is defined', () => {
    expect(ChatSubagentCardComponent).toBeDefined();
    expect(typeof ChatSubagentCardComponent).toBe('function');
  });

  it('renders full transcript with reasoning, text, and tool-call cards', async () => {
    const fakeSubagent: AgentSubagent = {
      id: 'child-1',
      toolCallId: 'tc-root',
      name: 'Research',
      // Use 'running' so chat-trace auto-expands and the transcript DOM is rendered.
      status: 'running',
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content: 'searching',
          reasoning: 'plan',
          toolCallIds: ['t1'],
          delivery: streamingDelivery('nested-1'),
        },
        {
          id: 'm2',
          role: 'assistant',
          content: 'done',
          delivery: completeDelivery('nested-2', 'error'),
        },
      ],
      toolCalls: [
        { id: 't1', name: 'search', args: { q: 'x' }, status: 'complete', result: { n: 1 } },
      ],
      state: {},
    };

    TestBed.configureTestingModule({
      imports: [ChatSubagentCardComponent],
    });

    const fixture = TestBed.createComponent(ChatSubagentCardComponent);
    fixture.componentRef.setInput('subagent', fakeSubagent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const msgEls = fixture.debugElement.queryAll(By.css('.sac__msg'));
    expect(msgEls.length).toBe(2);

    const text = host.textContent ?? '';
    // The header names the subagent and counts its messages; the raw call ID stays out.
    expect(text).toContain('Research');
    expect(text).toContain('2 messages');
    // Name and status are separate words to a screen reader, not "Researchrunning".
    expect(host.querySelector('.chat-trace__label')?.textContent?.trim()).toBe('Research Running');
    expect(text).not.toContain('tc-root');
    // Without app labels the call shows its technical name.
    expect(host.querySelector('.tcc__name')?.textContent).toBe('search');
    fixture.componentRef.setInput('toolLabel', (name: string) => (name === 'search' ? 'Searching the web' : undefined));
    fixture.detectChanges();
    const name = host.querySelector('.tcc__name');
    expect(name?.textContent).toBe('Searching the web');
    expect(name?.classList.contains('tcc__name--label')).toBe(true);
    expect(text).toContain('searching');
    expect(text).toContain('done');
    expect(text).toContain('plan');

    const toolCallEls = fixture.debugElement.queryAll(By.css('chat-tool-call-card'));
    expect(toolCallEls.length).toBe(1);

    const markdown = fixture.debugElement.queryAll(By.directive(ChatStreamingMdComponent));
    expect(markdown.map((el) => el.componentInstance.document())).toEqual([
      { generation: 'nested-1', phase: 'streaming', content: 'searching' },
      { generation: 'nested-2', phase: 'complete', content: 'done' },
    ]);
  });

  it('hands sources declared for its completed calls to the message Sources panel', () => {
    const calls: ToolCall[] = [
      { id: 't1', name: 'read', args: { id: 1 }, status: 'complete', result: { url: 'https://example.com/signals' } },
      { id: 't2', name: 'read', args: { id: 2 }, status: 'running' },
    ];
    const subagent: AgentSubagent = {
      id: 'child-1',
      toolCallId: 'tc-root',
      status: 'complete',
      messages: [],
      toolCalls: calls,
      state: {},
    };
    TestBed.configureTestingModule({ imports: [ChatSubagentCardComponent], providers: [CitationsResolverService] });
    const resolver = TestBed.inject(CitationsResolverService);
    const fixture = TestBed.createComponent(ChatSubagentCardComponent);
    fixture.componentRef.setInput('subagent', subagent);
    fixture.detectChanges();
    // Nothing is declared without the app's outcome callback.
    expect(resolver.toolSources()).toEqual([]);

    fixture.componentRef.setInput('toolOutcome', (activity: ToolActivityInfo) => ({
      text: '',
      sources: [{ title: 'Signals', url: JSON.parse(activity.resultText ?? '{}').url }],
    }));
    fixture.detectChanges();
    // Only the completed call contributes.
    expect(resolver.toolSources()).toEqual([{ title: 'Signals', url: 'https://example.com/signals' }]);

    fixture.componentRef.setInput('toolOutcome', () => {
      throw new Error('bad decoder');
    });
    fixture.detectChanges();
    expect(resolver.toolSources()).toEqual([]);

    fixture.componentRef.setInput('toolOutcome', () => ({ text: '', sources: [{ title: 'Signals', url: 'https://example.com/signals' }] }));
    fixture.detectChanges();
    fixture.destroy();
    expect(resolver.toolSources()).toEqual([]);
  });

  it('shows the message count in the collapsed summary when complete', async () => {
    const fakeSubagent: AgentSubagent = {
      id: 'child-1',
      toolCallId: 'tc-root',
      name: 'Research',
      // 'complete' → chat-trace collapses; the transcript DOM is hidden.
      status: 'complete',
      messages: [
        { id: 'm1', role: 'assistant', content: 'a', delivery: staticDelivery('m1') },
        { id: 'm2', role: 'assistant', content: 'b', delivery: staticDelivery('m2') },
      ],
      toolCalls: [],
      state: {},
    };

    TestBed.configureTestingModule({
      imports: [ChatSubagentCardComponent],
    });

    const fixture = TestBed.createComponent(ChatSubagentCardComponent);
    fixture.componentRef.setInput('subagent', fakeSubagent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // Collapsed: the per-message transcript must NOT be rendered.
    const msgEls = fixture.debugElement.queryAll(By.css('.sac__msg'));
    expect(msgEls.length).toBe(0);

    // ...but the count lives in the always-visible meta slot.
    const host = fixture.nativeElement as HTMLElement;
    const text = host.textContent ?? '';
    expect(text).toMatch(/2 message/);
  });

  it('preserves nested markdown document identity across unrelated parent updates', () => {
    const messages = [{
      id: 'm1',
      role: 'assistant' as const,
      content: 'stable',
      delivery: staticDelivery('m1'),
    }];
    const fakeSubagent: AgentSubagent = {
      id: 'child-1',
      toolCallId: 'tc-root',
      name: 'Research',
      status: 'running',
      messages,
      toolCalls: [],
      state: {},
    };
    TestBed.configureTestingModule({ imports: [ChatSubagentCardComponent] });
    const fixture = TestBed.createComponent(ChatSubagentCardComponent);
    fixture.componentRef.setInput('subagent', fakeSubagent);
    fixture.detectChanges();

    let markdown = fixture.debugElement.query(By.directive(ChatStreamingMdComponent));
    const document = markdown.componentInstance.document();

    // The session publishes the child again with nothing about this message changed.
    fixture.componentRef.setInput('subagent', { ...fakeSubagent, messages: [...messages], state: { step: 2 } });
    fixture.detectChanges();

    markdown = fixture.debugElement.query(By.directive(ChatStreamingMdComponent));
    expect(markdown.componentInstance.document()).toBe(document);
  });
});

describe('ChatSubagentCardComponent — a child whose ending was never seen', () => {
  it('labels an unknown status in the reader\'s words and shows the trace as finished', () => {
    TestBed.configureTestingModule({ imports: [ChatSubagentCardComponent] });
    const fixture = TestBed.createComponent(ChatSubagentCardComponent);
    fixture.componentRef.setInput('subagent', {
      id: 'child-1',
      name: 'Research',
      status: 'unknown',
      messages: [{ id: 'm1', role: 'assistant', content: 'a', delivery: staticDelivery('m1') }],
      toolCalls: [],
    } satisfies AgentSubagent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.chat-trace__label')?.textContent?.trim()).toBe('Research Status unavailable');
    expect(host.querySelector('.sac__pill')?.getAttribute('data-status')).toBe('unknown');
    expect(fixture.componentInstance.state()).toBe('done');
    // No longer working: collapsed like a completed child, with the count still shown.
    expect(host.querySelectorAll('.sac__msg').length).toBe(0);
    expect(host.textContent).toContain('1 message');
  });

  it('follows the status when the session publishes the child again', () => {
    TestBed.configureTestingModule({ imports: [ChatSubagentCardComponent] });
    const fixture = TestBed.createComponent(ChatSubagentCardComponent);
    const child: AgentSubagent = { id: 'child-1', status: 'pending', messages: [], toolCalls: [] };
    fixture.componentRef.setInput('subagent', child);
    fixture.detectChanges();
    const pill = () => (fixture.nativeElement as HTMLElement).querySelector('.sac__pill');
    expect(pill()?.textContent).toBe('Pending');
    // Without a name the card says what it is.
    expect((fixture.nativeElement as HTMLElement).querySelector('.sac__name')?.textContent).toBe('Subagent');
    fixture.componentRef.setInput('subagent', { ...child, status: 'error' });
    fixture.detectChanges();
    expect(pill()?.textContent).toBe('Failed');
    expect(pill()?.getAttribute('data-status')).toBe('error');
  });
});

describe('statusColor', () => {
  it('returns muted style for a status that is unavailable', () => {
    expect(statusColor('unknown')).toContain('var(--tplane-chat-text-muted)');
  });

  it('returns muted style for pending', () => {
    expect(statusColor('pending')).toContain('var(--tplane-chat-text-muted)');
  });

  it('returns warning style for running', () => {
    expect(statusColor('running')).toContain('var(--tplane-chat-warning-text)');
  });

  it('returns the small-text success color for complete', () => {
    expect(statusColor('complete')).toContain('var(--tplane-chat-success-text)');
  });

  it('returns error style for error', () => {
    expect(statusColor('error')).toContain('var(--tplane-chat-error-text)');
  });
});
