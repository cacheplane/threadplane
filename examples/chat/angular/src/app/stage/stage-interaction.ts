import { withAgentOverrides, type AgentOverrides } from '@threadplane/angular';

/** The commands the presentation takes over; each opens the live demo instead. */
const COMMANDS = [
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
] as const;

/** Keep UI commands out of the recorded agent; the controller retains the original. */
export function stagePresentationAgent<T extends object>(agent: T, openLive: () => void): T {
  const goLive = async () => { openLive(); };
  return withAgentOverrides(
    agent,
    Object.fromEntries(COMMANDS.map((command) => [command, goLive])) as AgentOverrides<T>,
  );
}
