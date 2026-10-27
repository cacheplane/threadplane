import '@angular/compiler';
import { submitMessage } from '@threadplane/chat';
import { TestBed } from '@angular/core/testing';
import { mockLangGraphAgent } from '@threadplane/langgraph';
import { describe, it, expect, vi, beforeEach } from 'vitest';
const holder = vi.hoisted(() => ({ agent: undefined as any }));
vi.mock('@threadplane/langgraph', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  injectAgent: () => holder.agent,
}));
import { MemoryComponent } from './memory.component';
const scope = '12345678-1234-4234-8234-123456789abc';
describe('MemoryComponent source honesty', () => {
  beforeEach(() => {
    holder.agent = mockLangGraphAgent();
    localStorage.setItem('threadplane.deep-agents-memory.scope.v1', scope);
  });
  function component(): any {
    return TestBed.runInInjectionContext(() => new MemoryComponent());
  }
  it('uses an empty live store observation instead of an older checkpoint', () => {
    const c = component();
    holder.agent.value.set({
      memory_scope_owner: scope,
      memory_contents: { '/memories/AGENTS.md': 'old' },
    });
    holder.agent.customEvents.set([
      {
        name: 'deep_agents.memory',
        data: {
          memory_scope_owner: scope,
          memory_contents: {},
          phase: 'terminal',
        },
      },
    ]);
    expect(c.memorySource()).toBe('live');
    expect(c.memoryFiles()).toEqual([]);
  });
  it('blocks the ordinary composer and automatic suggestion after storage changes', async () => {
    const c = component();
    const submit = vi.spyOn(holder.agent, 'submit');
    localStorage.removeItem('threadplane.deep-agents-memory.scope.v1');
    submitMessage(c.agent, 'ordinary composer');
    c.send('automatic suggestion');
    await Promise.resolve();
    expect(submit).not.toHaveBeenCalled();
  });
  it('rejects wrong scope instead of claiming live success', () => {
    const c = component();
    holder.agent.customEvents.set([
      {
        name: 'deep_agents.memory',
        data: {
          memory_scope_owner: 'bad',
          memory_contents: { '/memories/AGENTS.md': 'wrong' },
          phase: 'terminal',
        },
      },
    ]);
    expect(c.memorySource()).toBe('unavailable');
    expect(c.memoryFiles()).toEqual([]);
  });
  it.each([
    { memory_contents: {}, memory_scope_owner: scope, phase: 'wrong' },
    {
      memory_contents: { '/wrong': 'text' },
      memory_scope_owner: scope,
      phase: 'model',
    },
    {
      memory_contents: { '/memories/AGENTS.md': 1 },
      memory_scope_owner: scope,
      phase: 'model',
    },
    {
      memory_contents: { '/memories/AGENTS.md': '\ud800' },
      memory_scope_owner: scope,
      phase: 'model',
    },
    {
      memory_contents: { '/memories/AGENTS.md': 'é'.repeat(32769) },
      memory_scope_owner: scope,
      phase: 'model',
    },
    { memory_contents: [], memory_scope_owner: scope, phase: 'model' },
    {
      memory_contents: {},
      memory_scope_owner: scope,
      phase: 'model',
      extra: true,
    },
  ])('rejects malformed scoped observations %j', (data) => {
    const c = component();
    holder.agent.customEvents.set([{ name: 'deep_agents.memory', data }]);
    expect(c.memorySource()).toBe('unavailable');
    expect(c.memoryFiles()).toEqual([]);
  });
  it('retains literal backing text while preserving older trimmed line presentation', () => {
    const c = component();
    const contents = '  first  \n\n second\n';
    holder.agent.customEvents.set([
      {
        name: 'deep_agents.memory',
        data: {
          memory_scope_owner: scope,
          memory_contents: { '/memories/AGENTS.md': contents },
          phase: 'initial',
        },
      },
    ]);
    expect(c.memoryFiles()).toEqual([
      { path: '/memories/AGENTS.md', contents, lines: ['first', 'second'] },
    ]);
    holder.agent.customEvents.set([
      {
        name: 'deep_agents.memory',
        data: {
          memory_scope_owner: scope,
          memory_contents: { '/memories/AGENTS.md': '' },
          phase: 'terminal',
        },
      },
    ]);
    expect(c.memorySource()).toBe('live');
    expect(c.memoryFiles()).toHaveLength(1);
    expect(c.memoryFiles()[0].contents).toBe('');
  });
  it('revokes live evidence on error and avoids checkpoint fallback while a new run loads', () => {
    const c = component();
    holder.agent.value.set({
      memory_scope_owner: scope,
      memory_contents: { '/memories/AGENTS.md': 'historical' },
    });
    expect(c.memorySource()).toBe('checkpoint');
    holder.agent.isLoading.set(true);
    expect(c.memorySource()).toBe('none');
    holder.agent.customEvents.set([
      {
        name: 'deep_agents.memory',
        data: {
          memory_scope_owner: scope,
          memory_contents: {},
          phase: 'terminal',
        },
      },
    ]);
    expect(c.memorySource()).toBe('live');
    holder.agent.error.set({ message: 'read failed', kind: 'unknown' });
    expect(c.memorySource()).toBe('unavailable');
    expect(c.memoryFiles()).toEqual([]);
  });
  it('does not present wrong-owner checkpoint, tool prose, or absent source as empty success', () => {
    const c = component();
    expect(c.memorySource()).toBe('none');
    holder.agent.customEvents.set([
      { name: 'tool', data: { memory_contents: {} } },
    ]);
    expect(c.memorySource()).toBe('none');
    holder.agent.value.set({
      memory_scope_owner: 'wrong',
      memory_contents: {},
    });
    expect(c.memorySource()).toBe('unavailable');
  });

  it('handles hostile malformed records without crashing or reporting empty success', () => {
    const c = component();
    const malformed = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('invalid record');
        },
      }
    );
    holder.agent.customEvents.set([
      { name: 'deep_agents.memory', data: malformed },
    ]);
    expect(() => c.memorySource()).not.toThrow();
    expect(c.memorySource()).toBe('unavailable');
  });
  it('accepts the exact UTF8 boundary and valid scalar Unicode', () => {
    const c = component();
    const contents = 'é'.repeat(32768);
    holder.agent.customEvents.set([
      {
        name: 'deep_agents.memory',
        data: {
          memory_scope_owner: scope,
          memory_contents: { '/memories/AGENTS.md': contents },
          phase: 'model',
        },
      },
    ]);
    expect(c.memoryFiles()[0].contents).toBe(contents);
    holder.agent.customEvents.set([
      {
        name: 'deep_agents.memory',
        data: {
          memory_scope_owner: scope,
          memory_contents: { '/memories/AGENTS.md': '😀' },
          phase: 'model',
        },
      },
    ]);
    expect(c.memoryFiles()[0].contents).toBe('😀');
  });
});
