import { describe, it, expect } from 'vitest';
import { Component, signal, computed } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChatSubagentsComponent, activeSubagentsFromAgent } from './chat-subagents.component';
import { mockAgent } from '../../testing/mock-agent';
import type { AgentSubagent, AgentSubagentStatus } from '../../agent';

function makeSubagent(toolCallId: string, status: AgentSubagentStatus): AgentSubagent {
  return { id: `child-${toolCallId}`, toolCallId, status, messages: [], toolCalls: [] };
}

describe('activeSubagentsFromAgent()', () => {
  it('returns an empty array when the session reports no subagents', () => {
    const agent = mockAgent();
    expect(agent.subagents()).toBeUndefined();
    expect(activeSubagentsFromAgent(agent)).toEqual([]);
  });

  it('returns an empty array when the subagents list is empty', () => {
    const agent = mockAgent({ subagents: [] });
    expect(activeSubagentsFromAgent(agent)).toEqual([]);
  });

  it('includes subagents with status pending or running', () => {
    const agent = mockAgent();
    const pending = makeSubagent('tc-1', 'pending');
    const running = makeSubagent('tc-2', 'running');
    agent.subagents.set([pending, running]);
    const active = activeSubagentsFromAgent(agent);
    expect(active).toHaveLength(2);
    expect(active).toContain(agent.subagents()![0]);
    expect(active).toContain(agent.subagents()![1]);
    expect(active).toEqual([pending, running]);
  });

  it('excludes subagents with status complete or error', () => {
    const agent = mockAgent();
    const complete = makeSubagent('tc-1', 'complete');
    const error    = makeSubagent('tc-2', 'error');
    const running  = makeSubagent('tc-3', 'running');
    agent.subagents.set([complete, error, running]);
    const active = activeSubagentsFromAgent(agent);
    expect(active).toEqual([running]);
  });

  it('treats a child of unknown outcome as active', () => {
    const agent = mockAgent();
    const unknown = makeSubagent('tc-1', 'unknown');
    agent.subagents.set([makeSubagent('tc-0', 'complete'), unknown]);
    expect(activeSubagentsFromAgent(agent)).toEqual([unknown]);
  });
});

describe('SubagentsComponent — activeSubagents computed', () => {
  it('reflects the agent list and updates reactively', () => {
    const agent = mockAgent();
    const running = makeSubagent('tc-1', 'running');

    const agent$ = signal(agent);
    const active = computed(() => activeSubagentsFromAgent(agent$()));

    expect(active()).toHaveLength(0);
    agent.subagents.set([running]);
    expect(active()).toEqual([running]);
  });
});

describe('ChatSubagentsComponent — rendering', () => {
  @Component({
    standalone: true,
    imports: [ChatSubagentsComponent],
    template: `<chat-subagents [agent]="agent" />`,
  })
  class Host {
    agent = mockAgent();
  }

  it('renders a card for each active child, including one with no spawning call, and drops it when it ends', () => {
    const fixture = TestBed.createComponent(Host);
    const agent = fixture.componentInstance.agent;
    agent.subagents.set([
      { id: 'one', toolCallId: 'tc-1', name: 'researcher', status: 'running' },
      { id: 'two', name: 'writer', status: 'pending' },
      { id: 'three', toolCallId: 'tc-3', name: 'done', status: 'complete' },
    ]);
    fixture.detectChanges();
    const names = () =>
      Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('chat-subagent-card .sac__name')).map((n) => n.textContent);
    expect(names()).toEqual(['researcher', 'writer']);

    agent.subagents.set([
      { id: 'one', toolCallId: 'tc-1', name: 'researcher', status: 'complete' },
      { id: 'two', name: 'writer', status: 'running' },
    ]);
    fixture.detectChanges();
    expect(names()).toEqual(['writer']);
  });
});
