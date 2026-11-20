/** Keep UI commands out of the recorded agent; the controller retains the original. */
export function stagePresentationAgent<T extends object>(agent: T, openLive: () => void): T {
  const commands = new Set([
    'submit',
    'stop',
    'resume',
    'regenerate',
    'retry',
    'runWithoutMessage',
    'checkStatus',
    'reconnect',
    'fork',
    'switchThread',
  ]);
  const goLive = async () => { openLive(); };
  return new Proxy(agent, {
    get(target, key, receiver) {
      return typeof key === 'string' && commands.has(key)
        ? goLive
        : Reflect.get(target, key, receiver);
    },
  });
}
