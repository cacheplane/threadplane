import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChatToolActivityComponent,
  ChatToolActivityGroupComponent,
  toolActivityPhase,
  type ToolActivityPhase,
  type ToolActivityDelivery,
  type ToolActivityInfo,
} from './chat-tool-activity.component';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Shared readonly Angular/React test conformance data, excluded from production packages.
import { phases } from '../../../../../../fixtures/tool-activity/phases';
import { activitySummary, humanizeToolName, toolActivityHeading } from './activity-summary';
import { confirmedOutcomes, outcomeSources, resolveToolOutcome } from './tool-outcome';
@Component({
  standalone: true,
  imports: [ChatToolActivityComponent, ChatToolActivityGroupComponent],
  template: `<chat-tool-activity [activity]="activity()"
      ><input aria-label="Rich result" /></chat-tool-activity
    ><chat-tool-activity-group
      [activities]="activities()"
      label="Preparing dashboard"
      ><button>Approve</button></chat-tool-activity-group
    >`,
})
class Host {
  activity = signal<ToolActivityInfo>({
    id: 'a',
    name: 'query_airline_kpis',
    label: 'Checking airline performance',
    phase: 'running',
    argumentsText: '{<img>',
  });
  activities = signal<readonly ToolActivityInfo[]>([]);
}
describe('tool activity', () => {
  it.each([
    ['running', 'Checking references'],
    ['pending', 'Waiting to run tools'],
    ['waiting', 'Tool activity paused'],
    ['stopped', 'Tool activity stopped'],
    ['unknown', 'Tool status unavailable'],
    ['complete', 'Used 1 tool'],
    ['error', 'Used 1 tool · 1 failed'],
  ] as const)('summarizes %s in one collapsed row', (phase, expected) => {
    const fixture = TestBed.createComponent(ChatToolActivityGroupComponent);
    fixture.componentRef.setInput('activities', [
      {
        id: 'a',
        name: 'private_lookup',
        label: 'Checking references',
        phase,
        resultText: '{"approved":true}',
      },
    ]);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('details')!.open).toBe(false);
    expect(root.querySelector('summary')!.textContent!.trim()).toBe(expected);
    expect(root.querySelector('.tp-tool-activity__progress')).toBeNull();
    const status = root.querySelector('[role="status"]')!;
    expect(status.classList.contains('tp-tool-activity__status')).toBe(true);
    expect(status.closest('details')).toBeNull();
    expect(status.textContent).toContain(expected);
    expect(status.textContent).not.toContain('approved');
    expect(root.querySelector('section')!.getAttribute('data-active')).toBe(
      String(phase === 'running')
    );
  });
  it('retains real active wording alongside static failed and neutral paused cues, including custom captions', () => {
    const fixture = TestBed.createComponent(ChatToolActivityGroupComponent);
    fixture.componentRef.setInput('activities', [
      {
        id: 'a',
        name: 'lookup',
        label: 'Reading references',
        phase: 'running',
      },
      { id: 'b', name: 'save', phase: 'error' },
      { id: 'c', name: 'wait', phase: 'waiting' },
    ]);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('.tp-tool-activity__label')!.textContent).toBe(
      'Reading references'
    );
    expect(root.querySelector('.tp-tool-activity__cue')!.textContent).toBe(
      'Failed · Paused'
    );
    expect(root.querySelector('[data-active="true"]')).toBeTruthy();
    fixture.componentRef.setInput('label', 'Preparing report');
    fixture.detectChanges();
    expect(root.querySelector('.tp-tool-activity__label')!.textContent).toBe(
      'Preparing report'
    );
    expect(root.querySelector('.tp-tool-activity__cue')!.textContent).toContain(
      'Failed'
    );
  });
  it('uses a safe fallback, settles only explicitly complete calls, and omits empty activity', () => {
    const fixture = TestBed.createComponent(ChatToolActivityGroupComponent);
    fixture.componentRef.setInput('activities', [
      { id: 'a', name: 'raw_name', phase: 'running', label: '  ' },
    ]);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('summary').textContent.trim()
    ).toBe('Running tools…');
    fixture.componentRef.setInput(
      'activities',
      Array.from({ length: 4 }, (_, i) => ({
        id: String(i),
        name: 'raw',
        phase: 'complete',
      }))
    );
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('summary').textContent.trim()
    ).toBe('Used 4 tools');
    fixture.componentRef.setInput('activities', []);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('details,[role="status"]')
    ).toBeNull();
  });
  it('shows confirmed outcomes and safe deduplicated sources outside collapsed inspection', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.activities.set([
      {
        id: 'source',
        name: 'lookup',
        phase: 'complete',
        ...{
          outcome: {
            text: 'Found the official reference',
            sources: [
              { title: 'Signals', url: 'https://angular.dev/guide/signals' },
              { title: 'Duplicate', url: 'https://angular.dev/guide/signals' },
              { title: 'Unsafe', url: 'javascript:alert(1)' },
              { title: 'Relative', url: '/private' },
            ],
          },
        },
      },
    ]);
    fixture.detectChanges();
    const group: HTMLElement = fixture.nativeElement.querySelector(
      'chat-tool-activity-group'
    );
    expect(group.querySelector('.tp-tool-outcomes')?.textContent).toContain(
      'Found the official reference'
    );
    expect(
      group.querySelector('.tp-tool-outcomes')?.closest('details')
    ).toBeNull();
    expect(group.querySelectorAll('a')).toHaveLength(1);
    expect(group.querySelector('a')?.getAttribute('href')).toBe(
      'https://angular.dev/guide/signals'
    );
    fixture.componentInstance.activities.update((items) =>
      items.map((item) => ({ ...item, phase: 'running' }))
    );
    fixture.detectChanges();
    expect(
      group.querySelector('.tp-tool-outcomes')?.textContent ?? ''
    ).not.toContain('Found the official reference');
    expect(group.querySelector('a')).toBeNull();
  });
  it('announces concise mixed progress and bounds long outcome previews', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.activities.set([
      ...Array.from({ length: 8 }, (_, index) => ({
        id: String(index),
        name: 'read',
        phase: 'complete' as const,
        outcome: {
          text: `Read reference ${index}`,
          sources: [
            { title: `Source ${index}`, url: `https://example.org/${index}` },
          ],
        },
      })),
      { id: 'live', name: 'read', phase: 'running' },
      { id: 'bad', name: 'read', phase: 'error' },
    ]);
    fixture.detectChanges();
    const group: HTMLElement = fixture.nativeElement.querySelector(
      'chat-tool-activity-group'
    );
    const status = group.querySelector('[role="status"]')!;
    expect(status?.textContent).toContain('8 complete');
    expect(status?.textContent).toContain('1 running');
    expect(status?.textContent).toContain('1 failed');
    expect(group.textContent).toContain('More results (5)');
    expect(group.textContent).toContain('More sources (5)');
  });
  it.each(phases)(
    'resolves $phase after $outcome as $expected without mutating execution',
    ({ phase, outcome, expected }) => {
      expect(
        toolActivityPhase(
          phase as ToolActivityPhase,
          { phase: 'complete', outcome } as ToolActivityDelivery
        )
      ).toBe(expected);
    }
  );
  it('keeps a running call running after a successful message only while the session runs', () => {
    const success = { phase: 'complete', outcome: 'success' } as ToolActivityDelivery;
    expect(toolActivityPhase('running', success, true)).toBe('running');
    expect(toolActivityPhase('running', success, false)).toBe('unknown');
    expect(toolActivityPhase('pending', success, true)).toBe('pending');
    const aborted = { phase: 'complete', outcome: 'aborted' } as ToolActivityDelivery;
    expect(toolActivityPhase('running', aborted, true)).toBe('stopped');
  });
  it.each(['pending', 'stopped'] as const)(
    'retains an explicit %s group outcome',
    (phase) => {
      const fixture = TestBed.createComponent(Host);
      fixture.componentInstance.activities.set([
        { id: 'a', name: 'query', phase },
      ]);
      fixture.detectChanges();
      expect(
        fixture.nativeElement
          .querySelector('.tp-tool-activity-group')
          .getAttribute('data-phase')
      ).toBe(phase);
    }
  );
  beforeEach(() => TestBed.configureTestingModule({ imports: [Host] }));
  it('separates explicit phase and a human label from collapsed literal technical evidence', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const root: HTMLElement =
      fixture.nativeElement.querySelector('chat-tool-activity');
    expect(root.textContent).toContain('Checking airline performance');
    expect(root.textContent).toContain('Running');
    expect(root.querySelector('details')!.open).toBe(false);
    expect(root.querySelector('details')!.textContent).toContain(
      'query_airline_kpis'
    );
    expect(root.querySelector('pre')!.textContent).toBe('{<img>');
    expect(root.querySelector('img')).toBeNull();
  });
  it('retains Details, focus and rich result identity during updates, including an empty result', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const details = fixture.nativeElement.querySelector('details');
    details.open = true;
    const child: HTMLInputElement =
      fixture.nativeElement.querySelector('input');
    child.focus();
    fixture.componentInstance.activity.update((activity) => ({
      ...activity,
      phase: 'complete',
      resultText: '',
    }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('details')).toBe(details);
    expect(details.open).toBe(true);
    expect(fixture.nativeElement.querySelector('input')).toBe(child);
    expect(child.closest('details')).toBeNull();
    expect(document.activeElement).toBe(child);
    expect(details.textContent).toContain('Result');
  });
  it.each(['0', 'false', '', '[]', 'null'])(
    'preserves successful literal output %j',
    (resultText) => {
      const fixture = TestBed.createComponent(Host);
      fixture.componentInstance.activity.set({
        id: 'a',
        name: 'inspect',
        phase: 'complete',
        resultText,
      });
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('pre').textContent).toBe(
        resultText
      );
    }
  );
  it('does not infer success from output and keeps a safe failure visible', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.activity.set({
      id: 'a',
      name: 'save',
      resultText: 'false',
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Status unavailable');
    fixture.componentInstance.activity.set({
      id: 'a',
      name: 'save',
      phase: 'error',
      errorText: 'diagnostic',
      errorSummary: 'The note could not be saved.',
    });
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[role=alert]').textContent.trim()
    ).toBe('The note could not be saved.');
    expect(
      fixture.nativeElement.querySelector('[role=alert]').closest('details')
    ).toBeNull();
  });
  it('keeps grouped disclosure identity by call id across reordering and projected actions outside it', () => {
    const fixture = TestBed.createComponent(Host);
    const a: ToolActivityInfo = { id: 'a', name: 'query', phase: 'complete' },
      b: ToolActivityInfo = { id: 'b', name: 'layout', phase: 'running' };
    fixture.componentInstance.activities.set([a, b]);
    fixture.detectChanges();
    const group = fixture.nativeElement.querySelector(
      'chat-tool-activity-group'
    );
    const inner = group.querySelectorAll('details')[1];
    const outer = group.querySelector('details');
    outer.open = true;
    inner.open = true;
    const inspection = inner.querySelector('summary');
    inspection.focus();
    fixture.componentInstance.activities.set([b, a]);
    fixture.detectChanges();
    expect(group.querySelectorAll('details')[2]).toBe(inner);
    expect(inner.open).toBe(true);
    expect(outer.open).toBe(true);
    expect(document.activeElement).toBe(inspection);
    fixture.componentInstance.activities.set([
      { ...b, phase: 'complete' },
      a,
      { id: 'c', name: 'read', phase: 'complete' },
    ]);
    fixture.detectChanges();
    expect(outer.open).toBe(true);
    expect(inner.open).toBe(true);
    expect(document.activeElement).toBe(inspection);
    expect(group.querySelector('button').closest('details')).toBeNull();
  });
});

