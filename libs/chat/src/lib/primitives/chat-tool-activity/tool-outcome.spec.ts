import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  ChatToolActivityComponent,
  ChatToolActivityGroupComponent,
  type ToolActivityInfo,
} from './chat-tool-activity.component';
import { ChatStatusPanelComponent } from '../chat-status-panel/chat-status-panel.component';
import { ChatToolCallsComponent } from '../chat-tool-calls/chat-tool-calls.component';
import { offersToolRetry } from '../chat-tool-calls/tool-retry-offer';
import { mockAgent } from '../../testing/mock-agent';
import type { Agent, ToolCall } from '../../agent';
import {
  activityFailures,
  receiptOutcomes,
  retryableToolIds,
  toolOutcomes,
  withoutStaleRetry,
} from './tool-outcome';

const read = (
  id: string,
  reference: string,
  phase: ToolActivityInfo['phase'],
  retry = true
): ToolActivityInfo => ({
  id,
  name: 'read_reference',
  phase,
  argumentsText: JSON.stringify({ id: reference }),
  errorSummary: phase === 'error' ? 'Read unavailable' : undefined,
  outcome:
    phase === 'error'
      ? {
          status: 'failed',
          text: 'Read unavailable',
          retry: retry ? { label: `Retry ${reference} read` } : undefined,
        }
      : undefined,
});
const saved: ToolActivityInfo = {
  id: 's',
  name: 'save_note',
  phase: 'complete',
  resultText: '{"saved":true,"id":"note-1"}',
  outcome: { status: 'receipt', text: 'Note note-1 in the local store.' },
};

describe('toolOutcomes', () => {
  const decode = vi.fn(({ args, result }) =>
    (result as { error?: string } | null)?.error
      ? { status: 'failed' as const, text: `${(args as { id: string }).id} failed` }
      : undefined
  );
  const outcome = toolOutcomes({ read_reference: decode });
  const call = (patch: Partial<ToolActivityInfo>): ToolActivityInfo => ({
    id: 'a',
    name: 'read_reference',
    phase: 'complete',
    argumentsText: '{"id":"sorted"}',
    resultText: '{"error":"x"}',
    ...patch,
  });
  it('hands a complete call of a declared tool its parsed arguments and result', () => {
    expect(outcome(call({}))).toEqual({ status: 'failed', text: 'sorted failed' });
    expect(decode).toHaveBeenLastCalledWith(
      expect.objectContaining({ args: { id: 'sorted' }, result: { error: 'x' } })
    );
  });
  it('never runs a decoder for another tool, an unsettled call or a missing result', () => {
    decode.mockClear();
    for (const patch of [
      { name: 'other' },
      { name: 'toString' },
      { phase: 'running' as const },
      { phase: 'error' as const },
      { phase: 'stopped' as const },
      { phase: undefined },
      { resultText: undefined },
    ])
      expect(outcome(call(patch))).toBeUndefined();
    expect(decode).not.toHaveBeenCalled();
  });
  it('passes falsy and non-JSON results through literally', () => {
    const seen: unknown[] = [];
    const literal = toolOutcomes({
      read_reference: ({ args, result }) => {
        seen.push(result, args);
        return undefined;
      },
    });
    for (const resultText of ['false', '0', '""', '[]', 'null', 'plain text'])
      literal(call({ resultText, argumentsText: '{' }));
    expect(seen).toEqual([
      false, undefined, 0, undefined, '', undefined, [], undefined, null, undefined,
      'plain text', undefined,
    ]);
  });
});

