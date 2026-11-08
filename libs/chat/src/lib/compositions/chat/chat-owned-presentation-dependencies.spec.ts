import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VERSION } from '@angular/core';
import { getActiveConsumer } from '@angular/core/primitives/signals';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ChatComponent } from './chat.component';
import { ChatGenerativeUiComponent } from '../../primitives/chat-generative-ui/chat-generative-ui.component';
import type { ContentClassifier } from '../../streaming/content-classifier';
import { mockAgent } from '../../testing/mock-agent';
import { staticDelivery, streamingDelivery, type Message } from '../../agent';

type GraphNode = { producerNode?: unknown[]; producers?: Link; producersTail?: Link };
type Link = { nextProducer?: Link };
function producerCount(node: GraphNode): { count: number; shape: 'array' | 'linked' } {
  if ('producerNode' in node) return { count: node.producerNode?.length ?? 0, shape: 'array' };
  if ('producers' in node && 'producersTail' in node) {
    const seen = new Set<Link>();
    for (let link = node.producers; link !== undefined; link = link.nextProducer) {
      if (seen.has(link)) throw new Error('Reactive producer graph contains a cycle');
      seen.add(link);
    }
    return { count: seen.size, shape: 'linked' };
  }
  throw new Error('Unrecognized Angular reactive producer representation');
}

type ObservedChat = {
  ownedMarkdownBodyFor(id: string): unknown;
  reconcileOwnedMarkdownBodies(...args: unknown[]): unknown;
  classifiers: Map<string, { classifier: ContentClassifier }>;
};