describe('resolveToolOutcome', () => {
  it('marks a complete call failed from an app-declared outcome', () => {
    const r = resolveToolOutcome(
      { id: 'b', name: 'read', phase: 'complete', resultText: '{"recoverable":true}' },
      { status: 'failed', text: 'Reference B is unavailable.' }
    );
    expect(r.phase).toBe('error');
    expect(r.errorSummary).toBe('Reference B is unavailable.');
    expect(r.resultText).toBe('{"recoverable":true}');
    expect(r.errorText).toBeUndefined();
  });
  it('never overrides a non-complete phase', () => {
    for (const phase of ['error', 'stopped', 'waiting', 'pending', 'running', 'unknown'] as const) {
      const r = resolveToolOutcome(
        { id: 'x', name: 't', phase, errorText: 'boom' },
        { status: 'failed', text: 'nope' }
      );
      expect(r.phase).toBe(phase);
      expect(r.errorSummary).toBeUndefined();
      expect(r.errorText).toBe('boom');
    }
  });
  it('treats a missing status as succeeded', () => {
    expect(
      resolveToolOutcome({ id: 'a', name: 't', phase: 'complete' }, { text: 'ok' }).phase
    ).toBe('complete');
  });
  it('keeps failed outcomes out of confirmedOutcomes but keeps their sources', () => {
    const failed = resolveToolOutcome(
      { id: 'b', name: 't', phase: 'complete' },
      { status: 'failed', text: 'x', sources: [{ title: 'B', url: 'https://example.com/b' }] }
    );
    expect(confirmedOutcomes([failed])).toEqual([]);
    expect(outcomeSources([failed]).map((s) => s.url)).toEqual(['https://example.com/b']);
  });
  it('ignores sources on an errored activity whose outcome is not failed', () => {
    const errored = {
      id: 'e',
      name: 't',
      phase: 'error' as const,
      outcome: { text: 'ok', sources: [{ title: 'B', url: 'https://example.com/b' }] },
    };
    expect(outcomeSources([errored])).toEqual([]);
  });
});

