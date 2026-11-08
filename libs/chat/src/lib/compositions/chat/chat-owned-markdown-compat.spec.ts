import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component, getDebugNode, signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { signalStateStore, views } from '@threadplane/render';
import { ChatComponent } from './chat.component';
import { ChatActivityTemplateDirective } from './chat-activity-template.directive';
import { ChatToolCallTemplateDirective } from '../../primitives/chat-tool-calls/chat-tool-call-template.directive';
import { ChatMessageComponent } from '../../primitives/chat-message/chat-message.component';
import { ChatToolCallsComponent } from '../../primitives/chat-tool-calls/chat-tool-calls.component';
import { ChatToolViewsComponent } from '../../primitives/chat-tool-views/chat-tool-views.component';
import { ChatMessageActionsComponent } from '../../primitives/chat-message-actions/chat-message-actions.component';
import { ChatGenerativeUiComponent } from '../../primitives/chat-generative-ui/chat-generative-ui.component';
import { CitationsResolverService } from '../../markdown/citations-resolver.service';
import { A2uiSurfaceComponent } from '../../a2ui/surface.component';
import { a2uiBasicCatalog } from '../../a2ui/catalog';
import { ChatStreamingMdComponent, STREAMING_MARKDOWN_CONTRACT_VIOLATION_POLICY, type StreamingMarkdownDocument } from '../../streaming/streaming-markdown.component';
import { createContentClassifier, type ContentClassifier } from '../../streaming/content-classifier';
import { mockAgent } from '../../testing/mock-agent';
import { staticDelivery, streamingDelivery, type Message } from '../../agent';

const answer = (id = 'answer', content = 'Original **answer**'): Message => ({
  id, role: 'assistant', content, delivery: streamingDelivery(`${id}-generation`),
});
type ObservedChat = {
  classifiers: Map<string, { classifier: ContentClassifier }>;
  markdownDocumentFor(content: string, message: Pick<Message, 'id' | 'delivery'>): StreamingMarkdownDocument;
  reconcileOwnedMarkdownBodies(...args: unknown[]): unknown;
};

async function mount(messages = [answer()]) {
  const agent = mockAgent({ messages });
  const fixture = TestBed.createComponent(ChatComponent);
  fixture.componentRef.setInput('agent', agent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const rows = () => fixture.debugElement.queryAll(By.directive(ChatMessageComponent));
  const row = (id = 'answer') => rows().find(value => value.componentInstance.message()?.id === id)!;
  const md = (id = 'answer') => row(id).query(By.directive(ChatStreamingMdComponent)).componentInstance as ChatStreamingMdComponent;
  const body = (id = 'answer') => row(id).nativeElement.querySelector('.chat-message__assistant-body') as HTMLElement;
  const settle = async () => { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); };
  return { agent, fixture, rows, row, md, body, settle, observed: fixture.componentInstance as unknown as ObservedChat };
}

type Template = (this: unknown, flags: number, context: object, ...args: unknown[]) => unknown;
const restores: Array<() => void> = [];
function bodyInstance(body: HTMLElement): object {
  const debug = getDebugNode(body)!;
  const token = debug.providerTokens.find(value => typeof value === 'function' && 'ɵcmp' in value);
  expect(token, 'component registered on this body node').toBeDefined();
  return debug.injector.get(token as Type<object>);
}
function observeUpdates(body: HTMLElement) {
  const component = bodyInstance(body);
  const tView = (component.constructor as unknown as { ɵcmp: { tView: { template: Template } } }).ɵcmp.tView;
  const original = tView.template;
  const counts = new WeakMap<object, number>();
  tView.template = function (this: unknown, flags, context, ...args) {
    if (flags & 2) counts.set(context, (counts.get(context) ?? 0) + 1);
    return original.call(this, flags, context, ...args);
  };
  restores.push(() => { tView.template = original; });
  return (instance: object) => counts.get(instance) ?? 0;
}

@Component({ standalone: true, template: '<span>registered view</span>' })
class RegisteredView {}

