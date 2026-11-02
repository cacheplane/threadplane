import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ChatComponent } from './chat.component';
import { ChatMessageComponent } from '../../primitives/chat-message/chat-message.component';
import { ChatStreamingMdComponent } from '../../streaming/streaming-markdown.component';
import type { ContentClassifier } from '../../streaming/content-classifier';
import { mockAgent } from '../../testing/mock-agent';
import { completeDelivery, staticDelivery, streamingDelivery, type Message } from '../../agent';

const HISTORY_COUNT = 1000;

function conversation(): Message[] {
  return [
    ...Array.from({ length: HISTORY_COUNT }, (_, index): Message => ({
      id: `history-${index}`,
      role: index % 2 === 0 ? 'assistant' : 'user',
      content: `Historical message ${index}.`,
      delivery: staticDelivery(`history-${index}`),
    })),
    {
      id: 'active-answer',
      role: 'assistant',
      content: 'Initial tail',
      delivery: streamingDelivery('active-generation'),
    },
  ];
}

function mountedConversation() {
  const agent = mockAgent({ messages: conversation(), isLoading: true });
  const fixture = TestBed.createComponent(ChatComponent);
  fixture.componentRef.setInput('agent', agent);
  fixture.detectChanges();
  const row = (id: string) => {
    const match = fixture.debugElement.queryAll(By.directive(ChatMessageComponent))
      .find(element => element.componentInstance.message()?.id === id);
    expect(match, `mounted assistant row ${id}`).toBeDefined();
    return match!;
  };
  return { agent, fixture, row };
}