describe('settled failure copy', () => {
  function renderGroup(activities: readonly ToolActivityInfo[]): HTMLElement {
    const fixture = TestBed.createComponent(ChatToolActivityGroupComponent);
    fixture.componentRef.setInput('activities', activities);
    fixture.detectChanges();
    return fixture.nativeElement;
  }
  function outerAlerts(root: HTMLElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>('[role="alert"]')).filter(
      (el) => el.closest('details') === null
    );
  }
  it('labels a settled mixed group with its failure count', () => {
    const s = activitySummary([
      { id: 'a', name: 't', phase: 'complete' },
      { id: 'b', name: 't', phase: 'error' },
    ]);
    expect(s.label).toBe('Used 2 tools · 1 failed');
    expect(s.status).toBe('Used 2 tools · 1 failed. 1 complete · 1 failed.');
  });
  it('keeps the failed label while work is still waiting', () => {
    expect(
      activitySummary([
        { id: 'a', name: 't', phase: 'error' },
        { id: 'b', name: 't', phase: 'waiting' },
      ]).label
    ).toBe('Tool activity failed');
  });
  it('uses a single-tool noun', () => {
    expect(
      activitySummary([{ id: 'a', name: 't', phase: 'error' }]).label
    ).toBe('Used 1 tool · 1 failed');
  });
  it('lets an app caption win and still cues Failed', () => {
    const s = activitySummary(
      [{ id: 'a', name: 't', phase: 'error' }],
      'Reading references'
    );
    expect(s.label).toBe('Reading references');
    expect(s.cue).toContain('Failed');
  });
  it('shows de-duplicated failure copy in the group alert', () => {
    const root = renderGroup([
      { id: 'a', name: 't', phase: 'error', errorSummary: 'Reference B is unavailable.' },
      { id: 'b', name: 't', phase: 'error', errorSummary: 'Reference B is unavailable.' },
    ]);
    const alerts = outerAlerts(root);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].tagName).toBe('DIV');
    expect(alerts[0].classList.contains('tp-tool-activity__error')).toBe(true);
    expect(
      Array.from(alerts[0].querySelectorAll('p')).map((p) => p.textContent)
    ).toEqual(['Reference B is unavailable.']);
    expect(root.textContent).not.toContain('Some tools could not finish');
  });
  it('falls back to the generic group alert when no summary exists', () => {
    const root = renderGroup([{ id: 'a', name: 't', phase: 'error' }]);
    const alerts = outerAlerts(root);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].tagName).toBe('DIV');
    expect(alerts[0].classList.contains('tp-tool-activity__error')).toBe(true);
    expect(
      Array.from(alerts[0].querySelectorAll('p')).map((p) => p.textContent!.trim())
    ).toEqual(['Some tools could not finish. Check Details before retrying.']);
  });
});

