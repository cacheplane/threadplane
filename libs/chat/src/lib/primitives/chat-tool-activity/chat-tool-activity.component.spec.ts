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
    inner.open = true;
    fixture.componentInstance.activities.set([b, a]);
    fixture.detectChanges();
    expect(group.querySelectorAll('details')[2]).toBe(inner);
    expect(inner.open).toBe(true);
    expect(group.querySelector('button').closest('details')).toBeNull();
  });
});