describe('declared retry rules', () => {
  it('offers a retry only for the latest failed call with the same tool and arguments', () => {
    const failed = read('a', 'sorted', 'error');
    expect([...retryableToolIds([failed])]).toEqual(['a']);
    expect([
      ...retryableToolIds([failed], [
        failed,
        { ...read('b', 'sorted', 'complete'), argumentsText: '{ "id": "sorted" }' },
      ]),
    ]).toEqual([]);
    expect([
      ...retryableToolIds([failed], [failed, read('b', 'signals', 'complete')]),
    ]).toEqual(['a']);
    expect([...retryableToolIds([read('a', 'sorted', 'error', false)])]).toEqual([]);
  });
  it('offers nothing while any call is pending or running', () => {
    const failed = read('a', 'sorted', 'error');
    for (const phase of ['pending', 'running'] as const)
      expect(
        retryableToolIds([failed], [failed, read('b', 'signals', phase)]).size
      ).toBe(0);
  });
  it('drops a stale retry and keeps the failure', () => {
    const failed = read('a', 'sorted', 'error');
    expect(withoutStaleRetry(failed, new Set(['a']))).toBe(failed);
    expect(withoutStaleRetry(failed, new Set()).outcome).toEqual({
      status: 'failed',
      text: 'Read unavailable',
    });
  });
  it('lists identical messages once unless a call carries its own retry', () => {
    expect(
      activityFailures([
        read('a', 'one', 'error', false),
        read('b', 'two', 'error', false),
        read('c', 'three', 'error'),
      ]).map((failure) => [failure.text, failure.retry?.label])
    ).toEqual([
      ['Read unavailable', undefined],
      ['Read unavailable', 'Retry three read'],
    ]);
  });
  it('yields a receipt only for a complete call', () => {
    expect(receiptOutcomes([saved])).toEqual([
      { id: 's', lead: 'Saved.', text: 'Note note-1 in the local store.' },
    ]);
    for (const phase of ['waiting', 'running', 'error', 'stopped'] as const)
      expect(receiptOutcomes([{ ...saved, phase }])).toEqual([]);
  });
});

@Component({
  standalone: true,
  imports: [ChatToolActivityComponent, ChatToolActivityGroupComponent, ChatStatusPanelComponent],
  template: `<chat-tool-activity-group [activities]="activities()" (toolRetry)="retried.push($event.id)" />
    @if (single(); as activity) {
    <chat-tool-activity [activity]="activity" (toolRetry)="retried.push($event.id)" />
    }
    <chat-status-panel tone="warning" lead="Waiting for your approval." role="status">
      <p>Save the comparison note?</p>
      <button chatStatusPanelActions type="button">Save note</button>
    </chat-status-panel>
    <chat-status-panel id="plain">Plain</chat-status-panel>`,
})
class PrimitiveHost {
  activities = signal<readonly ToolActivityInfo[]>([]);
  single = signal<ToolActivityInfo | undefined>(undefined);
  retried: string[] = [];
}

