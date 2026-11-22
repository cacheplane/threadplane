import { describe, it, expect, beforeEach } from 'vitest';
import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { views } from '@threadplane/angular/render';
import type { RenderEvent } from '@threadplane/angular/render';
import { mockAgent, type MockAgent } from '../../testing/mock-agent';
import { staticDelivery, type Message } from '../../agent';
import type { ClientToolLifecycle } from '../../client-tools/tool-def';
import { ChatToolViewsComponent } from './chat-tool-views.component';

// A minimal view component that renders the props it receives so the test
// can assert which fields reached it.
@Component({
  selector: 'chat-test-weather-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="loc">{{ location() }}</div>
    <div class="temp">{{ temperatureF() }}</div>
    <div class="st">{{ status() }}</div>
    <div class="tool-id">{{ clientTool()?.id }}</div>
    <div class="tool-phase">{{ clientTool()?.phase }}</div>
    <div class="tool-result">{{ clientTool()?.hasResult }}</div>
    <div class="tool-error">{{ clientTool()?.error }}</div>
  `,
})
class TestWeatherCardComponent {
  readonly location = input<string | undefined>(undefined);
  readonly temperatureF = input<number | undefined>(undefined);
  readonly status = input<string | undefined>(undefined);
  readonly clientTool = input<ClientToolLifecycle | undefined>(undefined);
}

async function mountHost(agent: MockAgent, message: Message | undefined) {
  @Component({
    standalone: true,
    imports: [ChatToolViewsComponent],
    template: `<chat-tool-views [agent]="agent" [message]="message" [views]="reg" />`,
  })
  class HostComponent {
    readonly agent = agent;
    readonly message = message;
    readonly reg = views({ weather_card: TestWeatherCardComponent });
  }
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  // Views render inside a @defer block: let it load.
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

describe('ChatToolViewsComponent', () => {
  let agent: MockAgent;
  const msg: Message = { id: 'm1', role: 'assistant', content: '', toolCallIds: ['c1'], delivery: staticDelivery('m1') };

  beforeEach(() => {
    agent = mockAgent();
  });

  it('mounts the registered view for a matching tool name and passes running args + status', async () => {
    agent.toolCalls.set([
      { id: 'c1', name: 'weather_card', args: { location: 'San Francisco' }, status: 'running' },
    ]);
    const fixture = await mountHost(agent, msg);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('chat-test-weather-card')).toBeTruthy();
    expect(el.querySelector('.loc')?.textContent).toContain('San Francisco');
    expect(el.querySelector('.st')?.textContent).toContain('running');
    expect(el.querySelector('.tool-id')?.textContent).toContain('c1');
    expect(el.querySelector('.tool-phase')?.textContent).toContain('running');
    expect(el.querySelector('.tool-result')?.textContent).toContain('false');
  });

  it('merges result fields on completion', async () => {
    agent.toolCalls.set([
      {
        id: 'c1', name: 'weather_card',
        args: { location: 'San Francisco' },
        status: 'complete',
        result: { location: 'San Francisco', temperatureF: 68, conditions: 'Sunny' },
      },
    ]);
    const fixture = await mountHost(agent, msg);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.temp')?.textContent).toContain('68');
    expect(el.querySelector('.st')?.textContent).toContain('complete');
    expect(el.querySelector('.tool-phase')?.textContent).toContain('complete');
    expect(el.querySelector('.tool-result')?.textContent).toContain('true');
  });

  it('parses a JSON-object string result into props (LangGraph ToolMessage content)', async () => {
    agent.toolCalls.set([
      {
        id: 'c1', name: 'weather_card',
        args: { location: 'San Francisco' },
        status: 'complete',
        result: '{"temperatureF": 68, "conditions": "Sunny"}',
      },
    ]);
    const fixture = await mountHost(agent, msg);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.temp')?.textContent).toContain('68');
    expect(el.querySelector('.loc')?.textContent).toContain('San Francisco');
    expect(el.querySelector('.tool-result')?.textContent).toContain('true');
  });

  it('leaves a non-object string result alone', async () => {
    agent.toolCalls.set([
      { id: 'c1', name: 'weather_card', args: { location: 'SF' }, status: 'complete', result: 'Human response: approved' },
      { id: 'c2', name: 'weather_card', args: { location: 'LA' }, status: 'complete', result: '[1, 2]' },
    ]);
    const twoCalls: Message = { id: 'm2', role: 'assistant', content: '', toolCallIds: ['c1', 'c2'], delivery: staticDelivery('m2') };
    const fixture = await mountHost(agent, twoCalls);
    const el = fixture.nativeElement as HTMLElement;
    const temps = Array.from(el.querySelectorAll('.temp')).map((n) => n.textContent?.trim());
    expect(temps).toEqual(['', '']);
    const locs = Array.from(el.querySelectorAll('.loc')).map((n) => n.textContent?.trim());
    expect(locs).toEqual(['SF', 'LA']);
  });

  it('passes error lifecycle state to the registered view', async () => {
    agent.toolCalls.set([
      {
        id: 'c1',
        name: 'weather_card',
        args: { location: 'San Francisco' },
        status: 'error',
        error: 'handler failed',
      },
    ]);
    const fixture = await mountHost(agent, msg);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.tool-phase')?.textContent).toContain('error');
    expect(el.querySelector('.tool-result')?.textContent).toContain('true');
    expect(el.querySelector('.tool-error')?.textContent).toContain('handler failed');
  });

  it('mounts the view for a call the model is still writing, as running with the arguments read so far', async () => {
    agent.streamingToolCalls.set([
      { id: 'c1', name: 'weather_card', argsText: '{"location":"San Fr', args: { location: 'San Fr' } },
    ]);
    const fixture = await mountHost(agent, msg);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.loc')?.textContent).toContain('San Fr');
    expect(el.querySelector('.st')?.textContent).toContain('running');
    expect(el.querySelector('.tool-phase')?.textContent).toContain('running');
    expect(el.querySelector('.tool-result')?.textContent).toContain('false');

    // The finished call replaces the streaming one under the same id.
    agent.streamingToolCalls.set([]);
    agent.toolCalls.set([
      { id: 'c1', name: 'weather_card', args: { location: 'San Francisco' }, status: 'complete', result: { temperatureF: 68 } },
    ]);
    fixture.detectChanges();
    expect(el.querySelectorAll('chat-test-weather-card')).toHaveLength(1);
    expect(el.querySelector('.loc')?.textContent).toContain('San Francisco');
    expect(el.querySelector('.temp')?.textContent).toContain('68');
  });

  it('renders nothing for an unregistered tool name', async () => {
    agent.toolCalls.set([
      { id: 'c1', name: 'lookup_flight', args: { flight: 'UA1' }, status: 'complete', result: {} },
    ]);
    const fixture = await mountHost(agent, msg);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('chat-test-weather-card')).toBeNull();
  });

  it('renders nothing when views is undefined', () => {
    agent.toolCalls.set([
      { id: 'c1', name: 'weather_card', args: {}, status: 'running' },
    ]);

    @Component({
      standalone: true,
      imports: [ChatToolViewsComponent],
      template: `<chat-tool-views [agent]="agent" [message]="message" />`,
    })
    class BareHost {
      readonly agent = agent;
      readonly message = msg;
    }
    const fixture = TestBed.createComponent(BareHost);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('chat-test-weather-card')).toBeNull();
  });

  it('forwards RenderResultEvent emitted by inner chat-generative-ui via the events output', () => {
    agent.toolCalls.set([
      { id: 'c1', name: 'weather_card', args: { location: 'LA' }, status: 'running' },
    ]);

    const emitted: RenderEvent[] = [];

    @Component({
      standalone: true,
      imports: [ChatToolViewsComponent],
      template: `<chat-tool-views [agent]="agent" [message]="message" [views]="reg" (events)="onEvent($event)" />`,
    })
    class EventHost {
      readonly agent = agent;
      readonly message = msg;
      readonly reg = views({ weather_card: TestWeatherCardComponent });
      onEvent(ev: RenderEvent): void { emitted.push(ev); }
    }

    const fixture = TestBed.createComponent(EventHost);
    fixture.detectChanges();

    // Grab the ChatToolViewsComponent instance and spy on its events output
    const toolViewsEl = (fixture.nativeElement as HTMLElement).querySelector('chat-tool-views');
    expect(toolViewsEl).toBeTruthy();

    // Directly emit through the component's output to verify the binding works end-to-end
    const toolViewsDebug = fixture.debugElement.query(
      (el) => el.componentInstance instanceof ChatToolViewsComponent,
    );
    const toolViewsInstance = toolViewsDebug.componentInstance as ChatToolViewsComponent;

    // Clear any lifecycle events that fired during detectChanges (e.g. render-spec 'mounted')
    emitted.length = 0;

    const resultEvent: RenderEvent = { type: 'result', value: { selected: 'sunny' }, elementKey: 'weather_card' };
    toolViewsInstance.events.emit(resultEvent);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual(resultEvent);
  });
});