describe('primitives given a failed outcome directly', () => {
  const failedFlight: ToolActivityInfo = {
    id: 'f1',
    name: 'lookup_flight',
    phase: 'complete',
    resultText: '{"error":"Flight UA999 not found"}',
    outcome: { status: 'failed', text: "Flight UA999 isn't in this dataset." },
  };
  it('shows a failed row with the app-authored failure copy', () => {
    const fixture = TestBed.createComponent(ChatToolActivityComponent);
    fixture.componentRef.setInput('activity', failedFlight);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('.tp-tool-activity')?.getAttribute('data-phase')).toBe('error');
    expect(root.querySelector('.tp-tool-activity__phase')?.textContent).toBe('Failed');
    const alerts = root.querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent!.trim()).toBe("Flight UA999 isn't in this dataset.");
    expect(root.textContent).not.toContain('Complete');
  });
  it('counts the failure in the group label and live region', () => {
    const fixture = TestBed.createComponent(ChatToolActivityGroupComponent);
    fixture.componentRef.setInput('activities', [
      { id: 'a', name: 'get_airport_info', phase: 'complete' },
      failedFlight,
    ]);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('.tp-tool-activity__label')?.textContent!.trim()).toBe(
      'Used 2 tools · 1 failed'
    );
    expect(root.querySelector('[role="status"]')?.textContent!.trim()).toBe(
      'Used 2 tools · 1 failed. 1 complete · 1 failed.'
    );
    const groupAlerts = Array.from(root.querySelectorAll('[role="alert"]')).filter(
      (el) => el.closest('details') === null
    );
    expect(groupAlerts).toHaveLength(1);
    expect(groupAlerts[0].textContent!.trim()).toBe("Flight UA999 isn't in this dataset.");
  });
});

