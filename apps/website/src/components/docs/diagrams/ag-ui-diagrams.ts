import type { NetworkDefinition, SequenceDefinition } from './diagram-model';

// Sources: Angular AG-UI architecture guide, libs/ag-ui adapter/provider and @ag-ui/client boundary.
export const agUiArchitecture: NetworkDefinition = {
  kind: 'architecture',
  title: 'Commands go out. Agent events come back.',
  caption:
    'The UI reads the Agent contract. The adapter turns protocol events into Angular signals. Solid arrows carry commands; dashed arrows carry updates.',
  description:
    'Inside the browser, your Angular UI consumes the Agent contract from @threadplane/chat. It submits messages or resume decisions to @threadplane/ag-ui. The adapter wraps an AbstractAgent with toAgent(). In this network example, HttpAgent calls your AG-UI endpoint and receives protocol events; the adapter projects them into signals for the UI. The server owns agent execution. Tests can replace the protocol client with an in-process fake, without crossing the network.',
  width: 580,
  height: 552,
  groups: [
    {
      label: 'Browser · your application',
      x: 12,
      y: 12,
      width: 556,
      height: 340,
    },
    {
      label: 'Server · your agent runtime',
      x: 12,
      y: 390,
      width: 556,
      height: 150,
    },
  ],
  nodes: [
    {
      id: 'ui',
      x: 160,
      y: 60,
      width: 260,
      title: 'Your Angular UI',
      detail: '@threadplane/chat Agent contract',
    },
    {
      id: 'adapter',
      x: 160,
      y: 232,
      width: 260,
      title: '@threadplane/ag-ui',
      detail: 'toAgent() · AbstractAgent',
      accent: true,
    },
    {
      id: 'runtime',
      x: 160,
      y: 436,
      width: 260,
      title: 'AG-UI runtime',
      detail: 'HttpAgent calls your endpoint',
    },
  ],
  edges: [
    {
      from: 'ui',
      to: 'adapter',
      points: [
        [220, 148],
        [220, 232],
      ],
      label: { text: 'submit / resume', x: 140, y: 196 },
    },
    {
      from: 'adapter',
      to: 'ui',
      points: [
        [360, 232],
        [360, 148],
      ],
      dashed: true,
      label: { text: 'signals', x: 425, y: 196 },
    },
    {
      from: 'adapter',
      to: 'runtime',
      points: [
        [220, 308],
        [220, 436],
      ],
      label: { text: 'commands', x: 150, y: 376 },
    },
    {
      from: 'runtime',
      to: 'adapter',
      points: [
        [360, 436],
        [360, 308],
      ],
      dashed: true,
      label: { text: 'protocol events', x: 450, y: 376 },
    },
  ],
};

// Sources: Angular AG-UI interrupts guide, submit({resume}) and interrupt session projection.
export const agUiInterrupts: SequenceDefinition = {
  kind: 'sequence',
  title: 'A decision crosses the boundary twice',
  caption:
    'The runtime requests a decision; the person supplies it. Submitting a resume is not proof that the action completed. Dashed arrows show runtime events.',
  description:
    'Read downward across the runtime, adapter and UI, and person. The runtime pauses with an approval request. Threadplane exposes the pending interrupt and the UI presents it. The person approves or rejects. The UI submits that decision through the adapter to the runtime. Resumed run events report what happens next, and the UI displays the reported outcome. The backend determines the branch and whether the action succeeds. Native and compatibility backends use different wire formats; this diagram shows their shared handoff, not a specific event encoding.',
  participants: [
    { id: 'runtime', title: 'Agent runtime' },
    { id: 'ui', title: 'Adapter + UI' },
    { id: 'person', title: 'Person' },
  ],
  messages: [
    { from: 'runtime', to: 'ui', label: 'Pause with a request', dashed: true },
    { from: 'ui', to: 'person', label: 'Show the pending action' },
    { from: 'person', to: 'ui', label: 'Approve or reject' },
    { from: 'ui', to: 'runtime', label: 'Submit the decision' },
    {
      from: 'runtime',
      to: 'ui',
      label: 'Emit resumed run events',
      dashed: true,
    },
    { from: 'ui', to: 'person', label: 'Show the reported outcome' },
  ],
};

