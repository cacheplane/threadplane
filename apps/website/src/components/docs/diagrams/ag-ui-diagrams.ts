import type { NetworkDefinition, SequenceDefinition } from './diagram-model';

// Sources: Angular AG-UI architecture guide, libs/ag-ui createSession(), libs/angular provideAgent() and the @ag-ui/client boundary.
export const agUiArchitecture: NetworkDefinition = {
  kind: 'architecture',
  title: 'Commands go out. Agent events come back.',
  caption:
    'The UI reads the injected Agent. The session turns protocol events into snapshots, and the Agent publishes them as Angular signals. Solid arrows carry commands; dashed arrows carry updates.',
  description:
    'Inside the browser, your Angular UI reads the Agent that injectAgent() from @threadplane/angular returns. Its submit and resume commands pass to the session that createSession() from @threadplane/ag-ui built. The session owns an AG-UI client agent: an HttpAgent for a url, or the agent you pass. In this network example, HttpAgent calls your AG-UI endpoint and receives protocol events; the session projects them into snapshots, and the Agent exposes each snapshot field as a signal for the UI. The server owns agent execution. Tests can replace the protocol client with an in-process fake, without crossing the network.',
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
      detail: 'injectAgent() · @threadplane/angular',
    },
    {
      id: 'adapter',
      x: 160,
      y: 232,
      width: 260,
      title: '@threadplane/ag-ui',
      detail: 'createSession() · AG-UI client',
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
      label: { text: 'submit() / resume()', x: 132, y: 196 },
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

// Sources: Angular AG-UI interrupts guide, resume(responses) and the session's interrupt projection.
export const agUiInterrupts: SequenceDefinition = {
  kind: 'sequence',
  title: 'A decision crosses the boundary twice',
  caption:
    'The runtime requests a decision; the person supplies it. Sending the answer is not proof that the action completed. Dashed arrows show runtime events.',
  description:
    'Read downward across the runtime, session and UI, and person. The runtime pauses with an approval request. The session publishes the pending interrupt and the UI presents it. The person approves or rejects. The UI answers with resume(), and the session sends that decision to the runtime. Resumed run events report what happens next, and the UI displays the reported outcome. The backend determines the branch and whether the action succeeds. Native and compatibility backends use different wire formats; this diagram shows their shared handoff, not a specific event encoding.',
  participants: [
    { id: 'runtime', title: 'Agent runtime' },
    { id: 'ui', title: 'Session + UI' },
    { id: 'person', title: 'Person' },
  ],
  messages: [
    { from: 'runtime', to: 'ui', label: 'Pause with a request', dashed: true },
    { from: 'ui', to: 'person', label: 'Show the pending action' },
    { from: 'person', to: 'ui', label: 'Approve or reject' },
    { from: 'ui', to: 'runtime', label: 'Resume with the decision' },
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
// libs/ag-ui session subagent projection and chat tool-call attribution. Branching represents identity, not concurrency.
export const agUiSubagents: NetworkDefinition = {
  kind: 'flow',
  title: 'Separate child runs. One parent conversation.',
  caption:
    'This demo dispatches research, booking, then itinerary, one at a time. Branches show separate child identities. One result path is shown; every child returns to the parent. Attributed events populate child cards.',
  description:
    'The parent agent dispatches the task tool to research, booking and itinerary in that order. Each dispatch has its own tool call ID and child run. A child returns a tool result to the parent, while its streamed events carry subagentRunId to the session in the browser. SUBAGENT_STARTED supplies parentToolCallId. The session keeps child messages separate, and the chat UI matches that tool call ID to render the child card at its originating call. The branches do not imply parallel execution. The parent can use each tool result before producing its final summary.',
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
      title: 'AG-UI session',
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
