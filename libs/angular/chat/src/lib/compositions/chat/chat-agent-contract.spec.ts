// How <chat> reads the injected Agent: optional commands, the input block,
// thread loading, the interrupt batch, the current run's custom events, and
// Stop. Each test drives a mock agent the way a session would.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ChatComponent } from './chat.component';
import { ChatInterruptTemplateDirective } from './chat-interrupt-template.directive';
import { mockAgent, type MockAgent } from '../../testing/mock-agent';
import type { A2uiSurfaceStore } from '../../a2ui/surface-store';
import type { AgentInterrupt } from '../../agent';

const conversation = () => [
  { id: 'u1', role: 'user' as const, content: 'Question' },
  { id: 'a1', role: 'assistant' as const, content: 'Answer' },
];

function mount(agent: MockAgent): ComponentFixture<ChatComponent> {
  const fixture = TestBed.createComponent(ChatComponent);
  fixture.componentRef.setInput('agent', agent);
  fixture.detectChanges();
  return fixture;
}

const el = (fixture: ComponentFixture<unknown>): HTMLElement => fixture.nativeElement as HTMLElement;
const regenerateButton = (fixture: ComponentFixture<unknown>) =>
  el(fixture).querySelector<HTMLButtonElement>('button[aria-label="Regenerate response"]');

describe('ChatComponent on the Agent contract', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [ChatComponent] }));
  afterEach(() => document.body.replaceChildren());

  describe('regenerate', () => {
    it('regenerates by the message id, not its position', () => {
      const agent = mockAgent({ messages: conversation() });
      const fixture = mount(agent);
      let emitted = 0;
      fixture.componentInstance.regenerate.subscribe(() => emitted++);

      regenerateButton(fixture)!.click();

      expect(agent.fake.regenerates).toEqual([{ messageId: 'a1' }]);
      expect(emitted).toBe(1);
    });

    it('offers no Regenerate for an agent without the command, and keeps the other actions', () => {
      const agent = mockAgent({ messages: conversation(), commands: [] });
      expect(agent.regenerate).toBeUndefined();
      const fixture = mount(agent);

      expect(regenerateButton(fixture)).toBeNull();
      expect(el(fixture).querySelector('button[aria-label="Copy to clipboard"]')).not.toBeNull();
      expect(el(fixture).querySelector('button[aria-label="Thumbs up"]')).not.toBeNull();

      // The programmatic path is as inert as the missing control.
      let emitted = 0;
      fixture.componentInstance.regenerate.subscribe(() => emitted++);
      fixture.componentInstance.onRegenerate(1);
      expect(emitted).toBe(0);
    });

    it('disables Regenerate during a run and while input is blocked', () => {
      const agent = mockAgent({ messages: conversation() });
      const fixture = mount(agent);
      expect(regenerateButton(fixture)!.disabled).toBe(false);

      agent.status.set('running');
      fixture.detectChanges();
      expect(regenerateButton(fixture)!.disabled).toBe(true);

      agent.status.set('idle');
      agent.inputBlocked.set({ reason: 'interrupt' });
      fixture.detectChanges();
      expect(regenerateButton(fixture)!.disabled).toBe(true);

      agent.inputBlocked.set(undefined);
      fixture.detectChanges();
      expect(regenerateButton(fixture)!.disabled).toBe(false);
    });

    it('contains a regeneration the session rejects', async () => {
      const agent = mockAgent({
        messages: conversation(),
        onRegenerate: () => { throw new Error('refused'); },
      });
      const fixture = mount(agent);

      regenerateButton(fixture)!.click();
      // An unhandled rejection would fail the run.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(agent.fake.regenerates).toHaveLength(1);
    });
  });

  describe('submitting', () => {
    it('submits the trimmed text through agent.submit', () => {
      const agent = mockAgent({ messages: conversation() });
      const fixture = mount(agent);

      fixture.componentInstance.submitMessage('  next question  ');

      expect(agent.submitCalls).toEqual([{ input: { message: 'next question' } }]);
    });

    it('refuses a programmatic submit and an A2UI action while the agent blocks input', () => {
      const agent = mockAgent({ messages: conversation(), inputBlocked: { reason: 'interrupt' } });
      const fixture = mount(agent);

      fixture.componentInstance.submitMessage('hello');
      fixture.componentInstance.onA2uiAction({ version: 'v0.9' } as never);
      expect(agent.submitCalls).toHaveLength(0);

      agent.inputBlocked.set(undefined);
      fixture.componentInstance.submitMessage('hello');
      expect(agent.submitCalls).toHaveLength(1);
    });

    it('disables Send while the agent blocks input', () => {
      const agent = mockAgent({ messages: conversation() });
      const fixture = mount(agent);
      const textarea = el(fixture).querySelector('textarea')!;
      textarea.value = 'draft';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      const send = () => el(fixture).querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!;
      expect(send().disabled).toBe(false);

      agent.inputBlocked.set({ reason: 'reconciling', message: 'Checking the last run' });
      fixture.detectChanges();
      expect(send().disabled).toBe(true);
    });

    it('contains a submission the session rejects', async () => {
      const agent = mockAgent({ messages: conversation(), onSubmit: () => { throw new Error('refused'); } });
      const fixture = mount(agent);

      fixture.componentInstance.submitMessage('hello');
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(agent.submitCalls).toHaveLength(1);
    });
  });

  describe('thread loading', () => {
    it('holds the welcome view back while the selected thread is loading', () => {
      const agent = mockAgent({ isThreadLoading: true });
      const fixture = mount(agent);
      expect(el(fixture).querySelector('chat-welcome')).toBeNull();

      agent.isThreadLoading.set(false);
      fixture.detectChanges();
      expect(el(fixture).querySelector('chat-welcome')).not.toBeNull();
    });
  });

  describe('stop', () => {
    it('stops the agent once and marks the turn stopped', async () => {
      const agent = mockAgent({ messages: [conversation()[0]], status: 'running' });
      const fixture = mount(agent);

      el(fixture).querySelector<HTMLButtonElement>('button[aria-label="Stop generating"]')!.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(agent.stopCount).toBe(1);
      expect(agent.status()).toBe('idle');
      expect(el(fixture).querySelector('.chat-stopped-notice')?.textContent).toContain('Response stopped');
    });
  });

  describe('custom events', () => {
    const partial = (toolCallId: string, surfaceId: string) => ({
      tool_call_id: toolCallId,
      args_so_far: JSON.stringify({
        envelopes: [{
          version: 'v0.9',
          updateComponents: { surfaceId, components: [{ id: 'root', component: 'Text', text: 'hi' }] },
        }],
      }),
    });
    const surfaces = (fixture: ComponentFixture<ChatComponent>) =>
      (fixture.componentInstance as unknown as { liveSurfaceStore: A2uiSurfaceStore }).liveSurfaceStore.surfaces();

    it('feeds a2ui-partial events from agent.customEvents into the live surface store', () => {
      const agent = mockAgent({ messages: conversation() });
      const fixture = mount(agent);
      expect(surfaces(fixture).size).toBe(0);

      agent.emitCustomEvent('a2ui-partial', partial('tc-1', 'first'));
      fixture.detectChanges();

      expect(surfaces(fixture).get('first')?.components.has('root')).toBe(true);
    });

    it('reads the next run from its first event after the list empties', () => {
      const agent = mockAgent({ messages: conversation() });
      const fixture = mount(agent);
      agent.emitCustomEvent('unrelated', null);
      agent.emitCustomEvent('a2ui-partial', partial('tc-1', 'first'));
      fixture.detectChanges();
      expect(surfaces(fixture).has('first')).toBe(true);

      // A new run starts with no retained events, and its events count from
      // zero again. The reset and the first new event land in one pass here,
      // so the shorter list is the only sign that the run changed.
      agent.customEvents.set([]);
      agent.emitCustomEvent('a2ui-partial', partial('tc-2', 'second'));
      fixture.detectChanges();

      expect(surfaces(fixture).has('second')).toBe(true);
    });
  });
});

