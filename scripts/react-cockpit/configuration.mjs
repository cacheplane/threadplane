/** Closed authored frontend selection; callers cannot supply filesystem paths. */
export function reactCockpitConfiguration(topic = 'streaming') {
  if (topic === 'chat-timeline')
    return Object.freeze({
      topic: 'timeline', library: 'chat', adapter: 'langgraph', appPath: 'cockpit/chat/timeline/react',
      base: '/chat/timeline/react/', port: 4626, project: 'cockpit-chat-timeline-react',
    });
  if (topic === 'chat-threads')
    return Object.freeze({
      topic: 'threads', library: 'chat', adapter: 'langgraph', appPath: 'cockpit/chat/threads/react',
      base: '/chat/threads/react/', port: 4625, project: 'cockpit-chat-threads-react',
    });
  if (topic === 'chat-subagents')
    return Object.freeze({
      topic: 'subagents', library: 'chat', adapter: 'langgraph', appPath: 'cockpit/chat/subagents/react',
      base: '/chat/subagents/react/', port: 4624, project: 'cockpit-chat-subagents-react',
    });
  if (topic === 'chat-tool-calls')
    return Object.freeze({
      topic: 'tool-calls', library: 'chat', adapter: 'langgraph', appPath: 'cockpit/chat/tool-calls/react',
      base: '/chat/tool-calls/react/', port: 4623, project: 'cockpit-chat-tool-calls-react',
    });
  if (topic === 'chat-interrupts')
    return Object.freeze({
      topic: 'interrupts', library: 'chat', adapter: 'langgraph', appPath: 'cockpit/chat/interrupts/react',
      base: '/chat/interrupts/react/', port: 4622, project: 'cockpit-chat-interrupts-react',
    });
  if (topic === 'chat-input')
    return Object.freeze({
      topic: 'input', adapter: 'langgraph', appPath: 'cockpit/chat/input/react',
      base: '/chat/input/react/', port: 4621, project: 'cockpit-chat-input-react',
    });
  if (topic === 'chat-messages')
    return Object.freeze({
      topic: 'messages',
      adapter: 'langgraph',
      appPath: 'cockpit/chat/messages/react',
      base: '/chat/messages/react/',
      port: 4620,
      project: 'cockpit-chat-messages-react',
    });
  if (topic === 'render-computed-functions')
    return Object.freeze({
      topic: 'computed-functions', adapter: 'none',
      appPath: 'cockpit/render/computed-functions/react',
      base: '/render/computed-functions/react/', port: 4619,
      project: 'cockpit-render-computed-functions-react',
    });
  if (topic === 'render-element-rendering')
    return Object.freeze({
      topic: 'element-rendering',
      adapter: 'none',
      appPath: 'cockpit/render/element-rendering/react',
      base: '/render/element-rendering/react/',
      port: 4618,
      project: 'cockpit-render-element-rendering-react',
    });
  if (topic === 'render-registry')
    return Object.freeze({
      topic: 'registry', adapter: 'none', appPath: 'cockpit/render/registry/react',
      base: '/render/registry/react/', port: 4617, project: 'cockpit-render-registry-react',
    });
  if (topic === 'render-repeat-loops')
    return Object.freeze({
      topic: 'repeat-loops', adapter: 'none', appPath: 'cockpit/render/repeat-loops/react',
      base: '/render/repeat-loops/react/', port: 4616, project: 'cockpit-render-repeat-loops-react',
    });
  if (topic === 'render-state-management')
    return Object.freeze({
      topic: 'state-management',
      adapter: 'none',
      appPath: 'cockpit/render/state-management/react',
      base: '/render/state-management/react/',
      port: 4615,
      project: 'cockpit-render-state-management-react',
    });
  if (topic === 'render-spec-rendering')
    return Object.freeze({
      topic: 'spec-rendering',
      adapter: 'none',
      appPath: 'cockpit/render/spec-rendering/react',
      base: '/render/spec-rendering/react/',
      port: 4614,
      project: 'cockpit-render-spec-rendering-react',
    });
  if (topic === 'ag-ui-subagents')
    return Object.freeze({
      topic: 'subagents',
      adapter: 'ag-ui',
      appPath: 'cockpit/ag-ui/subagents/react',
      base: '/ag-ui/subagents/react/',
      port: 4613,
      project: 'cockpit-ag-ui-subagents-react',
    });
  if (topic === 'ag-ui-json-render')
    return Object.freeze({
      topic: 'json-render',
      adapter: 'ag-ui',
      appPath: 'cockpit/ag-ui/json-render/react',
      base: '/ag-ui/json-render/react/',
      port: 4612,
      project: 'cockpit-ag-ui-json-render-react',
    });
  if (topic === 'ag-ui-tool-views')
    return Object.freeze({
      topic: 'tool-views',
      adapter: 'ag-ui',
      appPath: 'cockpit/ag-ui/tool-views/react',
      base: '/ag-ui/tool-views/react/',
      port: 4611,
      project: 'cockpit-ag-ui-tool-views-react',
    });
  if (topic === 'ag-ui-interrupts')
    return Object.freeze({
      topic: 'interrupts',
      adapter: 'ag-ui',
      appPath: 'cockpit/ag-ui/interrupts/react',
      base: '/ag-ui/interrupts/react/',
      port: 4610,
      project: 'cockpit-ag-ui-interrupts-react',
    });
  if (topic === 'ag-ui-streaming')
    return Object.freeze({
      topic: 'streaming',
      adapter: 'ag-ui',
      appPath: 'cockpit/ag-ui/streaming/react',
      base: '/ag-ui/streaming/react/',
      port: 4609,
      project: 'cockpit-ag-ui-streaming-react',
    });
  if (
    ![
      'streaming',
      'interrupts',
      'memory',
      'client-tools',
      'persistence',
      'durable-execution',
      'subgraphs',
      'time-travel',
      'deployment-runtime',
    ].includes(topic)
  )
    throw new Error(`Unsupported React cockpit topic: ${topic}`);
  return Object.freeze({
    topic,
    appPath: `cockpit/langgraph/${topic}/react`,
    base: `/langgraph/${topic}/react/`,
    port: {
      streaming: 4600,
      interrupts: 4601,
      memory: 4602,
      'client-tools': 4603,
      persistence: 4604,
      'durable-execution': 4605,
      subgraphs: 4606,
      'time-travel': 4607,
      'deployment-runtime': 4608,
    }[topic],
    project: `cockpit-langgraph-${topic}-react`,
  });
}
