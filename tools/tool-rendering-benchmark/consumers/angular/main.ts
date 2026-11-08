import '@angular/compiler';
import { Component } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { ChatComponent } from '@threadplane/chat';
import { provideAgent, injectAgent } from '@threadplane/ag-ui';
import '@threadplane/chat/chat.css';
import './shell.css';
const scenario =
  new URLSearchParams(location.search).get('scenario') ?? 'references';
class Benchmark {
  agent = injectAgent();
  toolLabel = (name: string) =>
    name === 'search_reference'
      ? 'Finding reference sources'
      : name === 'read_reference'
      ? 'Reading reference sources'
      : undefined;
  async reset() {
    this.agent.dispose();
    await fetch('http://127.0.0.1:4809/reset/threadplane-angular', {
      method: 'POST',
    });
    location.reload();
  }
}
Component({
  selector: 'benchmark-root',
  standalone: true,
  imports: [ChatComponent],
  template: `<header class="benchmark-header"><div><h1>Tool conversation benchmark · Angular</h1><p>Scripted agent · real local tools · installed SDK</p></div><button (click)="reset()">New conversation</button></header><main class="benchmark-chat"><chat [agent]="agent" [groupRelatedTools]="true" [toolLabel]="toolLabel" style="height:100%" /></main>`,
})(Benchmark);
bootstrapApplication(Benchmark, {
  providers: [
    provideAgent({
      url: `http://127.0.0.1:4809/ag-ui?participant=threadplane-angular&scenario=${scenario}`,
      telemetry: false,
    }),
  ],
});