@Component({
  standalone: true,
  imports: [ChatComponent, ChatInterruptTemplateDirective],
  template: `
    <chat [agent]="agent">
      <ng-template chatInterruptTemplate let-agent let-interrupt="interrupt" let-interrupts="interrupts">
        <div class="pause" [attr.data-first]="interrupt.id" [attr.data-all]="ids(interrupts)"
             [attr.data-same-agent]="agent === this.agent"></div>
      </ng-template>
    </chat>
  `,
})
class InterruptHost {
  readonly agent = mockAgent({ messages: conversation() });
  ids(interrupts: readonly AgentInterrupt[]): string {
    return interrupts.map((interrupt) => interrupt.id).join(',');
  }
}

describe('ChatComponent interrupt template on the Agent contract', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [InterruptHost] }));

  it('gives the template the first interrupt and the whole batch, and follows the batch', () => {
    const fixture = TestBed.createComponent(InterruptHost);
    fixture.detectChanges();
    const pause = () => fixture.debugElement.query(By.css('.pause'))?.nativeElement as HTMLElement | undefined;
    expect(pause()).toBeUndefined();

    fixture.componentInstance.agent.interrupts.set([
      { id: 'approval-a', value: { question: 'A?' } },
      { id: 'approval-b', value: { question: 'B?' } },
    ]);
    fixture.detectChanges();
    expect(pause()!.dataset['first']).toBe('approval-a');
    expect(pause()!.dataset['all']).toBe('approval-a,approval-b');
    expect(pause()!.dataset['sameAgent']).toBe('true');

    // One answered: the session lists what is left.
    fixture.componentInstance.agent.interrupts.set([{ id: 'approval-b', value: { question: 'B?' } }]);
    fixture.detectChanges();
    expect(pause()!.dataset['first']).toBe('approval-b');
    expect(pause()!.dataset['all']).toBe('approval-b');

    fixture.componentInstance.agent.interrupts.set([]);
    fixture.detectChanges();
    expect(pause()).toBeUndefined();
  });

  it('says what unblocks the run in the composer while an interrupt is pending', () => {
    const fixture = TestBed.createComponent(InterruptHost);
    fixture.componentInstance.agent.interrupts.set([{ id: 'approval-a' }]);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('textarea')!.placeholder)
      .toBe('Answer the approval to continue');
  });
});