// Same signal-driven projection pattern as chat-shared-template-reads.spec.ts.
@Component({
  standalone: true,
  imports: [ChatComponent, ChatActivityTemplateDirective, ChatToolCallTemplateDirective],
  template: `<chat [agent]="agent">
    @if (activity()) { <ng-template chatActivityTemplate let-message><span class="activity">{{ label() }}:{{ message.id }}</span></ng-template> }
    @if (named()) { <ng-template chatToolCallTemplate="search" let-call><span class="named">{{ label() }}:{{ call.id }}</span></ng-template> }
    @if (wildcard()) { <ng-template chatToolCallTemplate="*" let-call><span class="wildcard">{{ label() }}:{{ call.id }}</span></ng-template> }
  </chat>`,
})
class ProjectionHost {
  readonly agent = mockAgent({ messages: [{ ...answer(), toolCallIds: ['call'] }],
    toolCalls: [{ id: 'call', name: 'search', args: {}, status: 'complete' }] });
  readonly activity = signal(false);
  readonly named = signal(false);
  readonly wildcard = signal(false);
  readonly label = signal('first');
}

@Component({
  standalone: true, imports: [ChatMessageComponent],
  template: `<chat-message [role]="role()" speaker="Reader" [current]="true" [streaming]="true">
    <span class="before">before</span>
    <span class="generic">generic</span>
    <span class="after">after</span>
    <button chatMessageControls>control</button>
  </chat-message>`,
})
class ManualHost { readonly role = signal<'assistant' | 'user' | 'system'>('assistant'); }

