/** Closed authored frontend selection; callers cannot supply filesystem paths. */
export function reactCockpitConfiguration(topic = 'streaming') {
  if (!['streaming', 'interrupts', 'memory', 'client-tools'].includes(topic))
    throw new Error(`Unsupported React cockpit topic: ${topic}`);
  return Object.freeze({
    topic,
    appPath: `cockpit/langgraph/${topic}/react`,
    base: `/langgraph/${topic}/react/`,
    port: { streaming: 4600, interrupts: 4601, memory: 4602, 'client-tools': 4603 }[topic],
    project: `cockpit-langgraph-${topic}-react`,
  });
}
