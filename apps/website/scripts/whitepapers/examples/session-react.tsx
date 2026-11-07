import { useAgent } from '@threadplane/react';
import type { AgentSession } from '@threadplane/core';

// Source-build profile. The application passes an existing owner.
export function AgentStatus({ session }: { session: AgentSession }) {
  const snapshot = useAgent(session);
  return <p>Run status: {snapshot.status}</p>;
  // Unmounting releases this subscription, not the session.
}
