import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { AGENT_LIFECYCLE, createAgentRef, injectAgent } from '@threadplane/angular';
import { provideAgentValue } from '@threadplane/angular/testing';
import type { AgentSession } from '@threadplane/core';
import { ChatComponent } from '../compositions/chat/chat.component';
import { mockAgent } from './mock-agent';

afterEach(() => TestBed.resetTestingModule());

/** A feature component as an app writes it: it injects its agent, ref-less. */
@Component({
  selector: 'chat-test-assistant-page',
  standalone: true,
  imports: [ChatComponent],
  template: `
    <output data-testid="status">{{ agent.status() }}</output>
    <chat [agent]="agent" />
  `,
})
class AssistantPage {
  readonly agent = injectAgent();
  readonly lifecycle = inject(AGENT_LIFECYCLE);
}

describe('provideAgentValue with mockAgent()', () => {
  it('hands a component that calls injectAgent() the mock, and the view follows it', () => {
    const agent = mockAgent({
      messages: [{ id: 'a1', role: 'assistant', content: 'Hello from the mock' }],
    });
    TestBed.configureTestingModule({ providers: [provideAgentValue(agent)] });
    const view = TestBed.createComponent(AssistantPage);
    view.detectChanges();
    expect(view.componentInstance.agent).toBe(agent);
    const text = () => (view.nativeElement as HTMLElement).textContent ?? '';
    expect(text()).toContain('Hello from the mock');
    expect(text()).toContain('idle');

    agent.status.set('running');
    agent.messages.set([
      { id: 'a1', role: 'assistant', content: 'Hello from the mock' },
      { id: 'a2', role: 'assistant', content: 'A second reply' },
    ]);
    view.detectChanges();
    expect(text()).toContain('running');
    expect(text()).toContain('A second reply');
  });

  it('records the commands the component sends', async () => {
    const agent = mockAgent();
    TestBed.configureTestingModule({ providers: [provideAgentValue(agent)] });
    const view = TestBed.createComponent(AssistantPage);
    await view.componentInstance.agent.submit('Plan a trip');
    expect(agent.submitCalls.map((call) => call.input)).toEqual(['Plan a trip']);
  });

  it('resolves AGENT_LIFECYCLE to the mock’s writable marks', () => {
    const agent = mockAgent();
    TestBed.configureTestingModule({ providers: [provideAgentValue(agent)] });
    const view = TestBed.createComponent(AssistantPage);
    expect(view.componentInstance.lifecycle).toBe(agent.lifecycle);
    agent.lifecycle.streamStartedAt.set(42);
    expect(view.componentInstance.lifecycle.streamStartedAt()).toBe(42);
  });

  it('stands in under a ref', () => {
    const TRIP = createAgentRef<AgentSession>('trip');
    const agent = mockAgent({ status: 'running' });
    TestBed.configureTestingModule({ providers: [provideAgentValue(TRIP, agent)] });
    const injected = TestBed.runInInjectionContext(() => injectAgent(TRIP));
    expect(injected).toBe(agent);
    expect(injected.status()).toBe('running');
  });
});
