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
  ChatToolResultTemplateDirective,
  type ToolActivityInfo,
} from '@threadplane/chat';
import { provideAgent, injectAgent } from '@threadplane/ag-ui';
import '@threadplane/chat/chat.css';
import './shell.css';
import {
  toolLabel,
  toolOutcome,
  savedNoteId,
  retryableReference,
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
  readonly savedNoteId = savedNoteId;
  /** The reference a failed read may retry; none while a run is active or once a later read supersedes it. */
  retryReference(activity: ToolActivityInfo): string | undefined {
    if (scenario !== 'partial-failure' || this.agent.isLoading())
      return undefined;
    const text = (value: unknown) =>
      value === undefined
        ? undefined
        : typeof value === 'string'
        ? value
        : JSON.stringify(value);
    return retryableReference(
      activity,
      this.agent.toolCalls().map((call) => ({
        id: call.id,
        name: call.name,
        argumentsText: text(call.args),
        resultText: text(call.result),
      }))
    );
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
    ChatToolResultTemplateDirective,
  ],
  template: `<header class="benchmark-header"><div><h1>Tool conversation benchmark · Angular</h1><p>Scripted agent · real local tools · {{ scenario }} · installed SDK</p></div><button (click)="reset()">New conversation</button></header>
  <main class="benchmark-chat"><chat [agent]="agent" [welcomeDisabled]="true" placeholder="Type a message..." [groupRelatedTools]="true" [toolLabel]="toolLabel" [toolOutcome]="toolOutcome" style="height:100%">
    <ng-template chatToolResultTemplate="read_reference" let-activity>
      @if (retryReference(activity); as reference) {
        <button type="button" class="benchmark-retry" (click)="retryRead()">Retry read of {{ reference }}</button>
      }
    </ng-template>
    <ng-template chatToolResultTemplate="save_note" let-activity>
      @if (savedNoteId(activity); as note) {
        <p class="benchmark-receipt">Saved note {{ note }} in the local benchmark store.</p>
      }
    </ng-template>
    <ng-template chatInterruptTemplate>
      @let generation = agent.interruptSession().generation;
      <section class="benchmark-decision" aria-label="Save approval">
        <h2>Approve saving the comparison note?</h2>
        <p>The note is saved only after your approval.</p>
        <div><button [disabled]="decisionPending()" (click)="decide(true, generation)">Approve save</button>
        <button [disabled]="decisionPending()" (click)="decide(false, generation)">Deny save</button></div>
      </section>
    </ng-template>
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
