import { describe, it, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ChatTimelineSliderComponent } from './chat-timeline-slider.component';
import type { AgentCheckpoint } from '../../agent';
import { mockAgent } from '../../testing/mock-agent';

describe('ChatTimelineSliderComponent', () => {
  it('lists the agent\'s saved history from checkpoints(), newest first', () => {
    const agent = mockAgent();
    const fixture = TestBed.createComponent(ChatTimelineSliderComponent);
    fixture.componentRef.setInput('agent', agent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    // No history loaded yet: checkpoints() is undefined.
    expect(root.querySelector('.timeline-slider__count')?.textContent).toBe('0 checkpoint(s)');
    expect(root.querySelector('.timeline-slider__empty')?.textContent).toBe('No checkpoints yet.');

    // The agent reports its history oldest first: ck1 was saved before the
    // unlabelled checkpoint.
    agent.checkpoints.set([
      { id: 'ck1', label: 'agent', values: { step: 1 } },
      { values: { step: 2 } },
    ]);
    fixture.detectChanges();
    expect(fixture.componentInstance.history()).toEqual([...(agent.checkpoints() ?? [])].reverse());
    expect(root.querySelector('.timeline-slider__count')?.textContent).toBe('2 checkpoint(s)');
    expect(root.querySelector('.timeline-slider__empty')).toBeNull();
    // Listed newest first. The newest has no label and takes its position's.
    const labels = Array.from(root.querySelectorAll('.timeline-slider__label')).map((el) => el.textContent);
    expect(labels).toEqual(['Step 1', 'agent']);
    expect(Array.from(root.querySelectorAll('.timeline-slider__index')).map((el) => el.textContent)).toEqual(['1', '2']);
    expect(Array.from(root.querySelectorAll('.timeline-slider__id')).map((el) => el.textContent)).toEqual(['ck1']);
    const entries = root.querySelectorAll('.timeline-slider__entry');
    expect(entries[0].querySelector('.timeline-slider__id')).toBeNull();
    expect(entries[1].querySelector('.timeline-slider__id')?.textContent).toBe('ck1');

    const replayed = vi.fn();
    const forked = vi.fn();
    fixture.componentInstance.replayRequested.subscribe(replayed);
    fixture.componentInstance.forkRequested.subscribe(forked);
    // The second entry is ck1.
    const buttons = entries[1].querySelectorAll<HTMLButtonElement>('.timeline-slider__btn');
    buttons[0].click();
    buttons[1].click();
    expect(replayed).toHaveBeenCalledWith('ck1');
    expect(forked).toHaveBeenCalledWith('ck1');
    fixture.detectChanges();
    expect(entries[0].getAttribute('data-active')).toBeNull();
    expect(entries[1].getAttribute('data-active')).toBe('true');
  });

  it('labels a graph run as legacy did: the terminal checkpoint is Step 1, then the nodes backwards', () => {
    // Oldest first, as a LangGraph session publishes a run: each label is the
    // node the checkpoint would run next, and the last one has none.
    const agent = mockAgent({
      checkpoints: [
        { id: 'c0', label: '__start__', values: {} },
        { id: 'c1', label: 'generate', values: {} },
        { id: 'c2', label: 'process', values: {} },
        { id: 'c3', values: {} },
      ],
    });
    const fixture = TestBed.createComponent(ChatTimelineSliderComponent);
    fixture.componentRef.setInput('agent', agent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(Array.from(root.querySelectorAll('.timeline-slider__label')).map((el) => el.textContent))
      .toEqual(['Step 1', 'process', 'generate', '__start__']);
    expect(Array.from(root.querySelectorAll('.timeline-slider__id')).map((el) => el.textContent))
      .toEqual(['c3', 'c2', 'c1', 'c0']);
  });

  it('replay() emits the checkpoint id when id is present', () => {
    TestBed.runInInjectionContext(() => {
      const slider = new ChatTimelineSliderComponent();
      const spy = vi.fn();
      slider.replayRequested.subscribe(spy);
      slider.replay({ id: 'ck1', values: {} } as AgentCheckpoint);
      expect(spy).toHaveBeenCalledWith('ck1');
    });
  });

  it('replay() does not emit when id is undefined', () => {
    TestBed.runInInjectionContext(() => {
      const slider = new ChatTimelineSliderComponent();
      const spy = vi.fn();
      slider.replayRequested.subscribe(spy);
      slider.replay({ values: {} } as AgentCheckpoint);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  it('fork() updates selectedIndex and emits the id', () => {
    TestBed.runInInjectionContext(() => {
      const slider = new ChatTimelineSliderComponent();
      const spy = vi.fn();
      slider.forkRequested.subscribe(spy);
      slider.fork({ id: 'ck2', values: {} } as AgentCheckpoint, 3);
      expect(slider.selectedIndex()).toBe(3);
      expect(spy).toHaveBeenCalledWith('ck2');
    });
  });
});