describe('empty failure copy', () => {
  it('falls back to no summary when the failed text is blank', () => {
    const r = resolveToolOutcome(
      { id: 'b', name: 't', phase: 'complete' },
      { status: 'failed', text: '   ' }
    );
    expect(r.phase).toBe('error');
    expect(r.errorSummary).toBeUndefined();
  });
  it('trims surrounding whitespace from failure copy', () => {
    expect(
      resolveToolOutcome(
        { id: 'b', name: 't', phase: 'complete' },
        { status: 'failed', text: '  Reference B is unavailable. ' }
      ).errorSummary
    ).toBe('Reference B is unavailable.');
  });
  it('shows the generic row copy for a blank failed outcome', () => {
    const fixture = TestBed.createComponent(ChatToolActivityComponent);
    fixture.componentRef.setInput('activity', {
      id: 'b',
      name: 't',
      phase: 'complete',
      outcome: { status: 'failed', text: '' },
    });
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[role="alert"]')?.textContent!.trim()).toBe(
      'This tool could not finish. Check Details before retrying.'
    );
  });
});

describe('grouped rows', () => {
  function renderOpenGroup(activities: readonly ToolActivityInfo[]): HTMLElement {
    const fixture = TestBed.createComponent(ChatToolActivityGroupComponent);
    fixture.componentRef.setInput('activities', activities);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    root.querySelector('details')!.open = true;
    return root;
  }
  it('names a failed row only by its status word and leaves the message to the group panel', () => {
    const root = renderOpenGroup([
      { id: 'a', name: 'read', label: 'Read toSorted', phase: 'error', errorSummary: 'Reference B is unavailable.' },
      { id: 'b', name: 'read', label: 'Read toReversed', phase: 'complete' },
    ]);
    const list = root.querySelector('.tp-tool-activity-group__items')!;
    expect(list.querySelector('[role="alert"]')).toBeNull();
    expect(list.querySelector('.tp-tool-activity__error')).toBeNull();
    const failedRow = list.querySelector('[data-tool-id="a"]')!;
    expect(failedRow.querySelector('.tp-tool-activity__phase')!.textContent).toBe('Failed');
    expect(root.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(root.textContent!.split('Reference B is unavailable.')).toHaveLength(2);
  });
  it('still shows the failure on a row outside a group', () => {
    const fixture = TestBed.createComponent(ChatToolActivityComponent);
    fixture.componentRef.setInput('activity', { id: 'a', name: 'read', phase: 'error', errorSummary: 'Reference B is unavailable.' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent.trim()).toBe('Reference B is unavailable.');
  });
});

describe('group progress', () => {
  const running: readonly ToolActivityInfo[] = [
    { id: 'a', name: 'read', label: 'Read toSorted', phase: 'complete' },
    { id: 'b', name: 'read', label: 'Read toReversed', phase: 'running' },
    { id: 'c', name: 'read', label: 'Read with', phase: 'pending' },
  ];
  const plan = [
    { label: 'Read the proposals', status: 'completed' },
    { label: 'Compare the two drafts', status: 'pending' },
    { label: 'Write the summary', status: 'pending' },
  ] as const;
  function render(activities: readonly ToolActivityInfo[], inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(ChatToolActivityGroupComponent);
    fixture.componentRef.setInput('activities', activities);
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
    return fixture;
  }
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-11T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the elapsed time while running and ticks it once a second', () => {
    const fixture = render(running);
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('.tp-tool-activity-group__elapsed')!.textContent!.trim()).toBe('0s');
    vi.advanceTimersByTime(65_000);
    fixture.detectChanges();
    expect(root.querySelector('.tp-tool-activity-group__elapsed')!.textContent!.trim()).toBe('1m 05s');
    // The progress sits outside the disclosure, so it never toggles it.
    expect(root.querySelector('.tp-tool-activity-group__progress')!.closest('details')).toBeNull();
  });

  it('drops the elapsed time and stops ticking once the group settles, and restarts on the next run', () => {
    const fixture = render(running);
    vi.advanceTimersByTime(5_000);
    fixture.componentRef.setInput('activities', running.map((item) => ({ ...item, phase: 'complete' as const })));
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('.tp-tool-activity-group__progress')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    fixture.componentRef.setInput('activities', running);
    fixture.detectChanges();
    expect(root.querySelector('.tp-tool-activity-group__elapsed')!.textContent!.trim()).toBe('0s');
  });

  it('offers Stop only when stoppable, and emits stop without toggling the group', () => {
    const fixture = render(running);
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('.tp-tool-activity-group__stop')).toBeNull();
    fixture.componentRef.setInput('stoppable', true);
    fixture.detectChanges();
    let stops = 0;
    fixture.componentInstance.stop.subscribe(() => stops++);
    const stop = root.querySelector<HTMLButtonElement>('.tp-tool-activity-group__stop')!;
    expect(stop.textContent!.trim()).toBe('Stop');
    expect(stop.type).toBe('button');
    stop.click();
    expect(stops).toBe(1);
    expect(root.querySelector('details')!.open).toBe(false);
  });

  it('hides Stop once the group settles', () => {
    const fixture = render(running, { stoppable: true });
    fixture.componentRef.setInput('activities', running.map((item) => ({ ...item, phase: 'complete' as const })));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.tp-tool-activity-group__stop')).toBeNull();
  });

  it('reads "Working · 1 of 3 done" while open and running, and keeps an app caption', () => {
    const fixture = render(running);
    const root: HTMLElement = fixture.nativeElement;
    const details = root.querySelector('details')!;
    const label = () => root.querySelector('summary .tp-tool-activity__label')!;
    expect(label().textContent!.trim()).toBe('Read toReversed');
    expect(label().getAttribute('data-active')).toBe('true');
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    fixture.detectChanges();
    expect(label().textContent!.trim()).toBe('Working · 1 of 3 done');
    expect(label().getAttribute('data-active')).toBe('false');
    fixture.componentRef.setInput('label', 'Preparing report');
    fixture.detectChanges();
    expect(label().textContent!.trim()).toBe('Preparing report');
  });

  it('lists pending plan steps after the calls only while running', () => {
    const fixture = render(running, { plan });
    const root: HTMLElement = fixture.nativeElement;
    const steps = () =>
      [...root.querySelectorAll('.tp-tool-activity-group__items .tp-tool-activity-group__plan-step')].map((step) =>
        step.textContent!.trim()
      );
    expect(steps()).toEqual(['Compare the two drafts', 'Write the summary']);
    fixture.componentRef.setInput('activities', running.map((item) => ({ ...item, phase: 'complete' as const })));
    fixture.detectChanges();
    expect(steps()).toEqual([]);
  });

  it('lists no steps without a plan', () => {
    const fixture = render(running);
    expect(fixture.nativeElement.querySelectorAll('.tp-tool-activity-group__plan-step')).toHaveLength(0);
  });
});

