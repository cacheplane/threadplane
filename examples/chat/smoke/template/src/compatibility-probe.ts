import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
} from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { createSession as createAgUiSession } from '@threadplane/ag-ui';
import { injectAgent, provideAgent } from '@threadplane/angular';
import { provideFakeAgent } from '@threadplane/angular/testing';
import { ChatComponent } from '@threadplane/chat';
import { type as stateType } from '@threadplane/core';
import { createSession as createLangGraphSession } from '@threadplane/langgraph';
import { RenderSpecComponent } from '@threadplane/render';
import { provideThreadplaneTelemetry } from '@threadplane/telemetry/browser';

const PACKAGE_REFS = [
  ['ag-ui', createAgUiSession],
  ['chat', ChatComponent],
  ['core', stateType],
  ['langgraph', createLangGraphSession],
  ['render', RenderSpecComponent],
  ['telemetry', provideThreadplaneTelemetry],
] as const;

@Component({
  selector: 'threadplane-compatibility-probe',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<aside aria-label="Threadplane compatibility probes">
    <span data-threadplane-compatibility="ag-ui">{{
      packageReady('ag-ui') ? 'AG-UI ready' : 'AG-UI unavailable'
    }}</span>
    <span data-threadplane-compatibility="angular">{{
      angularReady ? 'angular ready' : 'angular unavailable'
    }}</span>
    <span data-threadplane-compatibility="chat">{{
      packageReady('chat') ? 'chat ready' : 'chat unavailable'
    }}</span>
    <span data-threadplane-compatibility="core">{{
      packageReady('core') ? 'core ready' : 'core unavailable'
    }}</span>
    <span data-threadplane-compatibility="langgraph">{{
      packageReady('langgraph') ? 'langgraph ready' : 'langgraph unavailable'
    }}</span>
    <span data-threadplane-compatibility="render">{{
      packageReady('render') ? 'render ready' : 'render unavailable'
    }}</span>
    <span data-threadplane-compatibility="telemetry">{{
      packageReady('telemetry') ? 'telemetry ready' : 'telemetry unavailable'
    }}</span>
  </aside>`,
  styles: [
    `
      :host {
        display: block;
        font: 10px/1.2 monospace;
        padding: 2px 4px;
      }
      span + span {
        margin-left: 4px;
      }
    `,
  ],
})
class CompatibilityProbeComponent {
  /**
   * The Angular binding is ready when its provider builds an agent this
   * component can inject and read: here over the in-memory fake session, so
   * the probe needs no backend.
   */
  private readonly agent = injectAgent();
  protected readonly angularReady =
    typeof provideAgent === 'function' &&
    Array.isArray(this.agent.messages()) &&
    this.agent.status() === 'idle';
  private readonly packageRefs = Object.fromEntries(PACKAGE_REFS) as Record<
    string,
    unknown
  >;

  protected packageReady(name: string) {
    return Boolean(this.packageRefs[name]);
  }
}

export function bootstrapCompatibilityProbe() {
  const host = document.createElement('threadplane-compatibility-probe');
  document.body.append(host);

  return bootstrapApplication(CompatibilityProbeComponent, {
    providers: [
      provideZonelessChangeDetection(),
      ...provideFakeAgent({ tokens: ['compatibility'] }),
    ],
  });
}