describe('Chat owned markdown compatibility', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [ChatComponent, ProjectionHost, ManualHost] }));
  afterEach(() => { restores.splice(0).reverse().forEach(restore => restore()); vi.restoreAllMocks(); });

  it('renders notified same-object content, phase and generation edits', async () => {
    const view = await mount();
    const raw = view.agent.messages()[0];
    const delivery = raw.delivery;
    const body = view.body();
    const markdown = view.md();
    const oldClassifier = view.observed.classifiers.get(raw.id)!.classifier;
    const update = vi.spyOn(oldClassifier, 'update');
    const dispose = vi.spyOn(oldClassifier, 'dispose');
    raw.content += ' appended';
    view.agent.messages.set([raw]);
    await view.settle();
    expect(view.body().textContent).toContain('Original answer appended');
    Object.assign(delivery, { phase: 'complete', outcome: 'success' });
    view.agent.messages.set([raw]);
    await view.settle();
    expect(view.md().document().phase).toBe('complete');
    expect(update).toHaveBeenCalledTimes(1);
    Object.assign(delivery, { generation: 'replacement', phase: 'streaming' });
    view.agent.messages.set([raw]);
    await view.settle();
    expect(view.md()).toBe(markdown);
    expect(view.body()).toBe(body);
    expect(view.row().componentInstance.message()).toBe(raw);
    expect(raw.delivery).toBe(delivery);
    expect(view.md().document().generation).toBe('replacement');
    expect(view.observed.classifiers.get(raw.id)!.classifier).not.toBe(oldClassifier);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('honors the existing rebuild policy for shortened and corrected same-generation content', async () => {
    TestBed.overrideProvider(STREAMING_MARKDOWN_CONTRACT_VIOLATION_POLICY, { useValue: 'rebuild' });
    const view = await mount();
    const raw = view.agent.messages()[0];
    const markdown = view.md();
    for (const content of ['short', 'other']) {
      raw.content = content;
      view.agent.messages.set([raw]);
      await view.settle();
      expect(view.md()).toBe(markdown);
      expect(view.body().textContent).toBe(content);
      expect(view.md().document().content).toBe(content);
    }
  });

  it.each([
    ['short', 'content-shrink'],
    ['Corrected **text**!', 'content-divergence'],
  ])('propagates the default same-generation %s contract failure through the owned body', async (content, reason) => {
    const view = await mount();
    expect(TestBed.inject(STREAMING_MARKDOWN_CONTRACT_VIOLATION_POLICY)).toBe('throw');
    const raw = view.agent.messages()[0];
    const classifier = view.observed.classifiers.get(raw.id)!.classifier;
    const update = vi.spyOn(classifier, 'update');
    const before = view.body().textContent;
    if (reason === 'content-divergence') expect(content.length).toBe(String(raw.content).length);
    raw.content = content;
    view.agent.messages.set([raw]);
    expect(() => view.fixture.detectChanges()).toThrow(`contract violation: ${reason}`);
    expect(update).toHaveBeenCalledWith(content);
    expect(classifier.markdown()).toBe(content);
    expect(view.body().textContent).toBe(before);
  });

  it('retries the identical notified snapshot after the actual classifier throws once', async () => {
    const view = await mount();
    const raw = view.agent.messages()[0];
    const classifier = view.observed.classifiers.get(raw.id)!.classifier;
    const update = vi.spyOn(classifier, 'update');
    const failure = Error('controlled owned-body classifier failure');
    update.mockImplementationOnce(() => { throw failure; });
    raw.content += ' retried';
    view.agent.messages.set([raw]);
    expect(() => view.fixture.detectChanges()).toThrow(failure);
    expect(update).toHaveBeenCalledTimes(1);
    // Republish the same object/content: normal notification, no changed payload.
    view.agent.messages.set([raw]);
    view.fixture.changeDetectorRef.markForCheck();
    await view.settle();
    expect(update).toHaveBeenCalledTimes(2);
    expect(view.body().textContent).toContain('Original answer retried');
    expect(view.row().componentInstance.message()).toBe(raw);
  });

  it.each(['clearClassifiers', 'clearThread'] as const)('rebinds equal snapshots after public %s on a root-only refresh', async clear => {
    const view = await mount();
    const messages = view.agent.messages();
    const raw = messages[0];
    const oldClassifier = view.observed.classifiers.get('answer')!.classifier;
    const dispose = vi.spyOn(oldClassifier, 'dispose');
    const document = view.md().document();
    const markdown = view.md();
    const refresh = vi.spyOn(view.observed, 'reconcileOwnedMarkdownBodies');
    view.fixture.componentInstance[clear]();
    view.fixture.changeDetectorRef.markForCheck();
    await view.settle();
    // Negative control for the original failing fixture trigger: marking the
    // fixture root does not check the nested OnPush composition in this setup.
    expect(refresh).not.toHaveBeenCalled();
    // A real root input update checks the OnPush composition without changing
    // the messages signal or the row's raw input.
    view.fixture.componentRef.setInput('placeholder', 'After reset');
    await view.settle();
    expect(refresh).toHaveBeenCalled();
    expect(view.agent.messages()).toBe(messages);
    expect(view.row().componentInstance.message()).toBe(raw);
    expect(view.observed.classifiers.get('answer')!.classifier).not.toBe(oldClassifier);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(view.md()).toBe(markdown);
    expect(view.md().document()).not.toBe(document);
    expect(view.md().document()).toEqual(document);
    expect(view.body().textContent).toContain('Original answer');
  });

  it('invalidates equal-ID snapshots on agent replacement and notified removal/reinsertion', async () => {
    const view = await mount();
    const raw = view.agent.messages()[0];
    const previous = view.observed.classifiers.get(raw.id)!.classifier;
    const dispose = vi.spyOn(previous, 'dispose');
    const replacement = mockAgent({ messages: [{ ...raw }] });
    view.fixture.componentRef.setInput('agent', replacement);
    await view.settle();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(view.row().componentInstance.message()).toBe(replacement.messages()[0]);
    const current = view.observed.classifiers.get(raw.id)!.classifier;
    const removed = vi.spyOn(current, 'dispose');
    replacement.messages.set([]);
    await view.settle();
    expect(view.rows()).toHaveLength(0);
    expect(removed).toHaveBeenCalledTimes(1);
    replacement.messages.set([raw]);
    await view.settle();
    expect(view.observed.classifiers.get(raw.id)!.classifier).not.toBe(current);
    expect(view.body().textContent).toContain('Original answer');
  });

  it('refreshes role/predecessor changes and the unknown-role AI fallback', async () => {
    const preceding: Message = { id: 'preceding', role: 'user', content: 'question', delivery: staticDelivery('p') };
    const view = await mount([preceding, answer()]);
    const raw = view.agent.messages()[1];
    expect(view.row().nativeElement.getAttribute('data-prev-role')).toBe('user');
    preceding.role = 'system';
    raw.role = 'user';
    view.agent.messages.set([preceding, raw]);
    await view.settle();
    expect(view.fixture.nativeElement.querySelectorAll('chat-streaming-md')).toHaveLength(0);
    expect(view.fixture.nativeElement.querySelector('chat-message[data-role="user"]').textContent).toContain('Original **answer**');
    Object.assign(raw, { role: 'unknown' });
    view.agent.messages.set([preceding, raw]);
    await view.settle();
    expect(view.row().nativeElement.getAttribute('data-prev-role')).toBe('system');
    expect(view.row().nativeElement.getAttribute('data-role')).toBe('assistant');
    expect(view.body().textContent).toContain('Original answer');
  });

  it('keeps projected activity/tool queries live while skipping the unchanged markdown body', async () => {
    const fixture = TestBed.createComponent(ProjectionHost);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const host = fixture.componentInstance;
    const markdown = fixture.debugElement.query(By.directive(ChatStreamingMdComponent)).componentInstance as ChatStreamingMdComponent;
    const document = markdown.document();
    const body = fixture.nativeElement.querySelector('.chat-message__assistant-body') as HTMLElement;
    const instance = bodyInstance(body);
    const updates = observeUpdates(body);
    for (const [toggle, selector] of [[host.wildcard, '.wildcard'], [host.named, '.named'], [host.activity, '.activity']] as const) {
      toggle.set(true); await fixture.whenStable();
      expect(fixture.nativeElement.querySelector(selector)).not.toBeNull();
      expect(fixture.debugElement.query(By.directive(ChatStreamingMdComponent)).componentInstance).toBe(markdown);
      expect(markdown.document()).toBe(document);
    }
    const chat = fixture.debugElement.query(By.directive(ChatComponent)).componentInstance as ChatComponent;
    const tools = vi.spyOn(chat, 'toolCallTemplates');
    host.label.set('latest'); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.activity').textContent).toBe('latest:answer');
    expect(tools).not.toHaveBeenCalled();
    host.activity.set(false); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.named').textContent).toBe('latest:call');
    expect(updates(instance)).toBe(0);
    expect(body.querySelector('chat-streaming-md')).not.toBeNull();
  });

  it('updates views, store, handlers, guards and latest raw callbacks without replacing markdown', async () => {
    const view = await mount([{ ...answer(), toolCallIds: ['call'] }]);
    view.agent.toolCalls.set([{ id: 'call', name: 'search', args: {}, status: 'complete' }]);
    const markdown = view.md(); const document = markdown.document(); const body = view.body();
    const toolView = view.row().query(By.directive(ChatToolViewsComponent)).componentInstance as ChatToolViewsComponent;
    const registry = views({ search: RegisteredView });
    const store = signalStateStore({ configured: true });
    const handlers = { selected: () => 'latest' };
    view.fixture.componentRef.setInput('views', registry);
    view.fixture.componentRef.setInput('store', store);
    view.fixture.componentRef.setInput('handlers', handlers);
    await view.settle();
    expect(toolView.views()).toBe(registry); expect(toolView.store()).toBe(store); expect(toolView.handlers()).toBe(handlers);
    expect(body.textContent).toContain('registered view');
    const blocked = signal(false);
    const latest = { ...view.agent.messages()[0], citations: [] };
    const replacement = { ...view.agent, isInputBlocked: blocked };
    view.fixture.componentRef.setInput('agent', replacement);
    replacement.messages.set([latest]);
    await view.settle();
    const actions = view.row().query(By.directive(ChatMessageActionsComponent)).componentInstance as ChatMessageActionsComponent;
    const onCopy = vi.spyOn(view.fixture.componentInstance, 'onCopy');
    actions.contentCopied.emit('copied');
    expect(onCopy).toHaveBeenCalledWith(latest, 'copied');
    blocked.set(true); await view.settle(); expect(actions.disabled()).toBe(true);
    blocked.set(false); replacement.isLoading.set(true); await view.settle(); expect(actions.disabled()).toBe(true);
    replacement.isLoading.set(false); await view.settle(); expect(actions.disabled()).toBe(false);
    expect(view.md()).toBe(markdown); expect(view.body()).toBe(body);
    // Agent swap intentionally rebinds an equal document; within the new agent
    // guards and configuration retain the same document.
    expect(view.md().document()).toEqual(document);
    const resolver = view.row().injector.get(CitationsResolverService);
    expect(resolver.message()).toBe(latest);
    expect(view.row().query(By.directive(ChatStreamingMdComponent)).injector.get(CitationsResolverService)).toBe(resolver);
    expect(toolView.message()).toBe(latest);
    expect(view.row().query(By.directive(ChatToolCallsComponent)).componentInstance.message()).toBe(latest);
  });

  it('keeps rich JSON rendering and global loading/handler inputs live beside a stable markdown sibling', async () => {
    const spec = JSON.stringify({ root: 'root', elements: { root: { type: 'Text', props: { text: 'rich answer' } } } });
    const view = await mount([answer(), answer('rich', spec)]);
    const markdown = view.md(); const document = markdown.document();
    const rich = view.row('rich').query(By.directive(ChatGenerativeUiComponent)).componentInstance as ChatGenerativeUiComponent;
    expect(view.body('rich').querySelector('chat-streaming-md')).toBeNull();
    expect(view.body('rich').lastElementChild?.className).toBe('chat-message__caret');
    const handlers = { selected: () => true };
    view.fixture.componentRef.setInput('handlers', handlers); view.agent.isLoading.set(true);
    await view.settle();
    expect(rich.handlers()).toBe(handlers); expect(rich.loading()).toBe(true);
    expect(view.md()).toBe(markdown); expect(view.md().document()).toBe(document);
    expect([...view.body('rich').children].map(child => child.tagName)).toEqual(['CHAT-TOOL-CALLS', 'CHAT-TOOL-VIEWS', 'CHAT-GENERATIVE-UI', 'SPAN']);
  });

  it.each(['json-render', 'a2ui'] as const)('keeps the same markdown subtree when controlled %s metadata appears on its own row', async kind => {
    const view = await mount();
    const body = view.body();
    const markdown = view.md();
    const node = body.querySelector('chat-streaming-md');
    const document = markdown.document();
    const instance = bodyInstance(body);
    const updates = observeUpdates(body);
    const classifier = view.observed.classifiers.get('answer')!.classifier;
    const markdownText = classifier.markdown();
    const push = vi.spyOn(classifier, 'update');
    // Controlled metadata exposure isolates projection ownership. The actual
    // classifier markdown signal, document computation and renderer stay real;
    // separate tests above/below cover real pure JSON/A2UI classification.
    const metadata = createContentClassifier();
    try {
      metadata.update(kind === 'json-render'
        ? JSON.stringify({ root: 'root', elements: { root: { type: 'Text', props: { text: 'Same-row rich answer' } } } })
        : '---a2ui_JSON---' +
          JSON.stringify({ version: 'v0.9', createSurface: { surfaceId: 'same-row', catalogId: 'basic' } }) + '\n' +
          JSON.stringify({ version: 'v0.9', updateComponents: { surfaceId: 'same-row', components: [{ id: 'root', component: 'Text', text: 'Same-row rich answer' }] } }) + '\n');
      expect(metadata.type()).toBe(kind);
      if (kind === 'json-render') {
        vi.spyOn(classifier, 'spec').mockImplementation(() => metadata.spec());
      } else {
        vi.spyOn(classifier, 'type').mockImplementation(() => metadata.type());
        vi.spyOn(classifier, 'a2uiSurfaces').mockImplementation(() => metadata.a2uiSurfaces());
        vi.spyOn(classifier, 'a2uiSurfaceStates').mockImplementation(() => metadata.a2uiSurfaceStates());
        // The root guard remains live even though markdown did not change.
        view.fixture.componentRef.setInput('placeholder', 'Metadata available');
        await view.settle();
        expect(body.querySelector('a2ui-surface')).toBeNull();
      }
      view.fixture.componentRef.setInput('views', a2uiBasicCatalog());
      await view.settle();
      const richTag = kind === 'json-render' ? 'CHAT-GENERATIVE-UI' : 'A2UI-SURFACE';
      expect([...body.children].map(child => child.tagName)).toEqual([
        'CHAT-TOOL-CALLS', 'CHAT-TOOL-VIEWS', 'CHAT-STREAMING-MD', richTag, 'SPAN',
      ]);
      expect(body.textContent).toContain('Same-row rich answer');
      const handlers = { selected: () => true };
      view.fixture.componentRef.setInput('handlers', handlers);
      view.agent.isLoading.set(true);
      await view.settle();
      if (kind === 'json-render') {
        const rich = view.row().query(By.directive(ChatGenerativeUiComponent)).componentInstance as ChatGenerativeUiComponent;
        expect(rich.handlers()).toBe(handlers); expect(rich.loading()).toBe(true);
      } else {
        const rich = view.row().query(By.directive(A2uiSurfaceComponent)).componentInstance as A2uiSurfaceComponent;
        expect(rich.handlers()).toBe(handlers);
        view.fixture.componentRef.setInput('views', undefined);
        await view.settle();
        expect(body.querySelector('a2ui-surface')).toBeNull();
      }
      expect(view.body()).toBe(body);
      expect(view.md()).toBe(markdown);
      expect(body.querySelector('chat-streaming-md')).toBe(node);
      expect(markdown.document()).toBe(document);
      expect(classifier.markdown()).toBe(markdownText);
      expect(push).not.toHaveBeenCalled();
      expect(updates(instance)).toBe(0);
      expect(body.lastElementChild?.className).toBe('chat-message__caret');
    } finally { metadata.dispose(); }
  });

  it('preserves manual mixed projection, controls, direction, speaker and caret order across roles', () => {
    const fixture = TestBed.createComponent(ManualHost);
    for (const role of ['assistant', 'user', 'system'] as const) {
      fixture.componentInstance.role.set(role); fixture.detectChanges();
      const row = fixture.nativeElement.querySelector('chat-message') as HTMLElement;
      const body = row.querySelector('div[dir="auto"]')!;
      expect(row.getAttribute('data-role')).toBe(role);
      expect(row.querySelector('.chat-message__speaker')?.textContent).toBe('Reader:');
      expect([...body.children].map(child => child.className)).toEqual(['before', 'generic', 'after', 'chat-message__caret']);
      expect(body.lastElementChild?.getAttribute('aria-hidden')).toBe('true');
      expect(row.querySelector('.chat-message__controls button')?.textContent).toBe('control');
      expect(body.querySelector('button')).toBeNull();
    }
  });

  it('keeps A2UI guards and in-place surface Maps live in the root projection', async () => {
    const content = '---a2ui_JSON---' +
      JSON.stringify({ version: 'v0.9', createSurface: { surfaceId: 'first', catalogId: 'basic' } }) + '\n' +
      JSON.stringify({ version: 'v0.9', updateComponents: { surfaceId: 'first', components: [{ id: 'root', component: 'Text', text: 'A2UI answer' }] } }) + '\n';
    const view = await mount([answer(), answer('surface', content)]);
    const markdown = view.md(); const document = markdown.document();
    const classifier = view.observed.classifiers.get('surface')!.classifier;
    const update = vi.spyOn(classifier, 'update');
    const body = view.body('surface');
    expect(body.querySelector('a2ui-surface')).toBeNull();
    const catalog = a2uiBasicCatalog();
    view.fixture.componentRef.setInput('views', catalog); await view.settle();
    expect(body.textContent).toContain('A2UI answer');
    const first = view.row('surface').query(By.directive(A2uiSurfaceComponent)).componentInstance as A2uiSurfaceComponent;
    expect(first.catalog()).toBe(catalog);
    const surfaces = classifier.a2uiSurfaces();
    const original = surfaces.get('first')!;
    const added = { ...original, surfaceId: 'second' };
    surfaces.set('second', added);
    const handlers = { selected: () => true };
    view.fixture.componentRef.setInput('handlers', handlers); await view.settle();
    const rendered = view.row('surface').queryAll(By.directive(A2uiSurfaceComponent));
    expect(rendered).toHaveLength(2);
    expect(rendered.map(value => value.componentInstance.surface())).toEqual([original, added]);
    expect(rendered.every(value => value.componentInstance.handlers() === handlers)).toBe(true);
    expect(classifier.a2uiSurfaces()).toBe(surfaces);
    expect(update).not.toHaveBeenCalled();
    expect(body.lastElementChild?.className).toBe('chat-message__caret');
    expect([...body.children].map(child => child.tagName)).toEqual(['CHAT-TOOL-CALLS', 'CHAT-TOOL-VIEWS', 'A2UI-SURFACE', 'A2UI-SURFACE', 'SPAN']);
    view.fixture.componentRef.setInput('views', undefined); await view.settle();
    expect(body.querySelector('a2ui-surface')).toBeNull();
    expect(view.md()).toBe(markdown); expect(view.md().document()).toBe(document);
  });

  it.each(['stable', 'fresh'] as const)('skips all 500 historical AI body updates in mixed H1000 %s history', async wrappers => {
    const history: Message[] = Array.from({ length: 1000 }, (_, index) => ({
      id: `history-${index}`, role: index % 2 ? 'user' : 'assistant', content: `History ${index}`,
      delivery: staticDelivery(`history-${index}`),
    }));
    const view = await mount([...history, answer('tail', 'Tail')]);
    const assistantRows = view.rows().filter(row => row.componentInstance.message()?.id.startsWith('history-'));
    expect(assistantRows).toHaveLength(500);
    const bodies = assistantRows.map(row => bodyInstance(row.nativeElement.querySelector('.chat-message__assistant-body')));
    const updates = observeUpdates(view.body('history-0'));
    const tail = bodyInstance(view.body('tail'));
    const helper = vi.spyOn(view.observed, 'markdownDocumentFor');
    const reconcile = vi.spyOn(view.observed, 'reconcileOwnedMarkdownBodies');
    const classifiers = [...view.observed.classifiers].map(([id, entry]) => ({ id, spy: vi.spyOn(entry.classifier, 'update') }));
    // Count actual raw content reads independently of helper/classifier/body
    // skips. This scan and human/root/raw-child work remain necessary O(N).
    let contentReads = 0;
    const next = view.agent.messages().map(message => {
      const value = message.id === 'tail' ? { ...message, content: 'Tail changed' } : wrappers === 'fresh' ? { ...message, delivery: { ...message.delivery } } : message;
      const content = value.content;
      Object.defineProperty(value, 'content', { configurable: true, enumerable: true, get: () => { contentReads++; return content; } });
      return value;
    });
    view.agent.messages.set(next); await view.settle();
    expect(view.body('tail').textContent).toContain('Tail changed');
    expect(updates(tail)).toBeGreaterThan(0);
    bodies.forEach((body, index) => expect(updates(body), `historical AI body ${index}`).toBe(0));
    expect(helper.mock.calls.filter(([, message]) => message.id.startsWith('history-'))).toHaveLength(0);
    expect(classifiers.filter(entry => entry.id.startsWith('history-')).reduce((sum, entry) => sum + entry.spy.mock.calls.length, 0)).toBe(0);
    expect(classifiers.find(entry => entry.id === 'tail')!.spy).toHaveBeenCalledTimes(1);
    expect(contentReads).toBeGreaterThanOrEqual(501);
    expect(reconcile).toHaveBeenCalled();
    view.rows().filter(row => row.componentInstance.message()).forEach(row => {
      expect(row.componentInstance.message()).toBe(next.find(message => message.id === row.componentInstance.message().id));
    });
    process.stdout.write(`${JSON.stringify({ schema: 'chat-owned-compat-mixed-history-v1', wrappers, historyMessages: 1000,
      historicalAiBodies: bodies.length, historicalBodyUpdates: bodies.reduce((sum, body) => sum + updates(body), 0),
      reconcileCalls: reconcile.mock.calls.length, rawContentReads: contentReads, tailBodyUpdates: updates(tail) })}\n`);
  }, 60000);
});
