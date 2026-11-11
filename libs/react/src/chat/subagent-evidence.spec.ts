import { describe, expect, it } from 'vitest';
import { subagentsFromEvidence, type SubagentEvidenceMessage } from './index';

const transcript: SubagentEvidenceMessage[] = [
  { id: 'u', role: 'user', content: 'Compare the guides' },
  {
    id: 'a',
    role: 'assistant',
    content: '',
    toolCalls: [
      { id: 'root-call', function: { name: 'delegate', arguments: '{}' } },
    ],
  },
  { id: 'r', role: 'reasoning', content: 'Read both', subagentRunId: 'child' },
  {
    id: 'c',
    role: 'assistant',
    content: 'Reading',
    subagentRunId: 'child',
    toolCalls: [
      { id: 'read-1', function: { name: 'read', arguments: '{"id":1}' } },
      { id: 'read-2', function: { name: 'read', arguments: '{"id":2}' } },
    ],
  },
  {
    id: 't1',
    role: 'tool',
    content: 'Signals guide',
    toolCallId: 'read-1',
    subagentRunId: 'child',
  },
  { id: 'o', role: 'assistant', content: 'Stray', subagentRunId: 'orphan' },
  { id: 't', role: 'tool', content: 'done', toolCallId: 'root-call' },
];
const started = {
  subagentRunId: 'child',
  name: 'reader',
  description: 'Reads guides',
  parentToolCallId: 'root-call',
};

describe('subagentsFromEvidence', () => {
  it('groups attributed messages under their child and keeps only root messages in the transcript', () => {
    const projection = subagentsFromEvidence({
      subagents: [{ started, terminal: { type: 'SUBAGENT_FINISHED' } }],
      transcript,
      toolLabel: (name) => (name === 'read' ? 'Reading a reference' : undefined),
    });
    // Root rows keep their identity; orphaned child rows are removed too.
    expect(projection.transcript).toEqual([
      transcript[0],
      transcript[1],
      transcript[6],
    ]);
    expect(projection.transcript[1]).toBe(transcript[1]);
    expect(projection.subagents).toEqual([
      {
        id: 'child',
        toolCallId: 'root-call',
        name: 'reader',
        description: 'Reads guides',
        status: 'complete',
        messages: [
          { id: 'r', reasoning: 'Read both' },
          {
            id: 'c',
            text: 'Reading',
            activities: [
              {
                id: 'read-1',
                name: 'read',
                label: 'Reading a reference',
                phase: 'complete',
                argumentsText: '{"id":1}',
                resultText: 'Signals guide',
              },
              {
                id: 'read-2',
                name: 'read',
                label: 'Reading a reference',
                phase: 'unknown',
                argumentsText: '{"id":2}',
                resultText: undefined,
              },
            ],
          },
        ],
      },
    ]);
  });

  it('derives status from evidence only', () => {
    const status = (terminal?: { type: string }, running?: boolean) =>
      subagentsFromEvidence({
        subagents: [{ started, terminal }],
        transcript,
        running,
      }).subagents[0];
    expect(status({ type: 'SUBAGENT_ERROR' }).status).toBe('error');
    expect(status({ type: 'SUBAGENT_FINISHED' }, true).status).toBe('complete');
    // No terminal evidence does not establish that a child is still running.
    expect(status(undefined).status).toBe('unknown');
    const live = status(undefined, true);
    expect(live.status).toBe('running');
    expect(live.messages[1].activities!.map((a) => a.phase)).toEqual([
      'complete',
      'running',
    ]);
  });

  it('returns a child with no messages and an untouched transcript when nothing is attributed', () => {
    const root = transcript.filter((m) => m.subagentRunId === undefined);
    const projection = subagentsFromEvidence({
      subagents: [{ started: { subagentRunId: 'quiet' } }],
      transcript: root,
    });
    expect(projection.transcript).toEqual(root);
    expect(projection.subagents).toEqual([
      {
        id: 'quiet',
        toolCallId: undefined,
        name: undefined,
        description: undefined,
        status: 'unknown',
        messages: [],
      },
    ]);
  });
});
