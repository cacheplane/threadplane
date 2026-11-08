import '@angular/compiler';
import {
  Component,
  signal,
  inject,
  ElementRef,
  DestroyRef,
  Injector,
  afterNextRender,
} from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import {
  ChatComponent,
  ChatInterruptTemplateDirective,
  ChatActivityTemplateDirective,
  ChatToolActivityGroupComponent,
  toolActivityPhase,
  type ToolActivityInfo,
  type ToolCall,
  type Message,
} from '@threadplane/chat';
import { provideAgent, injectAgent } from '@threadplane/ag-ui';
import '@threadplane/chat/chat.css';
import './shell.css';
import {
  toolLabel,
  toolOutcome,
  recoverableReadError,
  saveDeclined,
} from './tool-outcome';
const scenario =
  new URLSearchParams(location.search).get('scenario') ?? 'references';
class Benchmark {
  agent = injectAgent();
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private disposed = false;
  constructor() {
    this.destroyRef.onDestroy(() => {
      this.disposed = true;
    });
  }
  readonly toolLabel = toolLabel;
  readonly toolOutcome = toolOutcome;
  readonly scenario = scenario;
  readonly authoredActivity = [
    'partial-failure',
    'long-mixed',
    'native-approval',
  ].includes(scenario);
  activities(calls: ToolCall[], message: Message): ToolActivityInfo[] {
    return calls.map((call) => {
      const errorText = recoverableReadError(call.result);
      const activity: ToolActivityInfo = {
        id: call.id,
        name: call.name,
        label:
          call.name === 'save_note' && saveDeclined(call.result)
            ? 'Save declined'
            : toolLabel(call.name),
        phase: errorText
          ? 'error'
          : toolActivityPhase(call.status, message.delivery),
        argumentsText:
          typeof call.args === 'string' ? call.args : JSON.stringify(call.args),
        resultText:
          call.status === 'complete'
            ? typeof call.result === 'string'
              ? call.result
              : JSON.stringify(call.result)
            : undefined,
        errorText,
      };
      return { ...activity, outcome: toolOutcome(activity) };
    });
  }
  readonly decisionPending = signal(false);
  readonly decisionError = signal('');
  async decide(approved: boolean, generation: number) {
    if (this.decisionPending()) return;
    const root = this.element.nativeElement;
    const document = root.ownerDocument;
    const approval = document.activeElement?.closest('.benchmark-decision');
    let ownedFocus = !!approval && root.contains(approval);
    const onFocus = (event: FocusEvent) => {
      if (!approval?.contains(event.target as Node)) ownedFocus = false;
    };
    document.addEventListener('focusin', onFocus);
    const cleanup = () => document.removeEventListener('focusin', onFocus);
    const unregister = this.destroyRef.onDestroy(cleanup);
    let settled = false;
    this.decisionPending.set(true);
    this.decisionError.set('');
    try {
      await this.agent.submit(
        { resume: approved },
        { interruptGeneration: generation }
      );
      settled = true;
    } catch (error) {
      this.decisionError.set(String(error));
    } finally {
      this.decisionPending.set(false);
      if (!settled) {
        cleanup();
        unregister();
      } else
        afterNextRender(
          () => {
            cleanup();
            unregister();
            if (
              ownedFocus &&
              !this.disposed &&
              root.isConnected &&
              !this.agent.interrupt?.() &&
              this.agent.interruptSession().generation === generation &&
              document.activeElement === document.body
            ) {
              root.querySelector<HTMLTextAreaElement>('textarea')?.focus();
            }
          },
          { injector: this.injector }
        );
    }
  }
  retryRead() {
    void this.agent.submit({ message: 'Retry the failed read explicitly.' });
  }
  async reset() {
    this.disposed = true;
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
  imports: [
    ChatComponent,
    ChatInterruptTemplateDirective,
    ChatActivityTemplateDirective,
    ChatToolActivityGroupComponent,
  ],
  template: `<header class="benchmark-header"><div><h1>Tool conversation benchmark · Angular</h1><p>Scripted agent · real local tools · {{ scenario }} · installed SDK</p></div><button (click)="reset()">New conversation</button></header>
  <main class="benchmark-chat"><chat [agent]="agent" [welcomeDisabled]="true" placeholder="Type a message..." [groupRelatedTools]="true" [toolLabel]="toolLabel" [toolOutcome]="toolOutcome" style="height:100%">
    @if (authoredActivity) {
      <ng-template chatActivityTemplate let-message let-calls="toolCalls">
        <chat-tool-activity-group [activities]="activities(calls, message)" />
      </ng-template>
    }
    <ng-template chatInterruptTemplate>
      @let generation = agent.interruptSession().generation;
      <section class="benchmark-decision" aria-label="Save approval">
        <h2>Approve saving the comparison note?</h2>
        <p>The note is saved only after your approval.</p>
        <div><button [disabled]="decisionPending()" (click)="decide(true, generation)">Approve save</button>
        <button [disabled]="decisionPending()" (click)="decide(false, generation)">Deny save</button></div>
      </section>
    </ng-template>
    @if (scenario === 'partial-failure' && agent.error()) {
      <div chatFooterStatus class="benchmark-recovery"><button (click)="retryRead()">Retry failed read</button><p>The successful read stays in this conversation.</p></div>
    }
    @if (decisionError()) { <p chatFooterStatus role="alert">{{ decisionError() }}</p> }
  </chat></main>`,
})(Benchmark);
bootstrapApplication(Benchmark, {
  providers: [
    provideAgent({
      url: `http://127.0.0.1:4809/ag-ui?participant=threadplane-angular&scenario=${scenario}`,
      telemetry: false,
    }),
  ],
});
