import { describe, expect, it } from 'vitest';
import { ownTranscript, type Transcript } from './transcript';
import { projectTextTranscript } from './text-transcript';
import { bindingFixture } from './testing/binding-fixture';

const rich = ownTranscript([
  { id: 'system', role: 'system', content: 'Policy' },
  { id: 'developer', role: 'developer', content: 'Instructions' },
  // Native snapshots can contain null attribution even though the SDK type omits it.
  {
    id: 'user',
    role: 'user',
    content: '  Root\nquestion  ',
    subagentRunId: null,
  } as unknown as Transcript[number],
  {
    id: 'parts',
    role: 'user',
    content: [
      { type: 'text', text: 'First' },
      {
        type: 'image',
        source: { type: 'url', value: 'https://image.invalid' },
      },
      { type: 'text', text: 'Second' },
    ],
  },
  {
    id: 'assistant',
    role: 'assistant',
    content: '<b>literal</b>',
    encryptedValue: 'opaque',
    toolCalls: [
      {
        id: 'call',
        type: 'function',
        function: { name: 'weather', arguments: '{"city":' },
      },
    ],
  },
  { id: 'empty', role: 'assistant', content: '' },
  { id: 'opaque', role: 'assistant', encryptedValue: 'never display' },
  {
    id: 'nontext',
    role: 'user',
    content: [
      {
        type: 'image',
        source: { type: 'url', value: 'https://image.invalid' },
      },
    ],
  },
  { id: 'space', role: 'assistant', content: ' \n ' },
  { id: 'child', role: 'assistant', content: 'Child', subagentRunId: 'worker' },
  { id: 'empty-child', role: 'user', content: 'Child too', subagentRunId: '' },
  { id: 'tool', role: 'tool', content: 'Tool result', toolCallId: 'call' },
  {
    id: 'reasoning-independent',
    role: 'reasoning',
    content: 'Private reasoning',
    encryptedValue: 'reason',
  },
  {
    id: 'activity',
    role: 'activity',
    activityType: 'progress',
    content: { step: 1 },
  },
]);

describe('projectTextTranscript', () => {
  it('selects literal root text only without changing any owned protocol data', () => {
    const before = JSON.stringify(rich);
    const rows = projectTextTranscript(rich);
    expect(rows).toEqual([
      { id: 'user', role: 'user', content: '  Root\nquestion  ' },
      { id: 'parts', role: 'user', content: 'First\nSecond' },
      { id: 'assistant', role: 'assistant', content: '<b>literal</b>' },
      { id: 'space', role: 'assistant', content: ' \n ' },
    ]);
    expect(JSON.stringify(rich)).toBe(before);
    expect(Object.isFrozen(rows)).toBe(true);
    expect(rows.every(Object.isFrozen)).toBe(true);
    expect(() => Reflect.set(rows[0], 'content', 'changed')).not.toThrow();
    expect(rows[0].content).toBe('  Root\nquestion  ');
  });

  it('reuses rows by id/role/text and arrays by ordered row identity', () => {
    const first = projectTextTranscript(rich);
    expect(projectTextTranscript(ownTranscript([...rich]), first)).toBe(first);
    const excluded = ownTranscript([
      ...rich,
      {
        id: 'child-2',
        role: 'assistant',
        content: 'ignored',
        subagentRunId: 'worker',
      },
    ]);
    expect(projectTextTranscript(excluded, first)).toBe(first);
    const edited = ownTranscript(
      rich.map((row) =>
        row.role === 'assistant' && row.id === 'assistant'
          ? { ...row, content: 'Updated' }
          : row
      )
    );
    const next = projectTextTranscript(edited, first);
    expect(next).not.toBe(first);
    expect(next[0]).toBe(first[0]);
    expect(next[2]).not.toBe(first[2]);
    expect(next[2].content).toBe('Updated');
    expect(first[2].content).toBe('<b>literal</b>');
    const reordered = projectTextTranscript(
      ownTranscript([edited[4], edited[2]]),
      next
    );
    expect(reordered).toEqual([next[2], next[0]]);
    expect(reordered[0]).toBe(next[2]);
    expect(reordered[1]).toBe(next[0]);
    const changedRole = projectTextTranscript(
      ownTranscript([
        { id: 'user', role: 'assistant', content: first[0].content },
      ]),
      first
    );
    expect(changedRole[0]).not.toBe(first[0]);
    expect(projectTextTranscript([], first)).toEqual([]);
    expect(Object.isFrozen(projectTextTranscript([]))).toBe(true);
  });

  it('never replaces actual owner request history, including excluded data and incomplete raw arguments', async () => {
    const fixture = bindingFixture({
      messages: rich,
      state: { retained: true },
    });
    try {
      const run = fixture.session.submit('First');
      const first = await fixture.started();
      first.emit({
        type: 'RUN_FINISHED',
        threadId: first.body.threadId,
        runId: first.body.runId,
      });
      expect(await run).toBe('success');
      const snapshot = fixture.session.getSnapshot();
      const visible = projectTextTranscript(snapshot.transcript);
      expect(visible.map((row) => row.id)).not.toContain('tool');
      expect(visible.map((row) => row.id)).not.toContain('child');
      const nextRun = fixture.session.submit('Second');
      const second = await fixture.started(1);
      expect(second.body).toEqual({
        threadId: 'native-thread',
        runId: expect.any(String),
        messages: [
          ...rich
            .filter((row) => row.role !== 'activity')
            .map((row) => {
              const result = { ...row };
              if (result.subagentRunId === null) delete result.subagentRunId;
              return result;
            }),
          {
            id: first.body.messages.at(-1)?.id,
            role: 'user',
            content: 'First',
          },
          { id: expect.any(String), role: 'user', content: 'Second' },
        ],
        state: { retained: true },
        tools: [],
        context: [],
        forwardedProps: {},
      });
      expect(JSON.stringify(second.body.messages)).toContain('{\\"city\\":');
      expect(fixture.session.getSnapshot().transcript).not.toBe(visible);
      await fixture.session.stop();
      expect(await nextRun).toBe('aborted');
    } finally {
      await fixture.cleanup();
    }
  });
});
