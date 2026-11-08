import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component, getDebugNode, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ChatComponent } from './chat.component';
import { ChatMessageComponent } from '../../primitives/chat-message/chat-message.component';
import { ChatToolCallsComponent } from '../../primitives/chat-tool-calls/chat-tool-calls.component';
import { ChatToolViewsComponent } from '../../primitives/chat-tool-views/chat-tool-views.component';
import { ChatMessageActionsComponent } from '../../primitives/chat-message-actions/chat-message-actions.component';
import { ChatCitationsComponent } from '../../primitives/chat-citations/chat-citations.component';
import { CitationsResolverService } from '../../markdown/citations-resolver.service';
import { ChatStreamingMdComponent, type StreamingMarkdownDocument } from '../../streaming/streaming-markdown.component';
import type { ContentClassifier } from '../../streaming/content-classifier';
import { mockAgent } from '../../testing/mock-agent';
import { completeDelivery, staticDelivery, streamingDelivery, type Message } from '../../agent';

const HISTORY_COUNT = 20;
type Wrappers = 'stable' | 'fresh';

async function mount() {
  const initial: Message[] = [
    ...Array.from({ length: HISTORY_COUNT }, (_, index): Message => ({
      id: `history-${index}`, role: 'assistant', content: `Historical **answer ${index}**.`,
      delivery: staticDelivery(`history-${index}`),
    })),
    { id: 'tail', role: 'assistant', content: 'Tail **answer**', delivery: streamingDelivery('tail-generation') },
  ];
  const agent = mockAgent({ messages: initial, isLoading: true });
  const fixture = TestBed.createComponent(ChatComponent);
  fixture.componentRef.setInput('agent', agent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const rows = () => fixture.debugElement.queryAll(By.directive(ChatMessageComponent));
  const row = (id: string) => rows().find(element => element.componentInstance.message()?.id === id)!;
  const markdown = (id: string) => row(id).query(By.directive(ChatStreamingMdComponent)).componentInstance as ChatStreamingMdComponent;
  const body = (id: string): HTMLElement => row(id).nativeElement.querySelector('.chat-message__assistant-body');
  const publish = async (wrappers: Wrappers, phase: 'streaming' | 'complete' = 'streaming') => {
    const changed = agent.messages().map(message => message.id === 'tail' ? {
      ...message, content: 'Tail **answer** and next token',
      delivery: phase === 'complete' ? completeDelivery('tail-generation', 'success') : message.delivery,
    } : message);
    agent.messages.set(wrappers === 'fresh' ? changed.map(message => ({ ...message, delivery: { ...message.delivery } })) : changed);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  return { agent, fixture, rows, row, markdown, body, publish };
}

// Element shape deliberately ignores Angular comment anchors and reports scope
// attributes separately. Projection may add comments without adding layout boxes.
function elementShape(element: Element): unknown {
  return {
    tag: element.tagName,
    attributes: [...element.attributes].filter(attribute => !/^_ng(host|content)-/.test(attribute.name))
      .map(attribute => [attribute.name, attribute.value]).sort(),
    children: [...element.children].map(elementShape),
  };
}

function scopeAttributeCount(element: Element): number {
  return [element, ...element.querySelectorAll('*')].reduce((count, child) => count +
    [...child.attributes].filter(attribute => /^_ng(host|content)-/.test(attribute.name)).length, 0);
}

type Template = (this: unknown, flags: number, context: object, ...args: unknown[]) => unknown;
const restoreTemplates: Array<() => void> = [];

function bodyComponent(body: HTMLElement): object | null {
  const debug = getDebugNode(body);
  // DebugNode.componentInstance falls back to the owning parent component on a
  // plain div. Only accept a component provider registered on this exact node.
  const token = debug?.providerTokens.find(candidate => typeof candidate === 'function' && 'ɵcmp' in candidate);
  return token ? debug!.injector.get(token as Type<object>) : null;
}

function observeActualBodyUpdates(body: HTMLElement) {
  // Public Angular inspection discovers the component on the existing div.
  // No import of the proposed private component, and no production diagnostic.
  const component = bodyComponent(body);
  expect(component, 'the existing assistant body div owns a component').not.toBeNull();
  const definition = (component!.constructor as unknown as {
    ɵcmp: { tView: { template: Template } | null };
  }).ɵcmp;
  const tView = definition.tView;
  expect(tView, 'the mounted owned body has a real TView').not.toBeNull();
  const original = tView!.template;
  expect(original).toBeTypeOf('function');
  const counts = new WeakMap<object, number>();
  tView!.template = function (this: unknown, flags, context, ...args) {
    if (flags & 2) counts.set(context, (counts.get(context) ?? 0) + 1);
    return original.call(this, flags, context, ...args);
  };
  restoreTemplates.push(() => { tView!.template = original; });
  return { count: (context: object) => counts.get(context) ?? 0 };
}

@Component({
  standalone: true,
  imports: [ChatMessageComponent],
  template: '<chat-message role="assistant"><span class="unmanaged">manual content</span></chat-message>',
})
class ManualMessageHost {}

describe('Chat owned default markdown body', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [ChatComponent, ManualMessageHost] }));
  afterEach(() => {
    for (const restore of restoreTemplates.splice(0).reverse()) restore();
    vi.restoreAllMocks();
  });

  it.each(['stable', 'fresh'] as const)('preserves H20 rendering, raw inputs and document identity for %s wrappers', async wrappers => {
    const view = await mount();
    const originalRows = view.rows();
    const historicalBody = view.body('history-0');
    const shape = elementShape(historicalBody);
    const document = view.markdown('history-0').document();
    const controls = view.row('history-0').query(By.directive(ChatMessageActionsComponent));
    expect(historicalBody.tagName).toBe('DIV');
    expect(historicalBody.getAttribute('dir')).toBe('auto');
    expect([...historicalBody.children].map(element => element.tagName)).toEqual([
      'CHAT-TOOL-CALLS', 'CHAT-TOOL-VIEWS', 'CHAT-STREAMING-MD', 'SPAN',
    ]);
    expect(historicalBody.querySelector('strong')?.textContent).toBe('answer 0');
    expect(historicalBody.lastElementChild?.className).toBe('chat-message__caret');
    expect(historicalBody.lastElementChild?.getAttribute('aria-hidden')).toBe('true');
    expect(historicalBody.lastElementChild?.getAttribute('style')).toBeNull();
    expect(controls.nativeElement.parentElement.className).toBe('chat-message__controls');
    expect(view.body('tail').querySelector('.chat-message__caret')).not.toBeNull();

    await view.publish(wrappers);
    view.rows().forEach((row, index) => {
      expect(row.nativeElement).toBe(originalRows[index].nativeElement);
      const raw = view.agent.messages()[index];
      expect(row.componentInstance.message()).toBe(raw);
      expect(row.query(By.directive(ChatToolCallsComponent)).componentInstance.message()).toBe(raw);
      expect(row.query(By.directive(ChatToolViewsComponent)).componentInstance.message()).toBe(raw);
      expect(row.query(By.directive(ChatCitationsComponent)).componentInstance.message()).toBe(raw);
      const resolver = row.injector.get(CitationsResolverService);
      expect(resolver.message()).toBe(raw);
      expect(row.query(By.directive(ChatStreamingMdComponent)).injector.get(CitationsResolverService)).toBe(resolver);
    });
    expect(view.body('history-0')).toBe(historicalBody);
    expect(elementShape(historicalBody)).toEqual(shape);
    expect(view.markdown('history-0').document()).toBe(document);
    expect(view.row('history-0').query(By.directive(ChatMessageActionsComponent)).componentInstance).toBe(controls.componentInstance);
    expect(view.body('tail').textContent).toContain('Tail answer and next token');
    expect(view.markdown('tail').document()).toEqual({ generation: 'tail-generation', phase: 'streaming', content: 'Tail **answer** and next token' });
    expect(view.row('tail').nativeElement.getAttribute('data-streaming')).toBe('true');
    await view.publish(wrappers, 'complete');
    expect(view.markdown('tail').document().phase).toBe('complete');
    expect(view.row('tail').nativeElement.getAttribute('data-streaming')).toBe('false');
    process.stdout.write(`${JSON.stringify({ schema: 'chat-owned-body-scope-count-v1', wrappers,
      historicalBodyScopeAttributes: scopeAttributeCount(historicalBody), caretScopeAttributes: scopeAttributeCount(historicalBody.lastElementChild!) })}\n`);
  });

  it.each(['stable', 'fresh'] as const)('does not visit historical markdownDocumentFor on an H20 %s tail delta', async wrappers => {
    const view = await mount();
    const chat = view.fixture.componentInstance as unknown as {
      markdownDocumentFor: (content: string, message: Pick<Message, 'id' | 'delivery'>) => StreamingMarkdownDocument;
      classifiers: Map<string, { classifier: ContentClassifier }>;
    };
    const helper = vi.spyOn(chat, 'markdownDocumentFor');
    const updates = [...chat.classifiers].map(([id, entry]) => ({ id, spy: vi.spyOn(entry.classifier, 'update') }));
    await view.publish(wrappers);
    await view.publish(wrappers, 'complete');
    const historicalVisits = helper.mock.calls.filter(([, message]) => message.id.startsWith('history-'));
    const historicalVisitsById = Object.fromEntries(Array.from({ length: HISTORY_COUNT }, (_, index) => {
      const id = `history-${index}`;
      return [id, historicalVisits.filter(([, message]) => message.id === id).length];
    }));
    const historicalUpdates = updates.filter(entry => entry.id.startsWith('history-')).reduce((sum, entry) => sum + entry.spy.mock.calls.length, 0);
    const tailUpdates = updates.find(entry => entry.id === 'tail')!.spy.mock.calls.length;
    process.stdout.write(`${JSON.stringify({ schema: 'chat-owned-body-operation-counts-v1', historyCount: HISTORY_COUNT, wrappers,
      historicalHelperVisits: historicalVisits.length, historicalVisitsById, historicalClassifierUpdates: historicalUpdates, tailClassifierUpdates: tailUpdates })}\n`);
    // These counts measure different operations; none is a total-work or timing claim.
    expect(historicalUpdates, 'unchanged historical classifier bodies').toBe(0);
    expect(tailUpdates, 'changed tail reaches the actual classifier').toBe(1);
    expect(view.markdown('tail').document().phase).toBe('complete');
    expect(historicalVisits, 'historical markdownDocumentFor visits after creation').toHaveLength(0);
    for (const [id, count] of Object.entries(historicalVisitsById)) expect(count, `${id} markdownDocumentFor visits after creation`).toBe(0);
  });

  it.each(['stable', 'fresh'] as const)('skips actual historical body TView UPDATE execution for an H20 %s tail delta', async wrappers => {
    const view = await mount();
    const historicalBody = view.body('history-0');
    const tailBody = view.body('tail');
    const observer = observeActualBodyUpdates(historicalBody);
    const historical = Array.from({ length: HISTORY_COUNT }, (_, index) => bodyComponent(view.body(`history-${index}`))!);
    historical.forEach(component => expect(component).not.toBeNull());
    const tail = bodyComponent(tailBody);
    expect(tail, 'the tail uses the same owned-body component type').not.toBeNull();
    expect(tail!.constructor).toBe(historical[0].constructor);
    await view.publish(wrappers);
    await view.publish(wrappers, 'complete');
    expect(view.body('history-0')).toBe(historicalBody);
    expect(bodyComponent(historicalBody)).toBe(historical[0]);
    expect(view.body('tail')).toBe(tailBody);
    expect(observer.count(tail!), 'changed tail actually executes the wrapped shared TView UPDATE').toBeGreaterThan(0);
    historical.forEach((component, index) => expect(observer.count(component), `history-${index} body TView UPDATE executions`).toBe(0));
    expect(view.markdown('tail').document().phase).toBe('complete');
  });

  it('keeps manually projected unmanaged content before the original final caret', () => {
    const fixture = TestBed.createComponent(ManualMessageHost);
    fixture.detectChanges();
    const body: HTMLElement = fixture.nativeElement.querySelector('.chat-message__assistant-body');
    expect([...body.children].map(element => element.className)).toEqual(['unmanaged', 'chat-message__caret']);
    expect(body.textContent).toBe('manual content');
    expect(body.lastElementChild?.getAttribute('aria-hidden')).toBe('true');
    expect(body.lastElementChild?.getAttribute('style')).toBeNull();
  });
});