describe('ChatComponent historical render work', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [ChatComponent] }));
  afterEach(() => vi.restoreAllMocks());

  it('does not push unchanged historical content through its classifiers when only the tail changes', () => {
    const { agent, fixture, row } = mountedConversation();
    // Observe the actual classifiers created by the real production template,
    // rather than replacing the renderer or copying its update implementation.
    const entries = (fixture.componentInstance as unknown as {
      classifiers: Map<string, { classifier: ContentClassifier }>;
    }).classifiers;
    const historical = [...entries].filter(([id]) => id.startsWith('history-'));
    expect(historical).toHaveLength(HISTORY_COUNT / 2);
    const historicalUpdates = historical.map(([id, entry]) => ({
      id, update: vi.spyOn(entry.classifier, 'update'),
    }));
    const tailUpdate = vi.spyOn(entries.get('active-answer')!.classifier, 'update');
    const historicalElement = row('history-0').nativeElement;
    const historicalMarkdown = row('history-0').query(By.directive(ChatStreamingMdComponent));
    const historicalDocument = historicalMarkdown.componentInstance.document();

    // LangGraph currently reprojects all neutral wrappers and deliveries even
    // for one token. This must not be mistaken for changed historical content.
    const previous = agent.messages();
    const next = previous.map(message => ({
      ...message,
      delivery: { ...message.delivery },
      content: message.id === 'active-answer' ? 'Initial tail and next token' : message.content,
    }));
    expect(next[0]).not.toBe(previous[0]);
    expect(next[0].delivery).not.toBe(previous[0].delivery);
    agent.messages.set(next);
    fixture.detectChanges();

    expect(row('active-answer').nativeElement.textContent).toContain('Initial tail and next token');
    expect(tailUpdate.mock.calls.length).toBeGreaterThan(0);
    expect(row('history-0').nativeElement).toBe(historicalElement);
    expect(row('history-0').query(By.directive(ChatStreamingMdComponent))
      .componentInstance.document()).toBe(historicalDocument);
    const repeated = historicalUpdates.filter(entry => entry.update.mock.calls.length > 0);
    const calls = historicalUpdates.reduce((count, entry) => count + entry.update.mock.calls.length, 0);
    console.info(JSON.stringify({
      schema: 'chat-render-work-counts-v1',
      update: 'cloned-wrapper-tail-content',
      historyMessages: HISTORY_COUNT,
      historicalClassifiers: historicalUpdates.length,
      historicalClassifiersUpdated: repeated.length,
      historicalUpdateCalls: calls,
      tailUpdateCalls: tailUpdate.mock.calls.length,
    }));
    expect(calls, 'unchanged historical classifier.update calls after one tail update').toBe(0);
  }, 60000);

  it('still renders content and delivery mutations on the same message and delivery objects', () => {
    const { agent, fixture, row } = mountedConversation();
    const messages = agent.messages();
    const tail = messages[messages.length - 1];
    const delivery = tail.delivery;
    const tailElement = row(tail.id).nativeElement;

    tail.content = 'Initial tail mutated in place';
    agent.messages.set([...messages]);
    fixture.detectChanges();
    expect(agent.messages().at(-1)).toBe(tail);
    expect(tail.delivery).toBe(delivery);
    expect(row(tail.id).nativeElement).toBe(tailElement);
    expect(row(tail.id).nativeElement.textContent).toContain('Initial tail mutated in place');
    expect(row(tail.id).componentInstance.streaming()).toBe(true);

    Object.assign(delivery, { phase: 'complete', outcome: 'success' });
    agent.messages.set([...agent.messages()]);
    fixture.detectChanges();
    expect(agent.messages().at(-1)).toBe(tail);
    expect(tail.delivery).toBe(delivery);
    expect(row(tail.id).componentInstance.streaming()).toBe(false);
    expect(row(tail.id).query(By.directive(ChatStreamingMdComponent))
      .componentInstance.document()).toEqual({
        generation: 'active-generation',
        phase: 'complete',
        content: 'Initial tail mutated in place',
      });
  }, 60000);

  it('does not push equal content again when only delivery phase changes within a generation', () => {
    const component = TestBed.createComponent(ChatComponent).componentInstance;
    const classifier = component.classifyMessage('same answer', {
      id: 'answer', delivery: streamingDelivery('g1'),
    });
    const update = vi.spyOn(classifier, 'update');

    expect(component.classifyMessage('same answer', {
      id: 'answer', delivery: completeDelivery('g1', 'success'),
    })).toBe(classifier);
    expect(classifier.markdown()).toBe('same answer');
    expect(update).not.toHaveBeenCalled();
  });

  it('replaces and disposes the classifier on a new generation even with identical content', () => {
    const component = TestBed.createComponent(ChatComponent).componentInstance;
    const previous = component.classifyMessage('same answer', {
      id: 'answer', delivery: streamingDelivery('g1'),
    });
    const dispose = vi.spyOn(previous, 'dispose');

    const current = component.classifyMessage('same answer', {
      id: 'answer', delivery: streamingDelivery('g2'),
    });
    expect(current).not.toBe(previous);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(current.markdown()).toBe('same answer');
    const update = vi.spyOn(current, 'update');
    component.classifyMessage('same answer', {
      id: 'answer', delivery: streamingDelivery('g2'),
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('pushes shortened or corrected content and retries a failed push before caching it', () => {
    const component = TestBed.createComponent(ChatComponent).componentInstance;
    const message = { id: 'answer', delivery: streamingDelivery('g1') };
    const classifier = component.classifyMessage('original longer answer', message);
    const update = vi.spyOn(classifier, 'update');

    component.classifyMessage('short', message);
    expect(classifier.markdown()).toBe('short');
    component.classifyMessage('other', message); // Equal length, different content.
    expect(classifier.markdown()).toBe('other');
    expect(update).toHaveBeenCalledTimes(2);

    const failure = Error('controlled classifier push failure');
    update.mockImplementationOnce(() => { throw failure; });
    expect(() => component.classifyMessage('corrected after failure', message)).toThrow(failure);
    component.classifyMessage('corrected after failure', message);
    expect(classifier.markdown()).toBe('corrected after failure');
    expect(update).toHaveBeenCalledTimes(4);
    component.classifyMessage('corrected after failure', message);
    expect(update).toHaveBeenCalledTimes(4);
  });
});
