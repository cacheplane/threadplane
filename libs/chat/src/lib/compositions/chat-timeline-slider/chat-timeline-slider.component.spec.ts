import { describe, it, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ChatTimelineSliderComponent } from './chat-timeline-slider.component';
import type { AgentCheckpoint } from '../../agent';
import { mockAgent } from '../../testing/mock-agent';

describe('ChatTimelineSliderComponent', () => {
  it('lists the agent\'s saved history from checkpoints(), oldest first', () => {
    const agent = mockAgent();
    const fixture = TestBed.createComponent(ChatTimelineSliderComponent);
    fixture.componentRef.setInput('agent', agent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    // No history loaded yet: checkpoints() is undefined.
    expect(root.querySelector('.timeline-slider__count')?.textContent).toBe('0 checkpoint(s)');
    expect(root.querySelector('.timeline-slider__empty')?.textContent).toBe('No checkpoints yet.');

    agent.checkpoints.set([
      { id: 'ck1', label: 'agent', values: { step: 1 } },
      { values: { step: 2 } },
    ]);
    fixture.detectChanges();
    expect(fixture.componentInstance.history()).toBe(agent.checkpoints());
    expect(root.querySelector('.timeline-slider__count')?.textContent).toBe('2 checkpoint(s)');
    expect(root.querySelector('.timeline-slider__empty')).toBeNull();
    const labels = Array.from(root.querySelectorAll('.timeline-slider__label')).map((el) => el.textContent);
    expect(labels).toEqual(['agent', 'Step 2']);
    expect(Array.from(root.querySelectorAll('.timeline-slider__id')).map((el) => el.textContent)).toEqual(['ck1']);

    const replayed = vi.fn();
    const forked = vi.fn();
    fixture.componentInstance.replayRequested.subscribe(replayed);
    fixture.componentInstance.forkRequested.subscribe(forked);
    const buttons = root.querySelectorAll<HTMLButtonElement>('.timeline-slider__btn');
    buttons[0].click();
    buttons[1].click();
    expect(replayed).toHaveBeenCalledWith('ck1');
    expect(forked).toHaveBeenCalledWith('ck1');
    fixture.detectChanges();
    expect(root.querySelector('.timeline-slider__entry')?.getAttribute('data-active')).toBe('true');
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
