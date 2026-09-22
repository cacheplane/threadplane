import { Component } from '@angular/core';
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
      <button (click)="submit('Send')">Send</button>
      <button (click)="submit('Tool')">Tool</button>
      <button (click)="submit('Error')">Error</button>
      <button (click)="submit('Hold')">Hold</button>
      <button (click)="stop()">Stop</button>
      <output aria-label="Status" data-testid="status">{{ snapshot().status }}</output>
      <output aria-label="Text" data-testid="text">{{ view().text }}</output>
      <output aria-label="Error" data-testid="error">{{ view().error }}</output>
      <output aria-label="Tool result" data-testid="tool">{{ view().tool }}</output>
      <output aria-label="Delivery" data-testid="delivery">{{ view().delivery }}</output>
      <output aria-label="Handler calls" data-testid="handler-calls">{{ handlerCalls() }}</output>
      <output aria-label="Submissions" data-testid="submissions">{{ submissions() }}</output>
    </main>
  `,
})
class App {
  readonly snapshot = observeAgent(session);
  readonly view = () => display(this.snapshot());
  readonly handlerCalls = () => handlerCalls;
  readonly submissions = () => submissions;
  readonly submit = submit;
  readonly stop = () => session.stop();
}

void bootstrapApplication(App).then((application) => attachOwner(session, () => application.destroy()));