describe('declared retry and receipts in the primitives', () => {
  const setup = () => {
    const fixture = TestBed.createComponent(PrimitiveHost);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  };
  const retryButton = (el: HTMLElement) =>
    [...el.querySelectorAll<HTMLButtonElement>('button.tp-tool-activity__retry')];
  it('renders the retry after the explanation, outside Details, and emits the activity', () => {
    const { fixture, el } = setup();
    fixture.componentInstance.activities.set([
      read('ok', 'signals', 'complete'),
      read('a', 'sorted', 'error'),
    ]);
    fixture.detectChanges();
    const panel = el.querySelector('chat-tool-activity-group [chatStatusPanel]') as HTMLElement;
    expect(panel.getAttribute('role')).toBe('alert');
    expect(panel.getAttribute('data-tone')).toBe('danger');
    expect(panel.classList.contains('tp-tool-activity__error')).toBe(true);
    expect(
      [...panel.children].filter((child) => !child.classList.contains('tp-status-panel__actions')).map((child) => child.tagName)
    ).toEqual(['P', 'BUTTON']);
    const [button] = retryButton(el);
    expect(button.textContent?.trim()).toBe('Retry sorted read');
    expect(button.closest('details')).toBeNull();
    button.click();
    expect(fixture.componentInstance.retried).toEqual(['a']);
  });
  it('hides the retry while another call runs or a later call repeats it', () => {
    const { fixture, el } = setup();
    const failed = read('a', 'sorted', 'error');
    fixture.componentInstance.activities.set([failed, read('b', 'signals', 'running')]);
    fixture.detectChanges();
    expect(retryButton(el)).toHaveLength(0);
    fixture.componentInstance.activities.set([failed, read('b', 'sorted', 'complete')]);
    fixture.detectChanges();
    expect(retryButton(el)).toHaveLength(0);
    expect(el.textContent).toContain('Read unavailable');
  });
  it('renders a single call retry after its explanation', () => {
    const { fixture, el } = setup();
    fixture.componentInstance.single.set(read('a', 'sorted', 'error'));
    fixture.detectChanges();
    const [button] = retryButton(el);
    expect(button.previousElementSibling?.getAttribute('role')).toBe('alert');
    button.click();
    expect(fixture.componentInstance.retried).toEqual(['a']);
  });
  it('shows a receipt as a success panel, announced politely and never as an alert or preview', () => {
    const { fixture, el } = setup();
    fixture.componentInstance.activities.set([saved]);
    fixture.detectChanges();
    const group = el.querySelector('chat-tool-activity-group') as HTMLElement;
    const panel = group.querySelector('.tp-tool-activity__receipt') as HTMLElement;
    expect(panel.getAttribute('data-tone')).toBe('success');
    expect(panel.textContent).toBe('Saved.Note note-1 in the local store.');
    expect(panel.hasAttribute('role')).toBe(false);
    expect(panel.closest('details')).toBeNull();
    expect(group.querySelector('.tp-tool-outcomes')).toBeNull();
    expect(group.querySelector('[role="alert"]')).toBeNull();
    expect(group.querySelector('[role="status"]')?.textContent).toContain(
      'Saved. Note note-1 in the local store.'
    );
    fixture.componentInstance.activities.set([{ ...saved, phase: 'waiting' }]);
    fixture.detectChanges();
    expect(group.querySelector('.tp-tool-activity__receipt')).toBeNull();
  });
  it('renders a status panel lead, detail and actions with its tone', () => {
    const { el } = setup();
    const panel = el.querySelector('chat-status-panel[role="status"]') as HTMLElement;
    expect(panel.getAttribute('data-tone')).toBe('warning');
    expect(panel.classList.contains('tp-status-panel')).toBe(true);
    expect([...panel.children].map((child) => child.className || child.tagName)).toEqual([
      'tp-status-panel__lead',
      'P',
      'tp-status-panel__actions',
    ]);
    expect(panel.querySelector('.tp-status-panel__actions button')?.textContent).toBe('Save note');
    const plain = el.querySelector('#plain') as HTMLElement;
    expect(plain.getAttribute('data-tone')).toBe('neutral');
    expect(plain.querySelector('.tp-status-panel__lead')).toBeNull();
    expect(plain.querySelector('.tp-status-panel__actions')?.children).toHaveLength(0);
  });
});

@Component({
  standalone: true,
  imports: [ChatToolCallsComponent],
  template: `<chat-tool-calls [agent]="agent" [toolOutcome]="outcome" [groupRelated]="grouped" (toolRetry)="retried.push($event.id)" />`,
})
class CallsHost {
  agent: Agent = mockAgent();
  grouped = true;
  retried: string[] = [];
  outcome = toolOutcomes({
    read: ({ args, result }) =>
      (result as { error?: string } | null)?.error
        ? {
            status: 'failed',
            text: 'Read unavailable',
            retry: { label: `Retry ${(args as { id: string }).id} read` },
          }
        : undefined,
    save: ({ result }) =>
      (result as { saved?: boolean; id?: string } | null)?.saved === true
        ? { status: 'receipt', text: `Note ${(result as { id: string }).id}.` }
        : undefined,
  });
}
const failedRead: ToolCall = { id: 'c0', name: 'read', args: { id: 'sorted' }, status: 'complete', result: { error: 'x' } };

