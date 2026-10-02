/** Closed authored frontend selection; callers cannot supply filesystem paths. */
export function reactCockpitConfiguration(topic = 'streaming') {
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
