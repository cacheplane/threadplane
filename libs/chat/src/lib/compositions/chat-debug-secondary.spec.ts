import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { mockAgent } from '../testing/mock-agent';
import { ChatDebugComponent } from '../../../debug/public-api';
import { StateInspectorComponent } from '../../../debug/src/lib/compositions/chat-debug/inspectors/state-inspector.component';
import { TimelineInspectorComponent } from '../../../debug/src/lib/compositions/chat-debug/inspectors/timeline-inspector.component';

describe('chat debug secondary entrypoint', () => {
  it('exports ChatDebugComponent from @threadplane/chat/debug', () => {
    expect(typeof ChatDebugComponent).toBe('function');
  });

  it('accepts a base Agent without checkpoint history for state inspection', () => {
    const fixture = TestBed.createComponent(StateInspectorComponent);
    fixture.componentRef.setInput('agent', mockAgent({ state: { count: 2 } }));
    fixture.detectChanges();
    expect((fixture.componentInstance as unknown as { state: () => Record<string, unknown> }).state()).toEqual({ count: 2 });
  });

  it('shows an empty state for an agent whose backend has reported no state', () => {
    const fixture = TestBed.createComponent(StateInspectorComponent);
    fixture.componentRef.setInput('agent', mockAgent());
    fixture.detectChanges();
    expect((fixture.componentInstance as unknown as { state: () => Record<string, unknown> }).state()).toEqual({});
  });

  it('reads the timeline from checkpoints(), newest first, with the state values of each point', () => {
    // The agent reports its history oldest first.
    const agent = mockAgent({
      checkpoints: [
        { id: 'c1', label: 'agent', values: { count: 1 } },
        { id: 'c2', values: { count: 2 } },
      ],
    });
    const fixture = TestBed.createComponent(TimelineInspectorComponent);
    fixture.componentRef.setInput('agent', agent);
    fixture.detectChanges();
    const inspector = fixture.componentInstance;
    // Rows are newest first, and an unlabelled row is named by its position.
    expect(inspector.checkpoints()).toEqual([
      { node: 'Step 1', checkpointId: 'c2' },
      { node: 'agent', checkpointId: 'c1' },
    ]);
    expect(inspector.currentStateAt(0)).toEqual({ count: 2 });
    expect(inspector.currentStateAt(1)).toEqual({ count: 1 });
    // A row is diffed against the row listed above it; the first has none.
    expect(inspector.previousStateAt(1)).toEqual({ count: 2 });
    expect(inspector.previousStateAt(0)).toEqual({});
    expect(fixture.nativeElement.querySelectorAll('.timeline__row').length).toBe(2);

    agent.checkpoints.update((all) => [...(all ?? []), { id: 'c3', label: 'tools', values: { count: 3 } }]);
    fixture.detectChanges();
    expect(inspector.checkpoints()).toEqual([
      { node: 'tools', checkpointId: 'c3' },
      { node: 'Step 2', checkpointId: 'c2' },
      { node: 'agent', checkpointId: 'c1' },
    ]);
    expect(inspector.currentStateAt(0)).toEqual({ count: 3 });
    expect(inspector.currentStateAt(2)).toEqual({ count: 1 });
  });

  it('lists a graph run as legacy did: Step 1 for the terminal checkpoint, then the nodes backwards', () => {
    // Oldest first, as a LangGraph session publishes a run: each label is the
    // node the checkpoint would run next, and the last one has none.
    const agent = mockAgent({
      checkpoints: [
        { id: 'c0', label: '__start__', values: {} },
        { id: 'c1', label: 'generate', values: { messages: ['q'] } },
        { id: 'c2', label: 'process', values: { messages: ['q', 'a'] } },
        { id: 'c3', label: 'summarize', values: { messages: ['q', 'a'] } },
        { id: 'c4', label: 'generate_title', values: { messages: ['q', 'a'] } },
        { id: 'c5', values: { messages: ['q', 'a'], title: 't' } },
      ],
    });
    const fixture = TestBed.createComponent(TimelineInspectorComponent);
    fixture.componentRef.setInput('agent', agent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const rows = () =>
      Array.from(root.querySelectorAll('chat-debug-checkpoint-card')).map((el) => el.textContent?.trim());
    expect(rows()).toEqual(['Step 1', 'generate_title', 'summarize', 'process', 'generate', '__start__']);
    expect(root.querySelector('.timeline__empty')).toBeNull();

    // Selecting the first row shows the newest checkpoint: its replay id, and
    // its whole state as the diff, since no row is listed above it.
    const replayed: string[] = [];
    fixture.componentInstance.replayRequested.subscribe((id) => replayed.push(id));
    root.querySelector<HTMLButtonElement>('chat-debug-checkpoint-card button')?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedIndex()).toBe(0);
    root.querySelector<HTMLButtonElement>('.row-action')?.click();
    expect(replayed).toEqual(['c5']);
    expect(fixture.componentInstance.currentStateAt(0)).toEqual({ messages: ['q', 'a'], title: 't' });
    expect(fixture.componentInstance.previousStateAt(0)).toEqual({});
    expect(root.querySelector('chat-debug-state-diff')?.textContent).toContain('+ messages');
  });

  it('offers the timeline tab to an agent that reports checkpoints, empty before the first read', () => {
    @Component({
      standalone: true,
      imports: [ChatDebugComponent],
      template: `<chat-debug [agent]="agent" [defaultOpen]="true" storageKey="chat-debug-secondary-timeline-spec" />`,
    })
    class Host {
      agent = mockAgent({ state: { ready: true } });
    }

    const fixture = TestBed.createComponent(Host);
    const settle = () => fixture.detectChanges();
    settle();
    const root = fixture.nativeElement as HTMLElement;
    const tabs = () => Array.from(root.querySelectorAll('.panel__tab')).map((el) => el.textContent?.trim());
    // An agent that keeps no checkpoint state: checkpoints() is undefined, so
    // state is the only view, with no tab strip and no empty timeline.
    expect(tabs()).toEqual([]);
    expect(root.querySelector('chat-debug-timeline-inspector')).toBeNull();
    expect(root.querySelector('chat-debug-state-tab')).not.toBeNull();

    // An agent that keeps checkpoint state reports a list from the start,
    // empty until a history is read: the timeline tab is there before any run.
    fixture.componentInstance.agent.checkpoints.set([]);
    settle();
    expect(tabs()).toEqual(['Timeline', 'State']);
    // The timeline is the panel's default view: it is shown as soon as its
    // tab exists, with no click, as it was for an agent that always had one.
    expect(root.querySelector('.panel__tab.is-active')?.textContent?.trim()).toBe('Timeline');
    expect(root.querySelector('chat-debug-timeline-inspector')).not.toBeNull();
    expect(root.querySelector('chat-debug-state-tab')).toBeNull();
    expect(root.querySelector('.timeline__empty')?.textContent).toContain('No checkpoints yet.');
    expect(root.querySelector('chat-debug-checkpoint-card')).toBeNull();

    fixture.componentInstance.agent.checkpoints.set([{ id: 'c1', label: 'agent', values: { count: 1 } }]);
    settle();
    expect(root.querySelectorAll('.timeline__row').length).toBe(1);

    // The history goes away (a thread with none): back to the state view alone.
    fixture.componentInstance.agent.checkpoints.set(undefined);
    settle();
    expect(tabs()).toEqual([]);
    expect(root.querySelector('chat-debug-timeline-inspector')).toBeNull();
    expect(root.querySelector('chat-debug-state-tab')).not.toBeNull();

    // A choice the person made is kept across a history that comes and goes.
    fixture.componentInstance.agent.checkpoints.set([]);
    settle();
    root.querySelectorAll<HTMLButtonElement>('.panel__tab')[1].click();
    settle();
    expect(root.querySelector('chat-debug-state-tab')).not.toBeNull();
    fixture.componentInstance.agent.checkpoints.set(undefined);
    settle();
    fixture.componentInstance.agent.checkpoints.set([]);
    settle();
    expect(root.querySelector('.panel__tab.is-active')?.textContent?.trim()).toBe('State');
  });

  it('renders through the secondary component with a base Agent', () => {
    @Component({
      standalone: true,
      imports: [ChatDebugComponent],
      template: `<chat-debug [agent]="agent" [defaultOpen]="true" storageKey="chat-debug-secondary-spec" />`,
    })
    class Host {
      agent = mockAgent({ state: { ready: true } });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-label="Chat devtools"]')).not.toBeNull();
  });
});
