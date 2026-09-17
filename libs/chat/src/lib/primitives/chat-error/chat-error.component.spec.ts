import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { extractErrorMessage, ChatErrorComponent } from './chat-error.component';
import { mockAgent } from '../../testing/mock-agent';
import { AgentError } from '../../agent/agent-error';
import type { MockAgent } from '../../testing/mock-agent';

describe('extractErrorMessage()', () => {
  it('returns null for null error', () => {
    expect(extractErrorMessage(null)).toBeNull();
  });

  it('returns null for undefined error', () => {
    expect(extractErrorMessage(undefined)).toBeNull();
  });

  it('extracts message from Error object', () => {
    expect(extractErrorMessage(new Error('something went wrong'))).toBe('something went wrong');
  });

  it('returns string errors as-is', () => {
    expect(extractErrorMessage('network failure')).toBe('network failure');
  });

  it('converts unknown values to string', () => {
    expect(extractErrorMessage(42)).toBe('42');
  });
});

@Component({
  standalone: true,
  imports: [ChatErrorComponent],
  template: `<chat-error [agent]="agent" />`,
})
class HostComponent {
  agent: MockAgent = mockAgent();
}

describe('ChatErrorComponent — rendering', () => {
  let host: HostComponent;
  let fixture: ReturnType<typeof TestBed.createComponent<HostComponent>>;

  beforeEach(() => {
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  it('renders err.message text for a retryable AgentError', () => {
    const err = new AgentError({ kind: 'server', message: 'The server ran into an error. You can try again.', retryable: true });
    host.agent = mockAgent({ status: 'error', error: err });
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const msg = el.querySelector('.chat-error__msg');
    expect(msg?.textContent?.trim()).toBe('The server ran into an error. You can try again.');
  });

  it('shows a Retry button when retryable is true', () => {
    const err = new AgentError({ kind: 'server', message: 'The server ran into an error. You can try again.', retryable: true });
    host.agent = mockAgent({ status: 'error', error: err });
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const btn = el.querySelector<HTMLButtonElement>('button.chat-error__retry');
    expect(btn).not.toBeNull();
    expect(btn?.textContent?.trim().toLowerCase()).toMatch(/retry/i);
  });

  it('hides the Retry button when retryable is false', () => {
    const err = new AgentError({ kind: 'auth', message: 'Authentication failed. Check your API key or credentials.', retryable: false });
    host.agent = mockAgent({ status: 'error', error: err });
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const btn = el.querySelector('button.chat-error__retry');
    expect(btn).toBeNull();
  });

  it('clicking Retry calls agent.retry()', async () => {
    const err = new AgentError({ kind: 'server', message: 'The server ran into an error. You can try again.', retryable: true });
    const agent = mockAgent({ status: 'error', error: err });
    const retrySpy = vi.spyOn(agent, 'retry');
    host.agent = agent;
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const btn = el.querySelector<HTMLButtonElement>('button.chat-error__retry');
    expect(btn).not.toBeNull();
    btn!.click();

    expect(retrySpy).toHaveBeenCalledTimes(1);
  });
});

describe('ChatErrorComponent — interruption recovery', () => {
  function render(error: AgentError, checkStatus?: () => Promise<void>) {
    const fixture = TestBed.createComponent(HostComponent);
    const agent = mockAgent();
    agent.error.set(error);
    if (checkStatus) (agent as { checkStatus?: () => Promise<void> }).checkStatus = checkStatus;
    fixture.componentInstance.agent = agent;
    fixture.detectChanges();
    return { fixture, agent, el: fixture.nativeElement as HTMLElement };
  }

  const interrupted = (recovery: 'retry' | 'check' | 'none', detail?: string) =>
    new AgentError({
      kind: 'interrupted',
      message: `interrupted-${recovery}`,
      retryable: recovery === 'retry',
      recovery,
      detail,
    });

  it('renders Retry when recovery is retry', () => {
    const { el } = render(interrupted('retry'));
    expect(el.querySelector('.chat-error__retry')?.textContent).toContain('Retry');
    expect(el.querySelector('.chat-error__check')).toBeNull();
  });

  it('renders Check status when recovery is check and the agent supports it', () => {
    let calls = 0;
    const { el } = render(interrupted('check'), async () => { calls++; });
    const button = el.querySelector('.chat-error__check') as HTMLButtonElement | null;
    expect(button?.textContent).toContain('Check status');
    expect(el.querySelector('.chat-error__retry')).toBeNull();
    button?.click();
    expect(calls).toBe(1);
  });

  it('renders no button when recovery is check but the agent cannot verify', () => {
    const { el } = render(interrupted('check'));
    expect(el.querySelector('.chat-error__check')).toBeNull();
    expect(el.querySelector('.chat-error__retry')).toBeNull();
  });

  it('renders the detail sentence and no button when recovery is none', () => {
    const { el } = render(interrupted('none', 'We could not confirm the booking.'));
    expect(el.querySelector('.chat-error__detail')?.textContent).toContain('We could not confirm the booking.');
    expect(el.querySelector('.chat-error__retry')).toBeNull();
    expect(el.querySelector('.chat-error__check')).toBeNull();
  });

  it('still renders Retry for a retryable non-interrupted error', () => {
    const { el } = render(new AgentError({ kind: 'server', message: 'boom', retryable: true }));
    expect(el.querySelector('.chat-error__retry')).not.toBeNull();
  });

  it('renders Check status, not Retry, when recovery is check even if retryable is true', () => {
    const err = new AgentError({ kind: 'interrupted', message: 'interrupted-check', retryable: true, recovery: 'check' });
    const { el } = render(err, async () => { /* noop */ });
    expect(el.querySelector('.chat-error__check')?.textContent).toContain('Check status');
    expect(el.querySelector('.chat-error__retry')).toBeNull();
  });

  it('renders no button when recovery is check, retryable is true, but the agent cannot verify', () => {
    const err = new AgentError({ kind: 'interrupted', message: 'interrupted-check', retryable: true, recovery: 'check' });
    const { el } = render(err);
    expect(el.querySelector('.chat-error__check')).toBeNull();
    expect(el.querySelector('.chat-error__retry')).toBeNull();
  });
});
