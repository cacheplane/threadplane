/** Closed authored frontend selection; callers cannot supply filesystem paths. */
export function reactCockpitConfiguration(topic = 'streaming') {
  if (
    ![
      'streaming',
      'interrupts',
      'memory',
      'client-tools',
      'persistence',
      'durable-execution',
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
    }[topic],
    project: `cockpit-langgraph-${topic}-react`,
  });
}
