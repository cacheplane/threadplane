import type { NetworkDefinition } from './diagram-model';

// Angular AG-UI tool-views guide and the chat tool-views component/registry bridge.
export const toolViewFlow: NetworkDefinition = {
  kind: 'flow',
  title: 'The server runs the tool. Your app owns the view.',
  caption:
    'Tool arguments and results cross the boundary as data. The frontend matches the tool name to a registered component; no UI spec comes from the server.',
  description:
    'The server executes the tool and streams its arguments and result. The AG-UI adapter reduces those events into a tool call associated with its assistant message. In the browser, the views registry matches the tool name to a component. The render bridge supplies inputs from arguments and the parsed result. TOOL_CALL_END means the arguments ended, not that the result arrived; the view must check the data it needs before leaving its loading state. This is presentation of a server tool, not browser execution of a client tool.',
  width: 580,
  height: 528,
  groups: [
    { label: 'Server · tool execution', x: 12, y: 12, width: 556, height: 144 },
    { label: 'Browser · presentation', x: 12, y: 208, width: 556, height: 308 },
  ],
  nodes: [
    {
      id: 'tool',
      x: 150,
      y: 56,
      width: 280,
      title: 'Server tool',
      detail: 'Executes and returns plain data',
    },
    {
      id: 'adapter',
      x: 150,
      y: 240,
      width: 280,
      title: 'AG-UI adapter',
      detail: 'Tool call, arguments and result',
      accent: true,
    },
    {
      id: 'view',
      x: 150,
      y: 424,
      width: 280,
      title: 'Registered component',
      detail: 'Inputs from arguments and result',
    },
  ],
  edges: [
    {
      from: 'tool',
      to: 'adapter',
      points: [
        [290, 132],
        [290, 240],
      ],
      dashed: true,
      label: { text: 'protocol events', x: 420, y: 192 },
    },
    {
      from: 'adapter',
      to: 'view',
      points: [
        [290, 316],
        [290, 424],
      ],
      label: { text: 'match the tool name', x: 420, y: 376 },
    },
  ],
};

// Render Events guide and libs/render/src/lib/render-element.component.ts dispatch/follow-up handling.
export const renderEventFlow: NetworkDefinition = {
  kind: 'flow',
  title: 'An event becomes an application action',
  caption:
    'The spec names an action; your application supplies the handler. A handler may update state, navigate, or do other work. The dashed path applies when it writes to bound state.',
  description:
    'A rendered component calls emit(event). The element’s on[event] binding selects an action name. The dispatcher resolves parameters and calls the registered handler, subject to any confirmation. The handler may update the signal state store; bound component props then react to the new values. State writes are optional: handlers can instead log, navigate, or perform asynchronous work. Success and error follow-ups remain configured by the action binding. This is a client-side action flow, not a network request by itself.',
  width: 580,
  height: 650,
  nodes: [
    {
      id: 'component',
      x: 150,
      y: 32,
      width: 280,
      title: 'Rendered component',
      detail: 'Calls emit(event)',
    },
    {
      id: 'binding',
      x: 150,
      y: 202,
      width: 280,
      title: 'Action binding',
      detail: 'on[event] selects an action',
      accent: true,
    },
    {
      id: 'handler',
      x: 150,
      y: 372,
      width: 280,
      title: 'Registered handler',
      detail: 'Application-owned behavior',
    },
    {
      id: 'store',
      x: 150,
      y: 542,
      width: 280,
      title: 'Signal state store',
      detail: 'Values used by bound props',
    },
  ],
  edges: [
    {
      from: 'component',
      to: 'binding',
      points: [
        [290, 108],
        [290, 202],
      ],
      label: { text: 'look up the event', x: 420, y: 162 },
    },
    {
      from: 'binding',
      to: 'handler',
      points: [
        [290, 278],
        [290, 372],
      ],
      label: { text: 'resolve params · dispatch', x: 430, y: 332 },
    },
    {
      from: 'handler',
      to: 'store',
      points: [
        [290, 448],
        [290, 542],
      ],
      label: { text: 'optional state write', x: 420, y: 502 },
    },
    {
      from: 'store',
      to: 'component',
      points: [
        [150, 580],
        [32, 580],
        [32, 70],
        [150, 70],
      ],
      dashed: true,
      label: { text: 'bound values', x: 90, y: 350 },
    },
  ],
};

// LangGraph state-management guide: a thread identifies persisted checkpoint history.
export const checkpointHistory: NetworkDefinition = {
  kind: 'architecture',
  title: 'One thread. A history of saved states.',
  caption:
    'The thread ID identifies the conversation. Checkpoints preserve earlier states; the browser does not become the checkpoint store.',
  description:
    'A thread on the server owns a history of immutable checkpoint snapshots. Earlier and later checkpoints contain the state saved at different points in execution. The branches show ownership, not parallel execution. A checkpoint ID identifies a particular saved state within that thread. The application uses a thread ID to retrieve persisted history; retaining the ID in the browser does not persist the conversation itself.',
  width: 580,
  height: 350,
  groups: [
    {
      label: 'Server · persisted history',
      x: 4,
      y: 4,
      width: 572,
      height: 338,
    },
  ],
  nodes: [
    {
      id: 'thread',
      x: 180,
      y: 48,
      width: 220,
      title: 'Thread',
      detail: 'One conversation ID',
      accent: true,
    },
    {
      id: 'first',
      x: 15,
      y: 234,
      width: 170,
      title: 'Checkpoint 1',
      detail: 'Earlier state',
    },
    {
      id: 'second',
      x: 205,
      y: 234,
      width: 170,
      title: 'Checkpoint 2',
      detail: 'Later state',
    },
    {
      id: 'latest',
      x: 395,
      y: 234,
      width: 170,
      title: 'Checkpoint 3',
      detail: 'Latest saved state',
    },
  ],
  edges: [
    {
      from: 'thread',
      to: 'first',
      points: [
        [290, 124],
        [290, 190],
        [100, 190],
        [100, 234],
      ],
      label: { text: 'checkpoint history', x: 410, y: 174 },
    },
    {
      from: 'thread',
      to: 'second',
      points: [
        [290, 124],
        [290, 234],
      ],
    },
    {
      from: 'thread',
      to: 'latest',
      points: [
        [290, 124],
        [290, 190],
        [480, 190],
        [480, 234],
      ],
    },
  ],
};
