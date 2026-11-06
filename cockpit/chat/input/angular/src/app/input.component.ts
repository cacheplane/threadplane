import { Component, computed } from '@angular/core';
import {
  ChatInputComponent as ChatInputPrimitive,
  ChatMessageListComponent,
  ChatMessageComponent,
  ChatStreamingMdComponent,
  MessageTemplateDirective,
  markdownDocument,
  messageContent,
} from '@threadplane/chat';
import { ExampleChatLayoutComponent, ExampleTranscriptDirective } from '@threadplane/example-layouts';
import { injectAgent } from '@threadplane/langgraph';

/**
 * InputComponent showcases ChatInputComponent features including
 * keyboard handling, disabled state, and custom placeholder.
 * A sidebar displays the current input state.
 *
 * ChatMessageListComponent renders nothing on its own — it discovers
 * projected `<ng-template chatMessageTemplate="...">` blocks via
 * contentChildren. Templates are projected here so the conversation
 * surface actually displays user + assistant turns.
 */
@Component({
  selector: 'app-input',
  standalone: true,
  imports: [
    ChatInputPrimitive,
    ChatMessageListComponent,
    ChatMessageComponent,
    ChatStreamingMdComponent,
    MessageTemplateDirective,
    ExampleChatLayoutComponent,
    ExampleTranscriptDirective,
  ],
  template: `
    <example-chat-layout sidebarWidth="18rem"
      title="Chat input"
      description="Try the keyboard shortcuts and customize your composer. You can draft your next message while a response arrives."
    >
      <button headerActions type="button" [disabled]="agent.isLoading()"
        (click)="newConversation(composer)">New conversation</button>
      <section main class="chat-demo">
        <div class="message-scroll" exampleTranscript>
          <chat-message-list [agent]="agent">
            <ng-template chatMessageTemplate="human" let-message>
              <chat-message [role]="'user'">{{ messageContent(message) }}</chat-message>
            </ng-template>
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
            <ng-template chatMessageTemplate="tool" let-message><!-- hidden --></ng-template>
            <ng-template chatMessageTemplate="system" let-message>
              <chat-message [role]="'system'">{{ messageContent(message) }}</chat-message>
            </ng-template>
          </chat-message-list>
        </div>
        <!-- #region input-strip -->
        <div class="input-strip">
          <!-- chat-input submits to [agent] itself; (submitted) is a
               notification only — re-submitting it here would double the
               user message. -->
          <chat-input #composer [agent]="agent" placeholder="Ask an aviation question…"><p chatInputFooter class="composer-help">Enter to send. Shift+Enter adds a new line.</p></chat-input>
          <p role="status" class="example-submission-status">{{ agent.isLoading() ? 'Receiving response…' : agent.error() ? 'Response failed. Try again.' : 'Ready.' }}</p>
        </div>
        <!-- #endregion -->
      </section>
      <div sidebar class="panel">
        <h3 class="cap">Input State</h3>
        <!-- #region state-panel -->
        <dl class="metric-list">
          <dt class="metric-label">Stream Status</dt>
          <dd class="metric-value">{{ streamStatus() }}</dd>
          <dt class="metric-label">Is Loading</dt>
          <dd class="metric-value">{{ isLoading() }}</dd>
        </dl>
        <!-- #endregion -->
        <div>
          <h4 class="cap">Features</h4>
          <ul class="info-list">
            <li>Custom placeholder text</li>
            <li>Enter to send</li>
            <li>Shift+Enter for newline</li>
            <li>Auto-disable while streaming</li>
          </ul>
        </div>
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

    .composer-help { margin: 6px 16px 0; color: var(--tplane-chat-text-muted); font-size: 14px; line-height: 22.4px; }

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

    .info-list,
    .metric-list {
      margin: 0;
      padding: 0;
      color: var(--tplane-chat-text-muted);
      font-size: var(--tplane-chat-font-size-xs);
      line-height: var(--tplane-chat-line-height);
      list-style: none;
    }

    .info-list {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      margin-top: 0.5rem;
    }

    .metric-list {
      display: grid;
      gap: 0.25rem;
    }

    .metric-label {
      color: var(--tplane-chat-text-muted);
      font-weight: 700;
    }

    .metric-value {
      margin: 0 0 0.5rem;
      color: var(--tplane-chat-text);
      font-family: var(--tplane-chat-font-mono);
    }
  `],
})
export class InputComponent {
  protected newConversation(composer: ChatInputPrimitive): void {
    if (this.agent.isLoading()) return;
    this.agent.switchThread(null);
    composer.clearDraft();
  }

  // #region agent-state
  protected readonly agent = injectAgent();

  protected readonly streamStatus = computed(() => this.agent.status());
  protected readonly isLoading = computed(() => this.agent.isLoading());
  // #endregion
  protected readonly messageContent = messageContent;
  protected readonly markdownDocument = markdownDocument;
}