describe('ChatToolCallsComponent — declared retry and receipts', () => {
  const setup = (toolCalls: ToolCall[], isLoading = false, grouped = true) => {
    const fixture = TestBed.createComponent(CallsHost);
    const agent = mockAgent({ toolCalls, isLoading });
    fixture.componentInstance.agent = agent;
    fixture.componentInstance.grouped = grouped;
    fixture.detectChanges();
    return { fixture, agent, el: fixture.nativeElement as HTMLElement };
  };
  const retries = (el: HTMLElement) =>
    [...el.querySelectorAll<HTMLButtonElement>('button.tp-tool-activity__retry')].filter(
      (button) => !button.closest('[hidden]')
    );
  it('offers the retry in the danger panel below a collapsed group and emits the activity', () => {
    const { fixture, el } = setup([
      { id: 'ok', name: 'read', args: { id: 'signals' }, status: 'complete', result: { title: 'Signals' } },
      failedRead,
    ]);
    expect(el.textContent).toContain('Used 2 tools · 1 failed');
    const panel = el.querySelector('div[chatStatusPanel][role="alert"]') as HTMLElement;
    expect(panel.getAttribute('data-tone')).toBe('danger');
    expect(panel.querySelector(':scope > p')?.textContent).toBe('Read unavailable');
    const [button] = retries(el);
    expect(button.textContent?.trim()).toBe('Retry sorted read');
    expect(panel.contains(button)).toBe(true);
    button.click();
    expect(fixture.componentInstance.retried).toEqual(['c0']);
  });
  it('stops offering the retry while the agent works and once a later call repeats it', () => {
    const { fixture, agent, el } = setup([failedRead]);
    expect(retries(el)).toHaveLength(1);
    agent.isLoading.set(true);
    fixture.detectChanges();
    expect(retries(el)).toHaveLength(0);
    agent.isLoading.set(false);
    agent.toolCalls.set([
      failedRead,
      { id: 'c1', name: 'read', args: { id: 'sorted' }, status: 'complete', result: { title: 'ok' } },
    ]);
    fixture.detectChanges();
    expect(retries(el)).toHaveLength(0);
    expect(el.textContent).toContain('Read unavailable');
    agent.toolCalls.set([
      failedRead,
      { id: 'c1', name: 'read', args: { id: 'signals' }, status: 'complete', result: { title: 'ok' } },
    ]);
    fixture.detectChanges();
    expect(retries(el)).toHaveLength(1);
  });
  it('offers the retry on an ungrouped row', () => {
    const { fixture, el } = setup([failedRead], false, false);
    const [button] = retries(el);
    expect(button.textContent?.trim()).toBe('Retry sorted read');
    button.click();
    expect(fixture.componentInstance.retried).toEqual(['c0']);
  });
  it('shows a receipt only for a decoded saved result', () => {
    const { fixture, agent, el } = setup([
      { id: 's', name: 'save', args: {}, status: 'complete', result: { saved: true, id: 'note-1' } },
    ]);
    const receipt = el.querySelector('.tp-tool-activity__receipt') as HTMLElement;
    expect(receipt.textContent).toBe('Saved.Note note-1.');
    expect(el.querySelector('[role="alert"]')).toBeNull();
    agent.toolCalls.set([
      { id: 's', name: 'save', args: {}, status: 'complete', result: { saved: false, cancelled: true } },
    ]);
    fixture.detectChanges();
    expect(el.querySelector('.tp-tool-activity__receipt')).toBeNull();
    agent.toolCalls.set([{ id: 's', name: 'save', args: {}, status: 'running' }]);
    fixture.detectChanges();
    expect(el.querySelector('.tp-tool-activity__receipt')).toBeNull();
  });
  it('reports whether a per-call retry is currently offered', () => {
    const outcome = TestBed.createComponent(CallsHost).componentInstance.outcome;
    expect(offersToolRetry([failedRead], outcome)).toBe(true);
    expect(offersToolRetry([failedRead], undefined)).toBe(false);
    expect(
      offersToolRetry(
        [failedRead, { id: 'c1', name: 'read', args: { id: 'sorted' }, status: 'complete', result: {} }],
        outcome
      )
    ).toBe(false);
    expect(
      offersToolRetry([failedRead], () => {
        throw new Error('decoder');
      })
    ).toBe(false);
  });
});
