import { describe, expect, it } from 'vitest';
import {
  AGENT_RECOVERY_DETAILS,
  AGENT_RECOVERY_MESSAGES,
  type AgentRecovery,
} from '@threadplane/chat';
import {
  RECOVERY_COPY,
  interruptionError,
} from '../../runtime/stream-projection';

// The neutral runtime cannot import @threadplane/chat, so it carries its own
// copy of the shared interruption vocabulary. This guard runs under the
// Angular test target, which can see both, and fails the moment they drift.
describe('runtime interruption copy parity with @threadplane/chat', () => {
  it('matches the shared recovery tables entry for entry', () => {
    expect(RECOVERY_COPY.messages).toEqual(AGENT_RECOVERY_MESSAGES);
    expect(RECOVERY_COPY.details).toEqual(AGENT_RECOVERY_DETAILS);
  });

  it.each([
    ['check', true],
    ['none', false],
  ] as const)(
    'builds the %s interruption from the shared copy',
    (recovery, canCheck) => {
      const value: AgentRecovery = recovery;
      expect(interruptionError(canCheck)).toEqual({
        kind: 'interrupted',
        retryable: false,
        recovery: value,
        message: AGENT_RECOVERY_MESSAGES[value],
        detail: AGENT_RECOVERY_DETAILS[value],
      });
    }
  );
});
