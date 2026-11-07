import { Component, inject, signal } from '@angular/core';
import { observeAgent } from '@threadplane/angular';
import { SESSION } from './session-angular';

@Component({
  selector: 'app-agent-composer',
  standalone: true,
  template: `
    <form (submit)="send($event)">
      <label for="request">Investigation request</label>
      <input #field id="request" [value]="draft()"
        [disabled]="pending()" (input)="draft.set(field.value)" />
      <button [disabled]="pending() || needsReview() || snapshot().status === 'running'">
        Send
      </button>
      <p role="status">{{ notice() }}</p>
    </form>
  `,
})
export class AgentComposer {
  readonly session = inject(SESSION);
  readonly snapshot = observeAgent(this.session);
  readonly draft = signal('');
  readonly pending = signal(false);
  readonly notice = signal('');
  readonly needsReview = signal(false);

  async send(event: Event) {
    event.preventDefault();
    const text = this.draft().trim();
    if (!text || this.pending() || this.needsReview() || this.snapshot().status === 'running') return;
    this.pending.set(true);
    try {
      const outcome = await this.session.submit(text);
      if (outcome === 'success') this.draft.set('');
      this.needsReview.set(outcome !== 'success');
      this.notice.set(`Run outcome: ${outcome}`);
    } catch {
      this.needsReview.set(true);
      this.notice.set('Check the outcome before submitting again.');
    } finally {
      this.pending.set(false);
    }
  }
}
