import { Component, inject, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it, vi } from 'vitest';
import { signalStateStore, views } from '@threadplane/render';
import { z } from 'zod/v4';
import { ChatComponent } from './chat.component';
import { ChatToolCallsComponent } from '../../primitives/chat-tool-calls/chat-tool-calls.component';
import { ChatToolViewsComponent } from '../../primitives/chat-tool-views/chat-tool-views.component';
import { mockAgent } from '../../testing/mock-agent';
import { staticDelivery, streamingDelivery, type Message } from '../../agent';
import { ChatMessageListComponent } from '../../primitives/chat-message-list/chat-message-list.component';
import { CHAT_LIFECYCLE } from '../../lifecycle';
import { tools, view } from '../../client-tools/tools';
import type { ClientToolsCapability } from '../../client-tools/client-tools-capability';
import { ChatActivityTemplateDirective } from './chat-activity-template.directive';
import {
  ChatDefaultMessageListComponent,
  type ChatDefaultRowsRenderer,
} from './chat-default-message-list.component';

@Component({
  standalone: true,
  selector: 'chat-undefined-view-probe',
  template: `<span class="view-result">{{ query() }}</span>`,
})
class ViewProbe {
  readonly query = input('');
  readonly chat = inject(ChatComponent);
  readonly lifecycle = inject(CHAT_LIFECYCLE);
  readonly list = inject(ChatMessageListComponent);
}

@Component({
  standalone: true,
  imports: [ChatComponent, ChatActivityTemplateDirective],
  template: `<chat [agent]="agent" [views]="registry"
    ><ng-template chatActivityTemplate>Custom activity</ng-template></chat
  >`,
})
class ActivityHost {
  readonly registry = views({ lookup: ViewProbe });
  readonly agent = mockAgent({
    messages: [
      {
        id: 'a',
        role: 'assistant',
        content: 'answer',
        toolCallIds: ['call'],
        delivery: staticDelivery('a'),
      },
    ],
    toolCalls: [
      {
        id: 'call',
        name: 'lookup',
        args: { query: 'custom activity view' },
        status: 'running',
      },
    ],
  });
}

