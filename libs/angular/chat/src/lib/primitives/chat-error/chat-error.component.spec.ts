import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { extractErrorMessage, ChatErrorComponent } from './chat-error.component';
import { mockAgent } from '../../testing/mock-agent';
import type { AgentError } from '../../agent';
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
    const err = ({ kind: 'server', message: 'The server ran into an error. You can try again.', retryable: true } satisfies AgentError);
    host.agent = mockAgent({ status: 'error', error: err });
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const msg = el.querySelector('.chat-error__msg');
    expect(msg?.textContent?.trim()).toBe('The server ran into an error. You can try again.');
  });

  it('shows a Retry button when retryable is true', () => {
    const err = ({ kind: 'server', message: 'The server ran into an error. You can try again.', retryable: true } satisfies AgentError);
    host.agent = mockAgent({ status: 'error', error: err });
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const btn = el.querySelector<HTMLButtonElement>('button.chat-error__retry');
    expect(btn).not.toBeNull();
    expect(btn?.textContent?.trim().toLowerCase()).toMatch(/retry/i);
  });

  it('hides the Retry button when retryable is false', () => {
    const err = ({ kind: 'auth', message: 'Authentication failed. Check your API key or credentials.', retryable: false } satisfies AgentError);
    host.agent = mockAgent({ status: 'error', error: err });
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const btn = el.querySelector('button.chat-error__retry');
    expect(btn).toBeNull();
  });

  it('hides the generic Retry when retryHidden is set and keeps the message', () => {
    @Component({ standalone: true, imports: [ChatErrorComponent], template: `<chat-error [agent]="agent" [retryHidden]="true" />` })
    class HiddenHost {
      agent = mockAgent({ status: 'error', error: ({ kind: 'server', message: 'Read unavailable', retryable: true } satisfies AgentError) });
    }
    const hidden = TestBed.createComponent(HiddenHost);
    hidden.detectChanges();
    const el: HTMLElement = hidden.nativeElement;
    expect(el.querySelector('button.chat-error__retry')).toBeNull();
    expect(el.querySelector('.chat-error__msg')?.textContent).toContain('Read unavailable');
  });

  it('clicking Retry calls agent.retry()', async () => {
    const err = ({ kind: 'server', message: 'The server ran into an error. You can try again.', retryable: true } satisfies AgentError);
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
    // `checkStatus` is an optional command: the agent carries it only when asked.
    const agent = mockAgent(checkStatus ? { onCheckStatus: () => checkStatus() } : {});
    agent.error.set(error);
    fixture.componentInstance.agent = agent;
    fixture.detectChanges();
    return { fixture, agent, el: fixture.nativeElement as HTMLElement };
  }

  const interrupted = (recovery: 'retry' | 'check' | 'none', detail?: string) =>
    ({
      kind: 'interrupted',
      message: `interrupted-${recovery}`,
      retryable: recovery === 'retry',
      recovery,
      detail,
    }) satisfies AgentError;

  it('renders Retry response when recovery is retry', () => {
    const { el } = render(interrupted('retry'));
    expect(el.querySelector('.chat-error__retry')?.textContent?.trim()).toBe('Retry response');
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
    const { el } = render(({ kind: 'server', message: 'boom', retryable: true } satisfies AgentError));
    expect(el.querySelector('.chat-error__retry')).not.toBeNull();
  });

  it('renders Check status, not Retry, when recovery is check even if retryable is true', () => {
    const err = ({ kind: 'interrupted', message: 'interrupted-check', retryable: true, recovery: 'check' } satisfies AgentError);
    const { el } = render(err, async () => { /* noop */ });
    expect(el.querySelector('.chat-error__check')?.textContent).toContain('Check status');
    expect(el.querySelector('.chat-error__retry')).toBeNull();
  });

  it('renders no button when recovery is check, retryable is true, but the agent cannot verify', () => {
    const err = ({
      kind: 'interrupted',
      message: 'interrupted-check',
      retryable: true,
      recovery: 'check',
      detail: 'We could not confirm the booking.',
    } satisfies AgentError);
    const { el } = render(err);
    expect(el.querySelector('.chat-error__check')).toBeNull();
    expect(el.querySelector('.chat-error__retry')).toBeNull();
    expect(el.querySelector('.chat-error__detail')?.textContent).toContain('We could not confirm the booking.');
  });
});

describe('ChatErrorComponent — optional commands', () => {
  function render(agent: MockAgent) {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.agent = agent;
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }
  const retryable: AgentError = { kind: 'server', message: 'boom', retryable: true };
  const check: AgentError = { kind: 'interrupted', message: 'dropped', retryable: false, recovery: 'check' };

  it('offers no Retry for a retryable error when the agent has no retry command', () => {
    const agent = mockAgent({ commands: [] });
    agent.error.set(retryable);
    expect(agent.retry).toBeUndefined();
    const el = render(agent);
    expect(el.querySelector('.chat-error__msg')?.textContent).toContain('boom');
    expect(el.querySelector('.chat-error__retry')).toBeNull();
  });

  it('offers Retry when the agent has the command, and calls it once', () => {
    const agent = mockAgent({ commands: ['retry'] });
    agent.error.set(retryable);
    const el = render(agent);
    el.querySelector<HTMLButtonElement>('.chat-error__retry')!.click();
    expect(agent.fake.retryCount).toBe(1);
  });

  it('offers Check status only when the agent has checkStatus, and calls it once', () => {
    const without = mockAgent();
    without.error.set(check);
    expect(without.checkStatus).toBeUndefined();
    expect(render(without).querySelector('.chat-error__check')).toBeNull();

    const withCheck = mockAgent({ commands: ['checkStatus'] });
    withCheck.error.set(check);
    const el = render(withCheck);
    el.querySelector<HTMLButtonElement>('.chat-error__check')!.click();
    expect(withCheck.fake.checkStatusCount).toBe(1);
  });

  it('does not leave a rejected retry unhandled', async () => {
    const agent = mockAgent({ onRetry: () => { throw new Error('still down'); } });
    agent.error.set(retryable);
    const el = render(agent);
    el.querySelector<HTMLButtonElement>('.chat-error__retry')!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(agent.fake.retryCount).toBe(1);
  });
});
