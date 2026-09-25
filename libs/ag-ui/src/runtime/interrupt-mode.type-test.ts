import { createSession } from './create-session';
import { createRun } from './create-run';
import type { InterruptMode } from './interrupt-mode';
import type { SessionSnapshot } from './session-observation';

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
declare const snapshot: SessionSnapshot;
if (snapshot.run?.legacyInterrupt) {
  const name: string = snapshot.run.legacyInterrupt.name;
  // @ts-expect-error selected notice evidence is readonly
  snapshot.run.legacyInterrupt.name = name;
}