describe('default tool heading', () => {
  it.each([
    ['search_documents', 'Search documents'],
    ['searchDocuments', 'Search documents'],
    ['search-documents', 'Search documents'],
    ['get_airport_info', 'Get airport info'],
    ['fetchURL', 'Fetch URL'],
    ['HTTPRequest', 'HTTP request'],
    ['v2_lookup', 'V2 lookup'],
    ['__', ''],
  ])('reads %s as "%s"', (name, words) => {
    expect(humanizeToolName(name)).toBe(words);
  });

  it('prefers the label, then the name as words, then a generic fallback', () => {
    expect(toolActivityHeading({ name: 'search_documents', label: 'Searching the archive' })).toBe('Searching the archive');
    expect(toolActivityHeading({ name: 'search_documents', label: '  ' })).toBe('Search documents');
    expect(toolActivityHeading({ name: '__' })).toBe('Tool activity');
  });

  it('heads an unlabelled row with the tool name as words and keeps the raw name in Details', () => {
    const fixture = TestBed.createComponent(ChatToolActivityComponent);
    fixture.componentRef.setInput('activity', { id: 'c1', name: 'search_documents', phase: 'complete' });
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('.tp-tool-activity__heading span')!.textContent!.trim()).toBe('Search documents');
    expect(root.querySelector('.tp-tool-activity__details code')!.textContent).toBe('search_documents');
  });
});