// Sources: cockpit/ag-ui/subagents/python/prompts/subagents.md, streaming/subagent_emitting_agent.py,
// libs/ag-ui subagent reducer and chat tool-call attribution. Branching represents identity, not concurrency.
export const agUiSubagents: NetworkDefinition = {
  kind: 'flow',
  title: 'Separate child runs. One parent conversation.',
  caption:
    'This demo dispatches research, booking, then itinerary, one at a time. Branches show separate child identities. One result path is shown; every child returns to the parent. Attributed events populate child cards.',
  description:
    'The parent agent dispatches the task tool to research, booking and itinerary in that order. Each dispatch has its own tool call ID and child run. A child returns a tool result to the parent, while its streamed events carry subagentRunId to the browser adapter. SUBAGENT_STARTED supplies parentToolCallId. The adapter keeps child messages separate, and the chat UI matches that tool call ID to render the child card at its originating call. The branches do not imply parallel execution. The parent can use each tool result before producing its final summary.',
  width: 580,
  height: 744,
  groups: [
    {
      label: 'Agent runtime · sequential dispatch',
      x: 8,
      y: 8,
      width: 564,
      height: 348,
    },
    {
      label: 'Browser · attributed rendering',
      x: 8,
      y: 436,
      width: 564,
      height: 296,
    },
  ],
  nodes: [
    {
      id: 'parent',
      x: 180,
      y: 64,
      width: 220,
      title: 'Parent agent',
      detail: 'Dispatch one task at a time',
    },
    {
      id: 'research',
      x: 30,
      y: 250,
      width: 170,
      title: '1. Research',
      detail: 'Separate child run',
    },
    {
      id: 'booking',
      x: 205,
      y: 250,
      width: 170,
      title: '2. Booking',
      detail: 'Separate child run',
    },
    {
      id: 'itinerary',
      x: 380,
      y: 250,
      width: 170,
      title: '3. Itinerary',
      detail: 'Separate child run',
    },
    {
      id: 'adapter',
      x: 150,
      y: 484,
      width: 280,
      title: 'AG-UI adapter',
      detail: 'parentToolCallId links the child to its originating tool call',
      accent: true,
    },
    {
      id: 'cards',
      x: 150,
      y: 636,
      width: 280,
      title: 'Child cards in your UI',
      detail: 'Separate messages and status',
    },
  ],
  edges: [
    {
      from: 'parent',
      to: 'research',
      points: [
        [290, 152],
        [290, 206],
        [115, 206],
        [115, 250],
      ],
      label: { text: 'task calls · 1 → 2 → 3', x: 410, y: 192 },
    },
    {
      from: 'parent',
      to: 'booking',
      points: [
        [290, 152],
        [290, 250],
      ],
    },
    {
      from: 'parent',
      to: 'itinerary',
      points: [
        [290, 152],
        [290, 206],
        [465, 206],
        [465, 250],
      ],
    },
    {
      from: 'research',
      to: 'parent',
      points: [
        [30, 288],
        [16, 288],
        [16, 108],
        [180, 108],
      ],
      dashed: true,
      label: { text: 'tool result', x: 96, y: 94 },
    },
    {
      from: 'research',
      to: 'adapter',
      points: [
        [115, 326],
        [115, 390],
        [290, 390],
        [290, 484],
      ],
      dashed: true,
      label: { text: 'events carry subagentRunId', x: 420, y: 418 },
    },
    {
      from: 'booking',
      to: 'adapter',
      points: [
        [290, 326],
        [290, 484],
      ],
      dashed: true,
    },
    {
      from: 'itinerary',
      to: 'adapter',
      points: [
        [465, 326],
        [465, 390],
        [290, 390],
        [290, 484],
      ],
      dashed: true,
    },
    {
      from: 'adapter',
      to: 'cards',
      points: [
        [290, 572],
        [290, 636],
      ],
      label: { text: 'match the tool call', x: 420, y: 614 },
    },
  ],
};
