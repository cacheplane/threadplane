import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { ChatToolCallCardComponent, type ToolCallInfo } from './chat-tool-call-card.component';

@Component({
  standalone: true,
  imports: [ChatToolCallCardComponent],
  template: `<chat-tool-call-card [toolCall]="tc()" [defaultCollapsed]="defaultCollapsed()" />`,
})
class HostComponent {
  tc = signal<ToolCallInfo>({ id: '1', name: 'search', args: {}, status: 'running' });
  defaultCollapsed = signal<boolean>(true);
}

function getStatusPill(fixture: any): HTMLElement {
  return fixture.nativeElement.querySelector('chat-tool-call-card .tcc__pill');
}

function getCardExpanded(fixture: any): boolean {
  return fixture.nativeElement.querySelector('chat-tool-call-card chat-trace')?.getAttribute('data-expanded') === 'true';
}

function getCardHeader(fixture: any): HTMLButtonElement {
  return fixture.nativeElement.querySelector('chat-tool-call-card chat-trace .chat-trace__header');
}

describe('ChatToolCallCardComponent — status pill', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
  });

  it('renders a "running" pill while running', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const pill = getStatusPill(fixture);
    expect(pill.getAttribute('data-status')).toBe('running');
    expect(pill.getAttribute('aria-label')).toBe('Running');
  });

  it('renders a "complete" pill when complete', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.tc.set({ id: '1', name: 'search', args: {}, status: 'complete', result: 'r' });
    fixture.detectChanges();
    const pill = getStatusPill(fixture);
    expect(pill.getAttribute('data-status')).toBe('complete');
    expect(pill.getAttribute('aria-label')).toBe('Completed');
  });

  it('renders an "error" pill when errored', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.tc.set({ id: '1', name: 'search', args: {}, status: 'error', result: 'oops' });
    fixture.detectChanges();
    const pill = getStatusPill(fixture);
    expect(pill.getAttribute('data-status')).toBe('error');
    expect(pill.getAttribute('aria-label')).toBe('Failed');
  });
});

describe('ChatToolCallCardComponent — default-collapsed behavior', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
  });

  it('expanded while running', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(getCardExpanded(fixture)).toBe(true);
  });

  it('expanded when errored', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.tc.set({ id: '1', name: 'search', args: {}, status: 'error' });
    fixture.detectChanges();
    expect(getCardExpanded(fixture)).toBe(true);
  });

  it('collapsed when complete and defaultCollapsed=true', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.tc.set({ id: '1', name: 'search', args: {}, status: 'complete', result: 'r' });
    fixture.detectChanges();
    expect(getCardExpanded(fixture)).toBe(false);
  });

  it('expanded when complete and defaultCollapsed=false', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.defaultCollapsed.set(false);
    fixture.componentInstance.tc.set({ id: '1', name: 'search', args: {}, status: 'complete', result: 'r' });
    fixture.detectChanges();
    expect(getCardExpanded(fixture)).toBe(true);
  });

  it('respects user toggle across status changes', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(getCardExpanded(fixture)).toBe(true);
    getCardHeader(fixture).click();
    fixture.detectChanges();
    expect(getCardExpanded(fixture)).toBe(false);
    fixture.componentInstance.tc.set({ id: '1', name: 'search', args: {}, status: 'complete', result: 'r' });
    fixture.detectChanges();
    expect(getCardExpanded(fixture)).toBe(false);
  });
});
