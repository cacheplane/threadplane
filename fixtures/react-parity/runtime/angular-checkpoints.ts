import { Component, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { observeAgent } from '@threadplane/angular';
import { createFixtureSession } from './runtime-entry.js';
import {
  checkpointInstructions,
  display,
  type FixtureCheckpoint,
} from './scenarios';

// Application ownership is independent of component creation and destruction.
let handlerCalls = 0;
const session = createFixtureSession('/api', 'checkpoint-thread', () => {
  handlerCalls++;
});

@Component({
  selector: 'app-root',
  template: `
    <main class="review-shell">
      <header>
        <p class="eyebrow">Installed package review · Angular</p>
        <h1>Checkpoint review</h1>
      </header>
      <section class="panel">
        <h2>Review sequence</h2>
        <p>{{ instructions }}</p>
      </section>
      <section class="panel">
        <h2>Application selection and session execution</h2>
        <p>
          The selected ID is local application state. The active execution
          position is retained privately by the session after a confirmed
          command; observed values below come from saved server state.
        </p>
        <div class="controls">
          <button [disabled]="busy()" (click)="load()">Load</button>
          @for (id of ['A', 'B', 'P']; track id) {
          <button [disabled]="busy() || !reference(id)" (click)="select(id)">
            Select {{ id }}
          </button>
          }
          <button [disabled]="busy() || !selected()" (click)="fork()">
            Fork selected
          </button>
          <button [disabled]="busy()" (click)="run('Continue branch')">
            Continue branch
          </button>
          <button [disabled]="busy()" (click)="run('Drop branch')">
            Drop branch
          </button>
          <button
            [disabled]="busy() || !snapshot().reconnect"
            (click)="reconnect()"
          >
            Reconnect branch
          </button>
          <button
            [disabled]="busy() || owner() === 'disposed'"
            (click)="dispose()"
          >
            Dispose
          </button>
        </div>
        <div class="fields">
          @for (field of fields(); track field[0]) {
          <div>
            <h3>{{ field[1] }}</h3>
            <output [attr.data-testid]="'checkpoint-' + field[0]">{{
              field[2]
            }}</output>
          </div>
          }
        </div>
      </section>
    </main>
  `,
})
export class CheckpointApp {
  readonly snapshot = observeAgent(session);
  readonly instructions = checkpointInstructions;
  readonly selected = signal<FixtureCheckpoint | undefined>(undefined);
  readonly outcome = signal('');
  readonly finished = signal(0);
  readonly owner = signal('active');
  readonly busy = signal(false);
  reference(id: string) {
    return this.snapshot().history?.find(
      (entry) => entry.checkpoint.checkpoint_id === id
    )?.checkpoint;
  }
  select(id: string) {
    this.selected.set(this.reference(id));
  }
  async command(action: () => Promise<string | void>) {
    this.busy.set(true);
    this.outcome.set('running');
    try {
      this.outcome.set((await action()) ?? 'loaded');
    } catch {
      this.outcome.set('rejected');
    } finally {
      this.finished.update((count) => count + 1);
      this.busy.set(false);
    }
  }
  load() {
    return this.command(() => session.load!());
  }
  fork() {
    return this.command(() => session.fork(this.selected()!, 'Fork A'));
  }
  run(input: string) {
    return this.command(() => session.submit(input));
  }
  reconnect() {
    return this.command(() => session.reconnect());
  }
  async dispose() {
    await session.dispose();
    this.owner.set('disposed');
  }
  fields() {
    const snapshot = this.snapshot();
    const view = display(snapshot);
    return [
      [
        'selected',
        'Selected checkpoint reference',
        this.selected()?.checkpoint_id ?? 'none',
      ],
      ['owner', 'Application owner', this.owner()],
      ['status', 'Session status', snapshot.status],
      ['outcome', 'Last command outcome', this.outcome()],
      ['finished', 'Completed commands', String(this.finished())],
      ['text', 'Observed transcript', view.transcript],
      ['values', 'Observed values', view.values],
      ['history', 'Last loaded history page', view.history],
      ['reconnect', 'Reconnect run', snapshot.reconnect?.runId ?? ''],
      ['handlers', 'Tool handler calls', String(handlerCalls)],
    ];
  }
}

void bootstrapApplication(CheckpointApp);
