import { describe, it, expect } from 'vitest';
import { Component, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChatTimelineComponent } from './chat-timeline.component';
import { mockAgent } from '../../testing/mock-agent';
import type { AgentCheckpoint } from '../../agent';

@Component({
  standalone: true,
  imports: [ChatTimelineComponent],
  template: `
    <chat-timeline [agent]="agent" (checkpointSelected)="selected = $event">
      <ng-template let-cp let-i="index"><span class="cp">{{ i }}:{{ cp.label }}</span></ng-template>
    </chat-timeline>
  `,
})
class Host {
  agent = mockAgent();
  selected: AgentCheckpoint | undefined;
  readonly timeline = viewChild.required(ChatTimelineComponent);
}

describe('ChatTimelineComponent', () => {
  const rendered = (el: HTMLElement) => Array.from(el.querySelectorAll('.cp')).map((n) => n.textContent).join('');

  it('renders a template for each checkpoint, newest first', () => {
    // The agent reports its history oldest first.
    const checkpoints: AgentCheckpoint[] = [
      { id: 'a', label: 'nodeA', values: {} },
      { id: 'b', label: 'nodeB', values: {} },
    ];
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.agent = mockAgent({ checkpoints });
    fixture.detectChanges();

    expect(fixture.componentInstance.timeline().history()).toHaveLength(2);
    // Index 0 is the newest checkpoint.
    expect(rendered(fixture.nativeElement)).toBe('0:nodeB1:nodeA');
    expect(fixture.componentInstance.timeline().history().map((cp) => cp.id)).toEqual(['b', 'a']);
    // The agent's own list is left as it was.
    expect(fixture.componentInstance.agent.checkpoints()?.map((cp) => cp.id)).toEqual(['a', 'b']);
  });

  it('puts a checkpoint saved later at index 0', () => {
    const fixture = TestBed.createComponent(Host);
    const agent = fixture.componentInstance.agent;
    agent.checkpoints.set([{ id: 'a', label: 'nodeA', values: {} }]);
    fixture.detectChanges();
    agent.checkpoints.update((all) => [...(all ?? []), { id: 'b', label: 'nodeB', values: {} }]);
    fixture.detectChanges();
    expect(rendered(fixture.nativeElement)).toBe('0:nodeB1:nodeA');
  });

  it('renders nothing while no history is loaded, then follows checkpoints()', () => {
    const fixture = TestBed.createComponent(Host);
    const agent = fixture.componentInstance.agent;
    fixture.detectChanges();
    expect(agent.checkpoints()).toBeUndefined();
    expect(fixture.componentInstance.timeline().history()).toEqual([]);
    expect(rendered(fixture.nativeElement)).toBe('');

    agent.checkpoints.set([{ id: 'a', label: 'nodeA', values: { step: 1 } }]);
    fixture.detectChanges();
    expect(rendered(fixture.nativeElement)).toBe('0:nodeA');
  });

  it('emits the checkpoint passed to selectCheckpoint()', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.agent = mockAgent({ checkpoints: [{ id: 'a', label: 'nodeA', values: { step: 1 } }] });
    fixture.detectChanges();
    const cp = fixture.componentInstance.agent.checkpoints()![0];
    fixture.componentInstance.timeline().selectCheckpoint(cp);
    expect(fixture.componentInstance.selected).toBe(cp);
  });
});
