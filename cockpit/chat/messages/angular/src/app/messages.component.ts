import { Component, computed, signal, viewChild } from '@angular/core';
import {
  ChatMessageListComponent,
  ChatInputComponent,
  ChatMessageComponent,
  ChatStreamingMdComponent,
  MessageTemplateDirective,
  markdownDocument,
  messageContent,
} from '@threadplane/chat';
import { ExampleChatLayoutComponent, ExampleTranscriptDirective } from '@threadplane/example-layouts';
import { injectAgent } from '@threadplane/langgraph';
import { MESSAGES_AGENT, type MessagesState } from './agent-ref';

/**
 * MessagesComponent demonstrates the chat message primitives from @threadplane/chat.
 *
 * Uses ChatMessageListComponent and ChatInputComponent individually rather
 * than the composed ChatComponent, with an application-owned response status,
 * layout, and message rendering.
 *
 * ChatMessageListComponent renders nothing on its own — it discovers
 * projected `<ng-template chatMessageTemplate="...">` blocks via
 * contentChildren and uses them per message type. The composed `<chat>`
 * component provides default templates internally; primitive consumers
 * must project them explicitly.
 */
@Component({
  selector: 'app-messages',
  standalone: true,
  imports: [
    ChatMessageListComponent,
    ChatInputComponent,
    ChatMessageComponent,
    ChatStreamingMdComponent,
    MessageTemplateDirective,
    ExampleChatLayoutComponent,
    ExampleTranscriptDirective,
  ],
  template: `
    <example-chat-layout sidebarWidth="18rem" title="Chat messages"
      description="Ask a question and watch the answer arrive. Continue after the response is saved.">
      <button headerActions type="button" [disabled]="agent.isLoading()" (click)="newConversation()">New conversation</button>
      <section main class="chat-demo">
        <div class="message-scroll" exampleTranscript>
          <!-- #region message-templates -->
          <chat-message-list [agent]="agent">
            <ng-template chatMessageTemplate="human" let-message>
              <chat-message [role]="'user'">{{ messageContent(message) }}</chat-message>
            </ng-template>
            <!-- #region assistant-template -->
            <ng-template chatMessageTemplate="ai" let-message let-i="index">
              <chat-message
                [role]="'assistant'"
                [streaming]="message.delivery.phase === 'streaming'"
                [current]="i === agent.messages().length - 1"
              >
                <chat-streaming-md
                  [document]="markdownDocument(messageContent(message), message.delivery)"
                />
              </chat-message>
            </ng-template>
            <!-- #endregion -->
            <ng-template chatMessageTemplate="tool" let-message><!-- hidden --></ng-template>
            <ng-template chatMessageTemplate="system" let-message>
              <chat-message [role]="'system'">{{ messageContent(message) }}</chat-message>
            </ng-template>
          </chat-message-list>
          <!-- #endregion -->
        </div>
        <div class="input-strip">
          <!-- #region input-strip -->
          <chat-input [agent]="agent" placeholder="Ask an aviation question…" (submitted)="hasSubmitted.set(true); wasStopped.set(false)" (stopped)="wasStopped.set(true)" />
          <p class="submission-status" role="status">{{ status() }}</p>
          <!-- #endregion -->
        </div>
      </section>
      <div sidebar class="panel">
        <h3 class="cap">Primitives used</h3>
        <ul class="info-list">
          <li>Message list</li>
          <li>Message input</li>
          <li>Response status</li>
        </ul>
      </div>
    </example-chat-layout>
  `,
  styles: [`
    .chat-demo {
      display: flex;
      flex: 1 1 auto;
      min-width: 0;
      min-height: 0;
      flex-direction: column;
      background: var(--tplane-chat-bg);
      color: var(--tplane-chat-text);
    }

    .message-scroll {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      background: var(--tplane-chat-bg);
    }

    .input-strip {
      flex: none;
      padding: 0.5rem 0;
      border-top: 1px solid var(--tplane-chat-separator);
      background: var(--tplane-chat-surface);
    }

    .submission-status {
      box-sizing: border-box;
      width: 100%;
      max-width: calc(48rem + 32px);
      margin: 8px auto 0;
      padding: 0 16px;
      font-size: 12px;
      line-height: 18px;
      color: var(--tplane-chat-text-muted);
    }

    .panel {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 0 1rem 1rem;
      background: var(--tplane-chat-bg);
      color: var(--tplane-chat-text);
    }

    .cap {
      margin: 0;
      color: var(--tplane-chat-text-muted);
      font-size: var(--tplane-chat-font-size-xs);
      font-weight: 700;
      letter-spacing: 0.12em;
      line-height: var(--tplane-chat-line-height-tight);
      text-transform: uppercase;
    }

    .info-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin: 0;
      padding: 0;
      color: var(--tplane-chat-text-muted);
      font-size: var(--tplane-chat-font-size-xs);
      line-height: var(--tplane-chat-line-height);
      list-style: none;
    }
  `],
})
export class MessagesComponent {
  // #region component-class
  protected readonly agent = injectAgent(MESSAGES_AGENT);
  protected readonly hasSubmitted = signal(false);
  protected readonly wasStopped = signal(false);
  private readonly composer = viewChild(ChatInputComponent);
  protected readonly status = computed(() => this.agent.isLoading()
    ? 'Receiving response…'
    : this.agent.error() ? 'Response failed. Try again.'
    : this.wasStopped() ? 'Stopped.'
    : this.hasSubmitted() ? 'Response complete.' : 'Ready.');
  protected newConversation(): void {
    if (this.agent.isLoading()) return;
    this.agent.switchThread(null);
    this.composer()?.clearDraft();
    this.hasSubmitted.set(false);
    this.wasStopped.set(false);
  }
  // Typed read: prove MessagesState flows through DI.
  protected readonly _typedState: MessagesState = this.agent.value();

  protected readonly messageContent = messageContent;
  protected readonly markdownDocument = markdownDocument;
  // #endregion
}
