import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChatComponent,
  ChatWelcomeSuggestionComponent,
} from '@threadplane/chat';
import { mockLangGraphAgent } from '@threadplane/langgraph';
import { COCKPIT_INSPECTION_PUBLISHER } from '@threadplane/cockpit-telemetry';
import type { InspectionFrame } from '@threadplane/cockpit-runtime-bridge';
import { StreamingComponent } from './streaming.component';
import { STREAMING_AGENT } from './agent-ref';

describe('streaming live inspection', () => {
  afterEach(() => TestBed.resetTestingModule());

  function setup() {
    const agent = mockLangGraphAgent();
    const switchThread = vi.spyOn(agent, 'switchThread');
    const frames: InspectionFrame[] = [];
    TestBed.configureTestingModule({
      imports: [StreamingComponent],
      providers: [
        { provide: STREAMING_AGENT.token, useValue: agent },
        {
          provide: COCKPIT_INSPECTION_PUBLISHER,
          useValue: (frame: InspectionFrame) => frames.push(frame),
        },
      ],
    });
    const fixture = TestBed.createComponent(StreamingComponent);
    fixture.detectChanges();
    return { agent, frames, fixture, switchThread };
  }

  it('publishes actual signals and text-only messages, never raw state or failures', () => {
    const { agent, frames, fixture } = setup();
    agent.value.set({ privateValue: 'private state' });
    agent.messages.set([
      {
        id: 'a',
        role: 'assistant',
        delivery: { generation: 'a', phase: 'complete', outcome: 'success' },
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'image', url: 'private image' },
        ],
        extra: { secret: 'private extra' },
      },
    ]);
    agent.isLoading.set(true);
    agent.hasValue.set(true);
    agent.error.set({ kind: 'unknown', message: 'private failure' });
    fixture.detectChanges();
    expect(frames.at(-1)?.messages).toEqual([
      { id: 'a', role: 'assistant', text: 'Hello' },
    ]);
    expect(frames.at(-1)?.state).toEqual({
      busy: true,
      hasValue: true,
      status: 'idle',
      hasFailure: true,
      messageCount: 1,
      deliveryPhase: 'complete',
      outcome: 'success',
    });
    expect(JSON.stringify(frames)).not.toContain('private');
    const count = frames.length;
    fixture.destroy();
    agent.isLoading.set(false);
    TestBed.tick();
    expect(frames).toHaveLength(count);
  });

  it('distinguishes a stopped response from success using actual assistant delivery', () => {
    const { agent, frames, fixture } = setup();
    for (const outcome of ['success', 'aborted'] as const) {
      agent.messages.set([
        {
          id: 'answer',
          role: 'assistant',
          content: 'Partial response',
          delivery: { generation: outcome, phase: 'complete', outcome },
        },
      ]);
      fixture.detectChanges();
      expect(frames.at(-1)?.state?.outcome).toBe(outcome);
      expect(frames.at(-1)?.state?.deliveryPhase).toBe('complete');
    }
    agent.messages.set([
      {
        id: 'answer',
        role: 'assistant',
        content: 'Streaming',
        delivery: { generation: 'next', phase: 'streaming' },
      },
    ]);
    fixture.detectChanges();
    expect(frames.at(-1)?.state?.outcome).toBe(null);
    expect(frames.at(-1)?.state?.deliveryPhase).toBe('streaming');
  });

  it('delegates chat and suggestion submissions once and clears calls on a new conversation', async () => {
    const { agent, frames, fixture, switchThread } = setup();
    const submit = vi.spyOn(agent, 'submit');
    const chat = fixture.debugElement.query(By.directive(ChatComponent))
      .componentInstance as ChatComponent;
    const wrapped = chat.agent();
    expect(wrapped?.messages).toBe(agent.messages);
    await wrapped!.submit({ message: 'From chat' });
    expect(submit).toHaveBeenCalledExactlyOnceWith(
      { message: 'From chat' },
      undefined
    );
    expect(frames.at(-1)?.calls[0]).toMatchObject({
      input: { message: 'From chat' },
      status: 'settled',
    });
    const suggestion = fixture.debugElement.query(
      By.directive(ChatWelcomeSuggestionComponent)
    ).componentInstance as ChatWelcomeSuggestionComponent;
    suggestion.selected.emit('From suggestion');
    await Promise.resolve();
    expect(submit).toHaveBeenCalledTimes(2);
    expect(frames.at(-1)?.calls).toHaveLength(2);
    (
      fixture.nativeElement.querySelector(
        'button[headerActions]'
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(switchThread).toHaveBeenCalledExactlyOnceWith(null);
    expect(frames.at(-1)?.calls).toEqual([]);
  });

  it('does not attribute an earlier successful response to a new turn without an assistant message', () => {
    const { agent, frames, fixture } = setup();
    agent.messages.set([
      {
        id: 'old-answer',
        role: 'assistant',
        content: 'Previous response',
        delivery: { generation: 'old', phase: 'complete', outcome: 'success' },
      },
      {
        id: 'new-question',
        role: 'user',
        content: 'Next question',
        delivery: { generation: 'new', phase: 'complete', outcome: 'success' },
      },
    ]);
    agent.isLoading.set(true);
    fixture.detectChanges();
    expect(frames.at(-1)?.state?.outcome).toBe(null);
    expect(frames.at(-1)?.state?.deliveryPhase).toBe(null);
    agent.isLoading.set(false);
    agent.error.set({ kind: 'unknown', message: 'Failed before a response' });
    fixture.detectChanges();
    expect(frames.at(-1)?.state?.outcome).toBe(null);
    expect(frames.at(-1)?.state?.hasFailure).toBe(true);
    agent.messages.update((messages) => [
      ...messages,
      {
        id: 'new-answer',
        role: 'assistant',
        content: 'Partial answer',
        delivery: { generation: 'new', phase: 'complete', outcome: 'aborted' },
      },
    ]);
    fixture.detectChanges();
    expect(frames.at(-1)?.state?.outcome).toBe('aborted');
  });

  it('preserves rejection and fences pending settlements after reset', async () => {
    const { agent, frames, fixture } = setup();
    const failure = new Error('private failure');
    vi.spyOn(agent, 'submit').mockRejectedValueOnce(failure);
    const chat = fixture.debugElement.query(By.directive(ChatComponent))
      .componentInstance as ChatComponent;
    await expect(chat.agent()!.submit({ message: 'fail' })).rejects.toBe(
      failure
    );
    expect(frames.at(-1)?.calls[0].status).toBe('rejected');
    let resolve!: () => void;
    vi.mocked(agent.submit).mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        })
    );
    const pending = chat.agent()!.submit({ message: 'pending' });
    (
      fixture.nativeElement.querySelector(
        'button[headerActions]'
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    const count = frames.length;
    resolve();
    await pending;
    expect(frames).toHaveLength(count);
  });
});
