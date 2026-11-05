import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { getActiveConsumer } from '@angular/core/primitives/signals';
import { By } from '@angular/platform-browser';
import { ChatComponent } from './chat.component';
import { ChatToolCallsComponent } from '../../primitives/chat-tool-calls/chat-tool-calls.component';
import { ChatToolViewsComponent } from '../../primitives/chat-tool-views/chat-tool-views.component';
import { mockAgent } from '../../testing/mock-agent';
import { staticDelivery, streamingDelivery, type Message } from '../../agent';

describe('list-owned history reactive work', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([40, 80])(
    'isolates %i historical rows from scroll state and still renders real publications',
    async (historyCount) => {
      const callbacks: FrameRequestCallback[] = [];
      vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(
        (callback) => {
          callbacks.push(callback);
          return callbacks.length;
        }
      );
      const flushFrames = () =>
        callbacks.splice(0).forEach((callback) => callback(performance.now()));
      const history: Message[] = Array.from(
        { length: historyCount },
        (_, index) => ({
          id: `history-${index}`,
          role: index % 2 ? 'user' : 'assistant',
          content: `History ${index}`,
          delivery: staticDelivery(`history-generation-${index}`),
        })
      );
      const tail: Message = {
        id: 'tail',
        role: 'assistant',
        content: 'Tail before',
        delivery: streamingDelivery('tail-generation'),
      };
      const messages = [...history, tail];
      const agent = mockAgent({ messages, isLoading: true });
      const fixture = TestBed.createComponent(ChatComponent);
      fixture.componentRef.setInput('agent', agent);
      const observations: object[] = [];
      const observe = () => {
        const consumer = getActiveConsumer();
        if (consumer) observations.push(consumer);
      };
      const originalClassify = fixture.componentInstance.classifyMessage.bind(
        fixture.componentInstance
      );
      const classifier = vi
        .spyOn(fixture.componentInstance, 'classifyMessage')
        .mockImplementation((content, message) => {
          if (message.id.startsWith('history-')) observe();
          return originalClassify(content, message);
        });
      const humanOwner = fixture.componentInstance as unknown as {
        humanContent(message: Message): string;
      };
      const originalHuman = humanOwner.humanContent.bind(humanOwner);
      const human = vi
        .spyOn(humanOwner, 'humanContent')
        .mockImplementation((message) => {
          if (message.id.startsWith('history-')) observe();
          return originalHuman(message);
        });
      fixture.detectChanges();
      const element = fixture.nativeElement as HTMLElement;
      const scroll = element.querySelector<HTMLElement>('.chat-scroll')!;
      let scrollTop = 2000;
      Object.defineProperties(scroll, {
        scrollHeight: { configurable: true, value: 2400 },
        clientHeight: { configurable: true, value: 400 },
        scrollTop: {
          configurable: true,
          get: () => scrollTop,
          set: (value: number) => {
            scrollTop = Math.max(0, Math.min(2000, value));
          },
        },
      });
      flushFrames();
      fixture.componentInstance.scrollToBottom();
      flushFrames();
      fixture.detectChanges();
      const originalRows = [
        ...element.querySelectorAll('chat-message-list > chat-message'),
      ];
      const originalTools = fixture.debugElement.queryAll(
        By.directive(ChatToolCallsComponent)
      );
      const originalViews = fixture.debugElement.queryAll(
        By.directive(ChatToolViewsComponent)
      );
      expect(originalRows).toHaveLength(historyCount + 1);
      expect(originalTools).toHaveLength(historyCount / 2 + 1);
      expect(originalViews).toHaveLength(historyCount / 2 + 1);
      const assertAllRowsAndRawMessages = (expected: readonly Message[]) => {
        const currentRows = [
          ...element.querySelectorAll('chat-message-list > chat-message'),
        ];
        expect(currentRows).toHaveLength(originalRows.length);
        currentRows.forEach((node, index) =>
          expect(node).toBe(originalRows[index])
        );
        const assistantMessages = expected.filter(
          (message) => message.role === 'assistant'
        );
        for (const [Directive, original] of [
          [ChatToolCallsComponent, originalTools],
          [ChatToolViewsComponent, originalViews],
        ] as const) {
          const children = fixture.debugElement.queryAll(
            By.directive(Directive)
          );
          expect(children).toHaveLength(original.length);
          expect(children).toHaveLength(assistantMessages.length);
          children.forEach((child, index) => {
            expect(child.componentInstance).toBe(
              original[index].componentInstance
            );
            expect(child.componentInstance.message()).toBe(
              assistantMessages[index]
            );
          });
        }
      };

      const historicalReads = () =>
        classifier.mock.calls.filter(([, message]) =>
          message.id.startsWith('history-')
        ).length +
        human.mock.calls.filter(([message]) =>
          message.id.startsWith('history-')
        ).length;
      const pinned = (
        fixture.componentInstance as unknown as { pinned(): boolean }
      ).pinned;
      // Warm through actual scroll-owner transitions so both renderers have
      // their real steady-state consumers; no forced embedded-view refresh.
      scroll.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -600,
          bubbles: true,
          cancelable: true,
        })
      );
      scroll.scrollTop = 1400;
      scroll.dispatchEvent(new Event('scroll'));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      fixture.detectChanges();
      fixture.componentInstance.scrollToBottom();
      flushFrames();
      fixture.detectChanges();
      const initialConsumers = [...new Set(observations)];
      expect(
        initialConsumers.length,
        'instrumentation must observe actual initial consumers'
      ).toBeGreaterThan(0);
      let recording = false;
      let actualNextProducerReads = 0;
      const restored: Array<() => void> = [];
      const wrapped = new Set<object>();
      const wrap = (link: object | undefined) => {
        if (!link || wrapped.has(link)) return;
        const descriptor = Object.getOwnPropertyDescriptor(
          link,
          'nextProducer'
        );
        if (
          !descriptor ||
          !Object.hasOwn(descriptor, 'value') ||
          !descriptor.configurable ||
          !descriptor.writable
        )
          throw new Error('unexpected real link descriptor');
        wrapped.add(link);
        let value = descriptor.value as object | undefined;
        const get = () => {
          if (recording) actualNextProducerReads++;
          return value;
        };
        const set = (next: object | undefined) => {
          value = next;
          wrap(next);
        };
        Object.defineProperty(link, 'nextProducer', {
          enumerable: descriptor.enumerable,
          configurable: true,
          get,
          set,
        });
        restored.push(() => {
          const current = Object.getOwnPropertyDescriptor(link, 'nextProducer');
          if (current?.get !== get || current?.set !== set)
            throw new Error('instrumented descriptor changed');
          Object.defineProperty(link, 'nextProducer', { ...descriptor, value });
          const actual = Object.getOwnPropertyDescriptor(link, 'nextProducer');
          if (
            actual?.value !== value ||
            actual.writable !== descriptor.writable ||
            actual.enumerable !== descriptor.enumerable ||
            actual.configurable !== descriptor.configurable ||
            actual.get ||
            actual.set
          )
            throw new Error('latest link value/descriptor restoration failed');
        });
        wrap(value);
      };
      let primaryFailed = false;
      let primaryError: unknown;
      const restorationErrors: unknown[] = [];
      try {
        for (const consumer of initialConsumers)
          wrap((consumer as { producers?: object }).producers);
        expect(
          wrapped.size,
          'instrumentation must wrap actual existing links'
        ).toBeGreaterThan(0);
        observations.length = 0;
        classifier.mockClear();
        human.mockClear();
        recording = true;

        scroll.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: -600,
            bubbles: true,
            cancelable: true,
          })
        );
        scroll.scrollTop = 1400;
        scroll.dispatchEvent(new Event('scroll'));
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        fixture.detectChanges();
        recording = false;
        const unpinLinkReads = actualNextProducerReads;
        const unpinReads = historicalReads();
        expect(pinned()).toBe(false);
        expect(scroll.scrollTop).toBe(1400);
        expect(element.querySelector('chat-scroll-bubble')).not.toBeNull();
        expect(agent.messages()).toBe(messages);
        assertAllRowsAndRawMessages(messages);
        const unpinnedTools = fixture.debugElement.queryAll(
          By.directive(ChatToolCallsComponent)
        );
        expect(unpinnedTools[0].componentInstance).toBe(
          originalTools[0].componentInstance
        );
        expect(unpinnedTools[0].componentInstance.message()).toBe(history[0]);

        observations.length = 0;
        classifier.mockClear();
        human.mockClear();
        actualNextProducerReads = 0;
        recording = true;
        fixture.componentInstance.scrollToBottom();
        flushFrames();
        fixture.detectChanges();
        recording = false;
        const returnLinkReads = actualNextProducerReads;
        const returnReads = historicalReads();
        expect(pinned()).toBe(true);
        expect(scroll.scrollTop).toBe(2000);
        expect(element.querySelector('chat-scroll-bubble')).toBeNull();
        expect(agent.messages()).toBe(messages);
        assertAllRowsAndRawMessages(messages);

        actualNextProducerReads = 0;
        recording = true;
        const nextMessages = [
          ...history,
          { ...tail, content: 'Tail before, after streaming delta' },
        ];
        agent.messages.set(nextMessages);
        fixture.detectChanges();
        recording = false;
        const publicationLinkReads = actualNextProducerReads;
        const rows = element.querySelectorAll(
          'chat-message-list > chat-message'
        );
        expect(rows).toHaveLength(historyCount + 1);
        expect(agent.messages()).toBe(nextMessages);
        assertAllRowsAndRawMessages(nextMessages);
        expect(rows[historyCount].textContent).toContain(
          'Tail before, after streaming delta'
        );
        expect(rows[historyCount].getAttribute('data-streaming')).toBe('true');
        expect(rows[0]).toBe(originalRows[0]);
        expect(
          fixture.debugElement
            .queryAll(By.directive(ChatToolCallsComponent))[0]
            .componentInstance.message()
        ).toBe(history[0]);
        process.stdout.write(
          `${JSON.stringify({
            schema: 'chat-history-reactive-work-v1',
            historyCount,
            unpinReads,
            returnReads,
            unpinLinkReads,
            returnLinkReads,
            publicationLinkReads,
            instrumentedLinks: wrapped.size,
            scope:
            'lower bound of observed real ReactiveLink nextProducer reads across all walks; new unobserved chains may escape; source-toolchain only, no timing claim',
          })}\n`
        );
        expect(unpinReads, 'list-owned rows must skip unrelated unpin').toBe(0);
        expect(returnReads, 'list-owned rows must skip unrelated return').toBe(
          0
        );
        expect(
          historicalReads(),
          'real publication still reevaluates rows'
        ).toBeGreaterThan(0);
        expect(
          publicationLinkReads,
          'actual link instrumentation observes a real publication'
        ).toBeGreaterThan(0);
        // Deterministic diagnostic bound: actual old-control observations were
        // 19 reads per historical row on unpin. Leave headroom without admitting
        // the candidate's measured superlinear traversal. No time assertion.
        expect(unpinLinkReads).toBeLessThanOrEqual(historyCount * 100);
      } catch (error) {
        primaryFailed = true;
        primaryError = error;
      } finally {
        recording = false;
        for (const restore of restored.reverse()) {
          try {
            restore();
          } catch (error) {
            restorationErrors.push(error);
          }
        }
      }
      if (restorationErrors.length)
        throw new AggregateError(
          [...(primaryFailed ? [primaryError] : []), ...restorationErrors],
          'reactive-work verification or restoration failed'
        );
      if (primaryFailed) throw primaryError;
    }
  );
});
