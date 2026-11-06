import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { views } from '@threadplane/render';
import { ChatComponent } from './chat.component';
import { ChatToolCallsComponent } from '../../primitives/chat-tool-calls/chat-tool-calls.component';
import { ChatToolViewsComponent } from '../../primitives/chat-tool-views/chat-tool-views.component';
import { mockAgent } from '../../testing/mock-agent';
import { staticDelivery, streamingDelivery, type Message } from '../../agent';

describe('history row isolation from scroll-owner state', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([20, 200])(
    'does not reevaluate %i unchanged historical rows while unpinning and returning',
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
      // Keep the configured-view branch active so all existing component and
      // raw-reference preservation assertions remain meaningful.
      fixture.componentRef.setInput('views', views({}));
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

      const classifier = vi.spyOn(fixture.componentInstance, 'classifyMessage');
      const human = vi.spyOn(
        fixture.componentInstance as unknown as {
          humanContent(message: Message): string;
        },
        'humanContent'
      );
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

      classifier.mockClear();
      human.mockClear();
      fixture.componentInstance.scrollToBottom();
      flushFrames();
      fixture.detectChanges();
      const returnReads = historicalReads();
      expect(pinned()).toBe(true);
      expect(scroll.scrollTop).toBe(2000);
      expect(element.querySelector('chat-scroll-bubble')).toBeNull();
      expect(agent.messages()).toBe(messages);
      assertAllRowsAndRawMessages(messages);

      const nextMessages = [
        ...history,
        { ...tail, content: 'Tail before, after streaming delta' },
      ];
      agent.messages.set(nextMessages);
      fixture.detectChanges();
      const rows = element.querySelectorAll('chat-message-list > chat-message');
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
          schema: 'chat-history-owner-work-v1',
          historyCount,
          unpinReads,
          returnReads,
          unchangedOriginalMessagesDuringScroll: true,
        })}\n`
      );
      expect
        .soft(
          unpinReads,
          'unrelated unpin must not reevaluate unchanged historical rows'
        )
        .toBe(0);
      expect(
        returnReads,
        'unrelated public return must not reevaluate unchanged historical rows'
      ).toBe(0);
    }
  );
});
