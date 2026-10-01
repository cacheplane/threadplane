/** Closed authored frontend selection; callers cannot supply filesystem paths. */
export function reactCockpitConfiguration(topic = 'streaming') {
  if (topic !== 'streaming' && topic !== 'interrupts')
    throw new Error(`Unsupported React cockpit topic: ${topic}`);
  return Object.freeze({
    topic,
    appPath: `cockpit/langgraph/${topic}/react`,
    base: `/langgraph/${topic}/react/`,
    port: topic === 'streaming' ? 4600 : 4601,
    project: `cockpit-langgraph-${topic}-react`,
  });
}
