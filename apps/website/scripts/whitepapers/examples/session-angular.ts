import { Component, inject, InjectionToken } from '@angular/core';
import { observeAgent } from '@threadplane/angular';
import type { AgentSession } from '@threadplane/core';

// Source-build profile. The application provides an existing owner.
export const SESSION = new InjectionToken<AgentSession>('session');

@Component({
  selector: 'app-agent-status',
  standalone: true,
  template: `<p>Run status: {{ snapshot().status }}</p>`,
})
export class AgentStatus {
  readonly session = inject(SESSION);
  readonly snapshot = observeAgent(this.session);
  // Destroying this view releases its subscription, not the session.
}