describe('Chat owned presentation reactive dependency bounds', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [ChatComponent] }));
  afterEach(() => vi.restoreAllMocks());

  it.each(['stable', 'fresh'] as const)('keeps the real parent consumer bounded at H20/40/80 for %s tail updates', async wrappers => {
    const observations: Array<{ history: number; count: number; rootCount: number; shape: string }> = [];
    for (const history of [20, 40, 80]) {
      const messages: Message[] = [
        ...Array.from({ length: history }, (_, index): Message => ({ id: `history-${index}`, role: 'assistant', content: `Answer **${index}**`, delivery: staticDelivery(`history-${index}`) })),
        { id: 'tail', role: 'assistant', content: 'Tail', delivery: streamingDelivery('tail') },
      ];
      const agent = mockAgent({ messages, isLoading: true });
      const fixture = TestBed.createComponent(ChatComponent);
      const instance = fixture.componentInstance as unknown as ObservedChat;
      const original = instance.ownedMarkdownBodyFor;
      const rootConsumers = new Set<GraphNode>();
      const reconcile = instance.reconcileOwnedMarkdownBodies;
      const rootSpy = vi.spyOn(instance, 'reconcileOwnedMarkdownBodies').mockImplementation(function (this: ObservedChat, ...args) {
        const consumer = getActiveConsumer();
        expect(consumer).not.toBeNull(); rootConsumers.add(consumer as GraphNode);
        return reconcile.apply(this, args);
      });
      const consumers = new Set<GraphNode>();
      const spy = vi.spyOn(instance, 'ownedMarkdownBodyFor').mockImplementation(function (this: ObservedChat, id) {
        const consumer = getActiveConsumer();
        expect(consumer, 'real assistant row executes under an Angular consumer').not.toBeNull();
        consumers.add(consumer as GraphNode);
        return original.call(this, id);
      });
      fixture.componentRef.setInput('agent', agent);
      fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
      expect(rootConsumers.size).toBe(1);
      const rootConsumer = [...rootConsumers][0];
      consumers.clear(); rootConsumers.clear();
      const next = agent.messages().map(message => message.id === 'tail' ? { ...message, content: 'Tail changed' } : message);
      agent.messages.set(wrappers === 'fresh' ? next.map(message => ({ ...message, delivery: { ...message.delivery } })) : next);
      fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
      expect(spy).toHaveBeenCalled(); expect(consumers.size).toBeGreaterThan(0);
      expect(rootConsumers.size).toBe(1); expect([...rootConsumers][0]).toBe(rootConsumer);
      const counts = [...consumers].map(producerCount);
      observations.push({ history, count: Math.max(...counts.map(value => value.count)), rootCount: producerCount(rootConsumer).count, shape: counts[0].shape });
      expect(fixture.nativeElement.textContent).toContain('Tail changed');
      fixture.destroy(); spy.mockRestore(); rootSpy.mockRestore();
    }
    process.stdout.write(`OWNED_PRESENTATION_CONSUMERS ${JSON.stringify({ angular: VERSION.full, wrappers, observations })}\n`);
    for (const observation of observations) expect(observation.count, `H${observation.history} actual assistant-template consumer producer dependencies`).toBeLessThanOrEqual(64);
    expect(Math.max(...observations.map(value => value.count)) - Math.min(...observations.map(value => value.count))).toBeLessThanOrEqual(4);
  });

  it('keeps actual classifier metadata updates scheduled without a message or config change', async () => {
    const message: Message = { id: 'answer', role: 'assistant', content: 'Initial prose', delivery: streamingDelivery('answer') };
    const agent = mockAgent({ messages: [message] });
    const fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput('agent', agent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const classifier = (fixture.componentInstance as unknown as ObservedChat).classifiers.get('answer')!.classifier;
    const before = agent.messages();
    expect(fixture.debugElement.query(By.directive(ChatGenerativeUiComponent))).toBeNull();
    classifier.update(JSON.stringify({ root: 'root', elements: { root: { type: 'Text', props: { text: 'Out of band metadata' } } } }));
    expect(classifier.spec()).not.toBeNull();
    // No detectChanges or input mutation: the actual Angular scheduler must run.
    await fixture.whenStable();
    const rich = fixture.debugElement.query(By.directive(ChatGenerativeUiComponent));
    expect(rich).not.toBeNull();
    expect(rich.componentInstance.spec()).toBe(classifier.spec());
    expect(agent.messages()).toBe(before); expect(message.content).toBe('Initial prose');
    fixture.destroy();
  });
  it('rebinds the metadata bridge to a replacement generation and stops observing the old classifier', async () => {
    const agent = mockAgent({ messages: [{ id: 'answer', role: 'assistant', content: 'First', delivery: streamingDelivery('first') }] });
    const fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput('agent', agent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const observed = fixture.componentInstance as unknown as ObservedChat;
    const old = observed.classifiers.get('answer')!.classifier;
    agent.messages.set([{ id: 'answer', role: 'assistant', content: 'Replacement', delivery: streamingDelivery('second') }]);
    await fixture.whenStable();
    const current = observed.classifiers.get('answer')!.classifier;
    expect(current).not.toBe(old);
    const spec = (text: string) => JSON.stringify({ root: 'root', elements: { root: { type: 'Text', props: { text } } } });
    current.update(spec('Current generation metadata'));
    await fixture.whenStable();
    const rich = fixture.debugElement.query(By.directive(ChatGenerativeUiComponent));
    expect(rich).not.toBeNull(); expect(rich.componentInstance.spec()).toBe(current.spec());
    const displayed = current.spec();
    const currentSpecRead = vi.spyOn(current, 'spec');
    old.update(spec('Stale generation metadata'));
    await fixture.whenStable();
    // No stale dependency should schedule the bridge or a root reconciliation.
    expect(currentSpecRead).not.toHaveBeenCalled();
    expect(rich.componentInstance.spec()).toBe(displayed);
    expect(agent.messages()[0].content).toBe('Replacement');
    fixture.destroy();
  });

});

describe('Chat owned presentation bridge lifetime', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [ChatComponent] }));
  afterEach(() => vi.restoreAllMocks());
  it.each(['remove', 'clear', 'agent-switch', 'destroy'] as const)('releases the real row effect on %s', async action => {
    const agent = mockAgent({ messages: [{ id: 'answer', role: 'assistant', content: 'Answer', delivery: streamingDelivery('answer') }] });
    const fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput('agent', agent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const observed = fixture.componentInstance as unknown as {
      ownedMarkdownBodies: Map<string, { bridge?: { destroy(): void } }>;
      clearClassifiers(): void;
    };
    const row = observed.ownedMarkdownBodies.get('answer')!;
    expect(row.bridge, 'owned effect exists on the mounted row').toBeDefined();
    const destroy = vi.spyOn(row.bridge!, 'destroy');
    if (action === 'remove') {
      agent.messages.set([]); fixture.detectChanges(); await fixture.whenStable();
    } else if (action === 'clear') {
      observed.clearClassifiers();
    } else if (action === 'agent-switch') {
      fixture.componentRef.setInput('agent', mockAgent({ messages: [] }));
      fixture.detectChanges(); await fixture.whenStable();
    } else fixture.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
    if (action !== 'destroy') fixture.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
