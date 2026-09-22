import { Component, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { observeAgent } from '@threadplane/angular';
import { createFixtureSession } from './runtime-entry.js';
import { attachOwner, display } from './scenarios';

let handlerCalls = 0;
let submissions = 0;
const session = createFixtureSession('/api', 'fixture-thread', () => { handlerCalls += 1; });
const submit = (input: string) => { submissions += 1; return session.submit(input); };

@Component({
  selector: 'app-root',
  standalone: true,
  template: `
    <main>
      <button [disabled]="!canLoad" (click)="load()">Load</button>
      <button (click)="submit('Send')">Send</button>
      <button (click)="submit('Tool')">Tool</button>
      <button (click)="submit('Error')">Error</button>
      <button (click)="submit('Hold')">Hold</button>
      <button (click)="submit('Pause')">Pause</button>
      <button (click)="stop()">Stop</button>
      <output aria-label="Status" data-testid="status">{{ snapshot().status }}</output>
      <output aria-label="Text" data-testid="text">{{ view().text }}</output>
      <output aria-label="Transcript" data-testid="transcript">{{ view().transcript }}</output>
      <output aria-label="Application values" data-testid="values">{{ view().values }}</output>
      <output aria-label="Interrupts" data-testid="interrupts">{{ view().interrupts }}</output>
      <output aria-label="Loads finished" data-testid="loads-finished">{{ loadsFinished() }}</output>
      <output aria-label="Load error" data-testid="load-error">{{ loadError() }}</output>
      <output aria-label="Error" data-testid="error">{{ view().error }}</output>
      <output aria-label="Tool result" data-testid="tool">{{ view().tool }}</output>
      <output aria-label="Delivery" data-testid="delivery">{{ view().delivery }}</output>
      <output aria-label="Handler calls" data-testid="handler-calls">{{ handlerCalls() }}</output>
      <output aria-label="Submissions" data-testid="submissions">{{ submissions() }}</output>
    </main>
  `,
})
class App {
  readonly canLoad = !!session.load;
  readonly loadsFinished = signal(0);
  readonly loadError = signal('');
  async load() {
    if (!session.load) return;
    this.loadError.set('');
    try { await session.load(); }
    catch { this.loadError.set('History unavailable'); }
    finally { this.loadsFinished.update((count) => count + 1); }
  }
  readonly snapshot = observeAgent(session);
  readonly view = () => display(this.snapshot());
  readonly handlerCalls = () => handlerCalls;
  readonly submissions = () => submissions;
  readonly submit = submit;
  readonly stop = () => session.stop();
}

void bootstrapApplication(App).then((application) => attachOwner(session, () => application.destroy()));
