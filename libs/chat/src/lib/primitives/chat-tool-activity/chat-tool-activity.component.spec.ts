import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
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
import { activitySummary } from './activity-summary';
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
