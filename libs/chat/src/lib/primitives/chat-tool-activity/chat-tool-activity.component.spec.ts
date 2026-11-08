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
