import { createSession } from './create-session';
import { createRun } from './create-run';
import type { InterruptMode } from './interrupt-mode';
import type { Observation } from './session-observation';

const mode: InterruptMode = 'native';
createSession({ threadId: 't', url: 'unused', interruptMode: mode });
createSession({
  threadId: 't',
  url: 'unused',
  interruptMode: 'legacy-observation',
});
createRun({ url: 'unused', interruptMode: mode });
createRun({ url: 'unused', interruptMode: 'legacy-observation' });
// @ts-expect-error provider inference is not an interruption mode
createRun({ url: 'unused', interruptMode: 'mastra' });
// @ts-expect-error resume interpretation is not supported
createSession({ threadId: 't', url: 'unused', interruptMode: 'legacy-resume' });
declare const snapshot: Observation;
if (snapshot.run?.legacyInterrupt) {
  const name: string = snapshot.run.legacyInterrupt.name;
  // @ts-expect-error selected notice evidence is readonly
  snapshot.run.legacyInterrupt.name = name;
}

// Resume profiles are a session option with the legacy adapter's four values.
import type { InterruptTransport } from './interrupt-mode';
const profiles: InterruptTransport[] = [
  'auto',
  'protocol',
  'legacy-command',
  'mastra-command',
];
for (const interruptTransport of profiles)
  createSession({ threadId: 't', url: 'unused', interruptTransport });
// @ts-expect-error a provider name is not a resume profile
createSession({ threadId: 't', url: 'unused', interruptTransport: 'mastra' });
// @ts-expect-error a run observes; only a session answers
createRun({ url: 'unused', interruptTransport: 'auto' });
// A notice the session can answer publishes its value on the interrupt.
const [pending] = createSession({ threadId: 't', url: 'unused' }).getSnapshot()
  .interrupts ?? [];
const reason: string | undefined = pending?.reason;
void reason;
void pending?.value;
