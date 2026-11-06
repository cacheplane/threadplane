import { Component } from '@angular/core';
import {
  ChatMessageListComponent,
  ChatInputComponent,
  ChatTypingIndicatorComponent,
  ChatMessageComponent,
  ChatStreamingMdComponent,
  MessageTemplateDirective,
  markdownDocument,
  messageContent,
} from '@threadplane/chat';
import { ExampleChatLayoutComponent } from '@threadplane/example-layouts';
import { injectAgent } from '@threadplane/langgraph';
import { MESSAGES_AGENT, type MessagesState } from './agent-ref';

/**
 * MessagesComponent demonstrates the chat message primitives from @threadplane/chat.
 *
 * Uses ChatMessageListComponent, ChatInputComponent, and ChatTypingIndicatorComponent
 * individually rather than the composed ChatComponent, giving full control
 * over layout and message rendering.
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
    ChatTypingIndicatorComponent,
    ChatMessageComponent,
    ChatStreamingMdComponent,
    MessageTemplateDirective,
    ExampleChatLayoutComponent,
  ],
  template: `
    <example-chat-layout sidebarWidth="18rem">
      <section main class="chat-demo">
        <header class="demo-header">
          <h1 class="demo-title">Chat Messages Primitives</h1>
        </header>
        <div class="message-scroll">
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
          <chat-typing-indicator [agent]="agent" />
          <chat-input [agent]="agent" />
          <!-- #endregion -->
        </div>
      </section>
      <div sidebar class="panel">
        <h3 class="cap">Primitives Used</h3>
        <ul class="info-list">
          <li>ChatMessageListComponent</li>
          <li>ChatInputComponent</li>
          <li>ChatTypingIndicatorComponent</li>
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

    .demo-header {
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--tplane-chat-separator);
      background: var(--tplane-chat-surface);
    }

    .demo-title {
      margin: 0;
      color: var(--tplane-chat-text);
      font-size: var(--tplane-chat-font-size-sm);
      font-weight: 700;
      line-height: var(--tplane-chat-line-height-tight);
    }

    .message-scroll {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      background: var(--tplane-chat-bg);
    }

    .input-strip {
      padding: 0.5rem 0;
      border-top: 1px solid var(--tplane-chat-separator);
      background: var(--tplane-chat-surface);
    }

    .panel {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 1rem;
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
  // Typed read: prove MessagesState flows through DI.
  protected readonly _typedState: MessagesState = this.agent.value();

  protected readonly messageContent = messageContent;
  protected readonly markdownDocument = markdownDocument;
  // #endregion
}
