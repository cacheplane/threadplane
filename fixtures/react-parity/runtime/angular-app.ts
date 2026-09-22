import { Component, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { observeAgent } from '@threadplane/angular';
import { createFixtureSession } from './runtime-entry.js';
import {
  attachOwner,
  display,
  reviewInstructions,
  reviewResponse,
} from './scenarios';

let handlerCalls = 0;
let submissions = 0;
const session = createFixtureSession('/api', 'fixture-thread', () => {
  handlerCalls += 1;
});
const submit = (input: string) => {
  submissions += 1;
  return session.submit(input);
};

@Component({
  selector: 'app-root',
  standalone: true,
  template: `
    <main class="review-shell">
      <header>
        <p class="eyebrow">Installed package review · Angular</p>
        <h1>Session runtime</h1>
        <p>
          Observe the application-owned session through the native Angular
          binding.
        </p>
      </header>
      <section class="panel instructions" aria-label="Review instructions">
        <h2>Review sequence</h2>
        <p>{{ reviewInstructions }}</p>
      </section>
      <section class="panel" aria-label="Session controls">
        <h2>Session controls</h2>
        <div class="controls">
          <button [disabled]="!canLoad" (click)="load()">Load</button
          ><button (click)="submit('Send')">Send</button
          ><button (click)="submit('Tool')">Tool</button
          ><button (click)="submit('Error')">Error</button
          ><button (click)="submit('Hold')">Hold</button
          ><button (click)="submit('Pause')">Pause</button
          ><button
            [disabled]="
              snapshot().status === 'running' ||
              !snapshot().interrupts.length ||
              !!snapshot().reconnect
            "
            (click)="resume()"
          >
            Resume</button
          ><button (click)="submit('Drop')">Drop</button
          ><button [disabled]="!snapshot().reconnect" (click)="reconnect()">
            Reconnect</button
          ><button (click)="stop()">Stop</button>
        </div>
      </section>
      <div class="review-grid">
        <section class="panel" aria-label="Request state panel">
          <h2>Request state</h2>
          <div class="state-grid">
            <div class="field">
              <h3>Status</h3>
              <output aria-label="Status" data-testid="status">{{
                snapshot().status
              }}</output>
            </div>
            <div class="field">
              <h3>Delivery</h3>
              <output aria-label="Delivery" data-testid="delivery">{{
                view().delivery
              }}</output>
            </div>
            <div class="field">
              <h3>Loads finished</h3>
              <output
                aria-label="Loads finished"
                data-testid="loads-finished"
                >{{ loadsFinished() }}</output
              >
            </div>
            <div class="field">
              <h3>Submissions</h3>
              <output aria-label="Submissions" data-testid="submissions">{{
                submissions()
              }}</output>
            </div>
            <div class="field">
              <h3>Resumes finished</h3>
              <output
                aria-label="Resumes finished"
                data-testid="resumes-finished"
                >{{ resumesFinished() }}</output
              >
            </div>
            <div class="field">
              <h3>Resume outcome</h3>
              <output
                aria-label="Resume outcome"
                data-testid="resume-outcome"
                >{{ resumeOutcome() }}</output
              >
            </div>
            <div class="field">
              <h3>Reconnect run</h3>
              <output aria-label="Reconnect run" data-testid="reconnect-run">{{
                snapshot().reconnect?.runId ?? ''
              }}</output>
            </div>
            <div class="field">
              <h3>Reconnects finished</h3>
              <output
                aria-label="Reconnects finished"
                data-testid="reconnects-finished"
                >{{ reconnectsFinished() }}</output
              >
            </div>
            <div class="field">
              <h3>Reconnect outcome</h3>
              <output
                aria-label="Reconnect outcome"
                data-testid="reconnect-outcome"
                >{{ reconnectOutcome() }}</output
              >
            </div>
            <div class="field">
              <h3>Human messages</h3>
              <output
                aria-label="Human messages"
                data-testid="human-messages"
                >{{ view().humanMessages }}</output
              >
            </div>
            <div class="field">
              <h3>Handler calls</h3>
              <output aria-label="Handler calls" data-testid="handler-calls">{{
                handlerCalls()
              }}</output>
            </div>
            <div class="field">
              <h3>Load error</h3>
              <output aria-label="Load error" data-testid="load-error">{{
                loadError()
              }}</output>
            </div>
            <div class="field">
              <h3>Error</h3>
              <output aria-label="Error" data-testid="error">{{
                view().error
              }}</output>
            </div>
          </div>
        </section>
        <section class="panel" aria-label="Conversation panel">
          <h2>Conversation</h2>
          <div class="fields">
            <div class="field">
              <h3>Text</h3>
              <output aria-label="Text" data-testid="text">{{
                view().text
              }}</output>
            </div>
            <div class="field">
              <h3>Transcript</h3>
              <output aria-label="Transcript" data-testid="transcript">{{
                view().transcript
              }}</output>
            </div>
          </div>
        </section>
        <section class="panel" aria-label="Application values panel">
          <h2>Application values</h2>
          <div class="fields">
            <div class="field">
              <h3>Application values</h3>
              <output aria-label="Application values" data-testid="values">{{
                view().values
              }}</output>
            </div>
          </div>
        </section>
        <section class="panel" aria-label="Interrupts panel">
          <h2>Interrupts</h2>
          <div class="fields">
            <div class="field">
              <h3>Interrupts</h3>
              <output aria-label="Interrupts" data-testid="interrupts">{{
                view().interrupts
              }}</output>
            </div>
          </div>
        </section>
        <section class="panel" aria-label="Tools panel">
          <h2>Tools</h2>
          <div class="fields">
            <div class="field">
              <h3>Tool result</h3>
              <output aria-label="Tool result" data-testid="tool">{{
                view().tool
              }}</output>
            </div>
          </div>
        </section>
      </div>
    </main>
  `,
})
class App {
  readonly reviewInstructions = reviewInstructions;
  readonly canLoad = !!session.load;
  readonly loadsFinished = signal(0);
  readonly loadError = signal('');
  readonly resumesFinished = signal(0);
  readonly resumeOutcome = signal('');
  readonly reconnectsFinished = signal(0);
  readonly reconnectOutcome = signal('');
  async reconnect() {
    this.reconnectOutcome.set('');
    try {
      this.reconnectOutcome.set(await session.reconnect());
    } catch {
      this.reconnectOutcome.set('Reconnect unavailable');
    } finally {
      this.reconnectsFinished.update((count) => count + 1);
    }
  }
  async resume() {
    this.resumeOutcome.set('');
    try {
      this.resumeOutcome.set(
        await session.resume(reviewResponse(session.getSnapshot()))
      );
    } catch {
      this.resumeOutcome.set('Resume unavailable');
    } finally {
      this.resumesFinished.update((count) => count + 1);
    }
  }
  async load() {
    if (!session.load) return;
    this.loadError.set('');
    try {
      await session.load();
    } catch {
      this.loadError.set('History unavailable');
    } finally {
      this.loadsFinished.update((count) => count + 1);
    }
  }
  readonly snapshot = observeAgent(session);
  readonly view = () => display(this.snapshot());
  readonly handlerCalls = () => handlerCalls;
  readonly submissions = () => submissions;
  readonly submit = submit;
  readonly stop = () => session.stop();
}

void bootstrapApplication(App).then((application) =>
  attachOwner(session, () => application.destroy())
);