describe('default composition with an undefined tool-view registry', () => {
  it.each([40, 80])(
    'does not create empty tool-view components at H%i or on fresh publication',
    async (historyCount) => {
      const history: Message[] = Array.from(
        { length: historyCount },
        (_, i) => ({
          id: `h-${i}`,
          role: i % 2 ? 'user' : 'assistant',
          content: `history ${i}`,
          delivery: staticDelivery(`g-${i}`),
        })
      );
      const tail: Message = {
        id: 'tail',
        role: 'assistant',
        content: 'tail',
        delivery: streamingDelivery('tail'),
      };
      const agent = mockAgent({
        messages: [...history, tail],
        isLoading: true,
      });
      const fixture = TestBed.createComponent(ChatComponent);
      fixture.componentRef.setInput('agent', agent);
      fixture.detectChanges();
      await fixture.whenStable();
      const originalRows = [
        ...fixture.nativeElement.querySelectorAll(
          'chat-message-list > chat-message'
        ),
      ];
      const tools = fixture.debugElement
        .queryAll(By.directive(ChatToolCallsComponent))
        .map((node) => node.componentInstance as ChatToolCallsComponent);
      expect(originalRows).toHaveLength(historyCount + 1);
      expect(tools).toHaveLength(historyCount / 2 + 1);
      const check = (messages: Message[]) => {
        const rows = [
          ...fixture.nativeElement.querySelectorAll(
            'chat-message-list > chat-message'
          ),
        ];
        expect(rows).toHaveLength(originalRows.length);
        rows.forEach((row, i) => expect(row).toBe(originalRows[i]));
        const assistantMessages = messages.filter(
          (message) => message.role === 'assistant'
        );
        const currentTools = fixture.debugElement.queryAll(
          By.directive(ChatToolCallsComponent)
        );
        expect(currentTools).toHaveLength(tools.length);
        currentTools.forEach((node, i) => {
          expect(node.componentInstance).toBe(tools[i]);
          expect(node.componentInstance.message()).toBe(assistantMessages[i]);
        });
        return fixture.debugElement.queryAll(
          By.directive(ChatToolViewsComponent)
        ).length;
      };
      const initialViewHosts = check(agent.messages());
      const fresh = agent.messages().map((message) => ({
        ...message,
        ...(message.id === 'tail' ? { content: 'tail changed' } : {}),
      }));
      agent.messages.set(fresh);
      fixture.detectChanges();
      await fixture.whenStable();
      const publishedViewHosts = check(fresh);
      expect(originalRows.at(-1).textContent).toContain('tail changed');
      expect(originalRows.at(-1).getAttribute('data-current')).toBe('true');
      expect(originalRows.at(-1).getAttribute('data-streaming')).toBe('true');
      process.stdout.write(
        `${JSON.stringify({
          historyCount,
          initialViewHosts,
          publishedViewHosts,
          rows: originalRows.length,
          toolHosts: tools.length,
        })}\n`
      );
      expect.soft(initialViewHosts).toBe(0);
      expect(publishedViewHosts).toBe(0);
    }
  );

  it('reacts to registry transitions without losing current raw messages, DI, or events', async () => {
    const original: Message = {
      id: 'a',
      role: 'assistant',
      content: 'answer',
      toolCallIds: [],
      delivery: staticDelivery('a'),
    };
    const unknown = {
      id: 'unknown',
      role: 'unknown',
      content: 'fallback',
      toolCallIds: [],
      delivery: staticDelivery('unknown'),
    } as unknown as Message;
    const agent = mockAgent({ messages: [original, unknown] });
    const fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput('agent', agent);
    const firstStore = signalStateStore({ phase: 'first' });
    const firstHandlers = { clicked: () => 'first' };
    fixture.componentRef.setInput('store', firstStore);
    fixture.componentRef.setInput('handlers', firstHandlers);
    const settle = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
    };
    const hosts = () =>
      fixture.debugElement.queryAll(By.directive(ChatToolViewsComponent));
    await settle();
    expect(hosts()).toHaveLength(0);

    fixture.componentRef.setInput('views', views({}));
    await settle();
    const firstHosts = hosts();
    expect(firstHosts).toHaveLength(2);
    firstHosts.forEach((node, i) => {
      expect(node.componentInstance.message()).toBe(agent.messages()[i]);
      expect(node.componentInstance.store()).toBe(firstStore);
      expect(node.componentInstance.handlers()).toBe(firstHandlers);
    });
    fixture.componentRef.setInput('views', views({ lookup: ViewProbe }));
    await settle();
    expect(hosts()).toHaveLength(firstHosts.length);
    hosts().forEach((node, i) =>
      expect(node.componentInstance).toBe(firstHosts[i].componentInstance)
    );

    const published = agent.messages();
    original.toolCallIds!.push('late');
    agent.toolCalls.set([
      {
        id: 'late',
        name: 'lookup',
        args: { query: 'late linked' },
        status: 'running',
      },
    ]);
    await settle();
    expect(agent.messages()).toBe(published);
    const probe = fixture.debugElement.query(By.directive(ViewProbe))
      .componentInstance as ViewProbe;
    expect(probe.query()).toBe('late linked');
    expect(probe.chat).toBe(fixture.componentInstance);
    expect(probe.lifecycle).toBe(
      fixture.debugElement.injector.get(CHAT_LIFECYCLE)
    );
    expect(probe.list).toBe(
      fixture.debugElement.query(By.directive(ChatMessageListComponent))
        .componentInstance
    );
    expect(hosts()[0].componentInstance.message()).toBe(original);
    const eventHandler = vi.spyOn(
      fixture.componentInstance as unknown as {
        onClientToolEvent: (event: unknown) => void;
      },
      'onClientToolEvent'
    );
    const event = {
      type: 'result' as const,
      value: 'clicked',
      elementKey: 'lookup',
    };
    (hosts()[0].componentInstance as ChatToolViewsComponent).events.emit(event);
    expect(eventHandler).toHaveBeenCalledWith(event);

    // Replacing a component class at an already mounted registry key has a
    // separate preexisting RenderSpec context-snapshot limitation. This
    // contract verifies live registry identity without claiming hot swapping.
    const replacementRegistry = views({ lookup: ViewProbe, unused: ViewProbe });
    const nextStore = signalStateStore({ phase: 'next' });
    const nextHandlers = { clicked: () => 'next' };
    fixture.componentRef.setInput('views', replacementRegistry);
    fixture.componentRef.setInput('store', nextStore);
    fixture.componentRef.setInput('handlers', nextHandlers);
    await settle();
    expect(hosts()).toHaveLength(firstHosts.length);
    hosts().forEach((node, i) => {
      expect(node.componentInstance).toBe(firstHosts[i].componentInstance);
      expect(node.componentInstance.views()).toBe(replacementRegistry);
      expect(node.componentInstance.store()).toBe(nextStore);
      expect(node.componentInstance.handlers()).toBe(nextHandlers);
      expect(node.componentInstance.message()).toBe(agent.messages()[i]);
    });
    expect(
      fixture.nativeElement.querySelector('.view-result').textContent
    ).toBe('late linked');
    const fresh = agent.messages().map((message) => ({ ...message }));
    agent.messages.set(fresh);
    await settle();
    expect(hosts()).toHaveLength(firstHosts.length);
    hosts().forEach((node, i) => {
      expect(node.componentInstance).toBe(firstHosts[i].componentInstance);
      expect(node.componentInstance.message()).toBe(fresh[i]);
    });
    expect(
      fixture.nativeElement.querySelector('.view-result').textContent
    ).toBe('late linked');

    fixture.componentRef.setInput('views', undefined);
    await settle();
    expect(hosts()).toHaveLength(0);
    expect(fixture.nativeElement.querySelector('.view-result')).toBeNull();
    fixture.componentRef.setInput('views', views({ lookup: ViewProbe }));
    await settle();
    expect(hosts()).toHaveLength(2);
    hosts().forEach((node, i) => {
      expect(node.componentInstance).not.toBe(firstHosts[i].componentInstance);
      expect(node.componentInstance.message()).toBe(fresh[i]);
    });
    expect(
      fixture.nativeElement.querySelector('.view-result').textContent
    ).toBe('late linked');
  });

  it('renders client-tool-only views and retains catalog and automatic acknowledgement', async () => {
    const agent = mockAgent({
      messages: [
        {
          id: 'a',
          role: 'assistant',
          content: 'answer',
          toolCallIds: ['call'],
          delivery: staticDelivery('a'),
        },
      ],
      toolCalls: [
        {
          id: 'call',
          name: 'lookup',
          args: { query: 'client registry' },
          status: 'running',
        },
      ],
    });
    const pending = signal(agent.toolCalls());
    const capability: ClientToolsCapability = {
      pending,
      setCatalog: vi.fn(),
      resolve: vi.fn(),
    };
    Object.assign(agent, { clientTools: capability });
    const fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput('agent', agent);
    fixture.componentRef.setInput(
      'clientTools',
      tools({
        lookup: view('Look up', z.object({ query: z.string() }), ViewProbe),
      })
    );
    fixture.detectChanges();
    await fixture.whenStable();
    // Coordinator connection is queued outside its creating effect; let the
    // genuinely connected auto-ack effect run in the next Angular pass.
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.views()).toBeUndefined();
    expect(
      fixture.debugElement.queryAll(By.directive(ChatToolViewsComponent))
    ).toHaveLength(1);
    expect(
      fixture.nativeElement.querySelector('.view-result').textContent
    ).toBe('client registry');
    expect(capability.setCatalog).toHaveBeenCalled();
    expect(capability.resolve).toHaveBeenCalledWith('call', {
      ok: true,
      value: { shown: true },
    });
  });

  it('keeps configured views with custom activity while default tool templates stay lazy', async () => {
    const fixture = TestBed.createComponent(ActivityHost);
    const chat = fixture.debugElement.query(By.directive(ChatComponent))
      .componentInstance as ChatComponent;
    const templates = vi.spyOn(chat, 'toolCallTemplates');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(templates).not.toHaveBeenCalled();
    expect(
      fixture.debugElement.queryAll(By.directive(ChatToolCallsComponent))
    ).toHaveLength(0);
    expect(
      fixture.debugElement.queryAll(By.directive(ChatToolViewsComponent))
    ).toHaveLength(1);
    expect(
      fixture.nativeElement.querySelector('.view-result').textContent
    ).toBe('custom activity view');
  });

  it.each([
    { messages: [] },
    {
      messages: [
        {
          id: 'u',
          role: 'user',
          content: 'human',
          delivery: staticDelivery('u'),
        },
      ] as Message[],
    },
  ])(
    'does not evaluate view configuration for no-AI history',
    async ({ messages }) => {
      const fixture = TestBed.createComponent(ChatComponent);
      fixture.componentRef.setInput('agent', mockAgent({ messages }));
      // Observe the actual row delegate, excluding the existing independent
      // Chat state-sync effect's legitimate resolvedStore/effectiveViews reads.
      const renderer = (
        fixture.componentInstance as unknown as {
          defaultRowRenderer: ChatDefaultRowsRenderer;
        }
      ).defaultRowRenderer;
      const read = vi.spyOn(renderer, 'effectiveViews');
      fixture.detectChanges();
      await fixture.whenStable();
      expect(read).not.toHaveBeenCalled();
      expect(
        fixture.debugElement.queryAll(By.directive(ChatToolViewsComponent))
      ).toHaveLength(0);
    }
  );

  it('keeps the registry dependency but defers unused view store and handlers', async () => {
    const fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput(
      'agent',
      mockAgent({
        messages: [
          {
            id: 'a',
            role: 'assistant',
            content: 'plain answer',
            delivery: staticDelivery('a'),
          },
        ],
      })
    );
    const renderer = (
      fixture.componentInstance as unknown as {
        defaultRowRenderer: ChatDefaultRowsRenderer;
      }
    ).defaultRowRenderer;
    const effective = vi.spyOn(renderer, 'effectiveViews');
    const store = vi.spyOn(renderer, 'resolvedStore');
    const handlers = vi.spyOn(renderer, 'handlers');
    fixture.detectChanges();
    await fixture.whenStable();
    const list = fixture.debugElement.query(
      By.directive(ChatDefaultMessageListComponent)
    ).componentInstance as ChatDefaultMessageListComponent;
    expect(list.renderer()).toBe(renderer);
    expect(effective).toHaveBeenCalled();
    expect.soft(store).not.toHaveBeenCalled();
    expect.soft(handlers).not.toHaveBeenCalled();
    fixture.componentRef.setInput('views', views({}));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(store).toHaveBeenCalled();
    expect(handlers).toHaveBeenCalled();
    const child = fixture.debugElement.query(
      By.directive(ChatToolViewsComponent)
    ).componentInstance as ChatToolViewsComponent;
    expect(child.store()).toBe(fixture.componentInstance.resolvedStore());
    expect(child.handlers()).toBe(fixture.componentInstance.handlers());
  });
});
