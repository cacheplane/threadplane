import { describe, it, expect } from 'vitest';
import { Component, signal, computed } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChatInterruptComponent, getInterrupt } from './chat-interrupt.component';
import { mockAgent, type MockAgent } from '../../testing/mock-agent';
import type { AgentInterrupt } from '../../agent';

describe('getInterrupt()', () => {
  it('returns undefined when the session publishes no interrupts', () => {
    const agent = mockAgent();
    expect(agent.interrupts()).toBeUndefined();
    expect(getInterrupt(agent)).toBeUndefined();
  });

  it('returns undefined when the interrupts list is empty', () => {
    const agent = mockAgent({ interrupts: [] });
    expect(getInterrupt(agent)).toBeUndefined();
  });

  it('returns the pending interrupt when the agent lists one', () => {
    const ix: AgentInterrupt = { id: 'ix-1', value: { question: 'Confirm?' }, resumable: true };
    const agent = mockAgent();
    agent.interrupts.set([ix]);
    expect(getInterrupt(agent)).toBe(agent.interrupts()![0]);
    expect(getInterrupt(agent)).toEqual(ix);
  });

  it('returns the first of several pending interrupts', () => {
    const agent = mockAgent({ interrupts: [{ id: 'a', value: 'first' }, { id: 'b', value: 'second' }] });
    expect(getInterrupt(agent)?.id).toBe('a');
  });
});

describe('AgentInterruptComponent — interrupt computed', () => {
  it('interrupt is undefined when agent lists no interrupt', () => {
    const agent = mockAgent();
    const agent$ = signal(agent);
    const interrupt = computed(() => getInterrupt(agent$()));
    expect(interrupt()).toBeUndefined();
  });

  it('interrupt reflects the pending interrupt when present', () => {
    const ix: AgentInterrupt = { id: 'ix-1', value: { step: 'confirm' }, resumable: true };
    const agent = mockAgent();
    agent.interrupts.set([ix]);
    const agent$ = signal(agent);
    const interrupt = computed(() => getInterrupt(agent$()));
    expect(interrupt()).toEqual(ix);
  });

  it('interrupt updates reactively when agent changes', () => {
    const noIx = mockAgent();
    const withIx = mockAgent();
    const ix: AgentInterrupt = { id: 'ix-2', value: { type: 'human_review' }, resumable: true };
    withIx.interrupts.set([ix]);

    const agent$ = signal<MockAgent>(noIx);
    const interrupt = computed(() => getInterrupt(agent$()));

    expect(interrupt()).toBeUndefined();
    agent$.set(withIx);
    expect(interrupt()).toEqual(ix);
  });
});

describe('ChatInterruptComponent — rendering', () => {
  @Component({
    standalone: true,
    imports: [ChatInterruptComponent],
    template: `<chat-interrupt [agent]="agent" />`,
  })
  class Host {
    agent = mockAgent();
  }

  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture;
  }

  it('renders nothing while no interrupt is pending, and the first one once the agent pauses', () => {
    const fixture = render();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.chat-interrupt')).toBeNull();

    fixture.componentInstance.agent.interrupts.set([{ id: 'a', value: 'Approve the booking?' }, { id: 'b', value: 'second' }]);
    fixture.detectChanges();
    expect(el.querySelector('.chat-interrupt__body')?.textContent).toBe('Approve the booking?');

    fixture.componentInstance.agent.interrupts.set([]);
    fixture.detectChanges();
    expect(el.querySelector('.chat-interrupt')).toBeNull();
  });

  it('shows a structured value as JSON, and the backend message for a pause with no value', () => {
    const fixture = render();
    const el: HTMLElement = fixture.nativeElement;
    fixture.componentInstance.agent.interrupts.set([{ id: 'a', value: { kind: 'approval' } }]);
    fixture.detectChanges();
    expect(el.querySelector('.chat-interrupt__body')?.textContent).toBe('{"kind":"approval"}');

    fixture.componentInstance.agent.interrupts.set([{ id: 'b', message: 'Waiting for a reviewer' }]);
    fixture.detectChanges();
    expect(el.querySelector('.chat-interrupt__body')?.textContent).toBe('Waiting for a reviewer');
  });
});
