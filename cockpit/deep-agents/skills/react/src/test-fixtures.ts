import { captureBaseline, captureTurn } from './authority';
export function authorityInput(
  status = 'success',
  args: unknown = { file_path: '/skills/runway-analysis/SKILL.md' },
  result = '1  instruction'
) {
  const messages = [
    { id: 'human', type: 'human', content: 'Inspect runway.' },
    {
      id: 'call-message',
      type: 'ai',
      content: '',
      tool_calls: [{ id: 'read', name: 'read_file', args, type: 'tool_call' }],
    },
    {
      id: 'result',
      type: 'tool',
      content: result,
      name: 'read_file',
      tool_call_id: 'read',
      status,
    },
    { id: 'final', type: 'ai', content: 'Assessment.', tool_calls: [] },
  ];
  const values = {
    messages,
    skills_metadata: [
      {
        name: 'runway-analysis',
        description: 'Runway example.',
        path: '/skills/runway-analysis/SKILL.md',
      },
    ],
    files: {},
  };
  const state = {
    values,
    next: [],
    tasks: [],
    checkpoint: {
      thread_id: 'thread',
      checkpoint_ns: '',
      checkpoint_id: 'checkpoint',
    },
  };
  const delivery = {
    generation: 'sdk-generation',
    phase: 'complete',
    outcome: 'success',
  };
  const snapshot = {
    status: 'idle',
    messages: [
      { id: 'human', role: 'user', content: 'Inspect runway.', delivery },
      {
        id: 'call-message',
        role: 'assistant',
        content: '',
        toolCallIds: ['read'],
        delivery,
      },
      {
        id: 'result',
        role: 'tool',
        content: result,
        name: 'read_file',
        toolCallId: 'read',
        delivery,
      },
      {
        id: 'final',
        role: 'assistant',
        content: 'Assessment.',
        toolCallIds: [],
        delivery,
      },
    ],
    toolCalls: [
      { id: 'read', name: 'read_file', args, status: 'complete', result },
    ],
    values: { skills_metadata: values.skills_metadata, files: {} },
    interrupts: [],
    subgraphs: [],
  };
  const turn = captureTurn(captureBaseline(), {
    owner: 'owner',
    generation: 'generation',
    threadId: 'thread',
    humanId: 'human',
    humanContent: 'Inspect runway.',
  });
  return {
    turn,
    owner: 'owner',
    generation: 'generation',
    threadId: 'thread',
    outcome: 'success',
    observedState: state,
    history: [structuredClone(state)],
    loadedCheckpoint: structuredClone(state),
    snapshot,
    loadedSnapshot: structuredClone(snapshot),
  };
}
export const skill = {
  name: 'runway-analysis',
  description: 'Bundled runway example.',
  path: '/skills/runway-analysis/SKILL.md',
  metadata: { author: 'Example' },
  license: 'MIT',
  compatibility: null,
  allowed_tools: ['read_file'],
};
export const indexInput = (
  values: unknown = { skills_metadata: [structuredClone(skill)] }
) => ({
  owner: 'owner',
  generation: 'generation',
  currentOwner: 'owner',
  currentGeneration: 'generation',
  source: 'observed-root' as const,
  values,
});
