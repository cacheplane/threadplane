import { Component, DestroyRef, effect, inject } from '@angular/core';
import {
  ChatComponent,
  ChatWelcomeSuggestionComponent,
} from '@threadplane/angular/chat';
import { injectAgent, withAgentOverrides } from '@threadplane/angular';
import { STREAMING_AGENT } from './agent-ref';
import { ExampleChatLayoutComponent } from '@threadplane/example-layouts';
import { COCKPIT_INSPECTION_PUBLISHER } from '@threadplane/cockpit-telemetry';
import { createInspectionRecorder } from '@threadplane/cockpit-runtime-bridge';

const WELCOME_SUGGESTIONS = [
  {
    label: 'Stream a long answer',
    value: 'Explain LangGraph checkpointing in 200 words.',
    description:
      'Watch tokens arrive incrementally — the simplest @threadplane/angular/chat integration.',
  },
  {
    label: 'How agents pick tools',
    value: 'Show me how an agent decides which tool to use.',
    description:
      'Explains tool-selection reasoning; good entry point for the tool-calls demo.',
  },
] as const;

/**
 * Streaming demo — simplest possible @threadplane/angular/chat integration.
 *
 * Injects the singleton agent (configured in app.config.ts) and passes it
 * to the prebuilt <chat> composition. The composition handles message
 * rendering, input, typing indicator, and error display internally.
 */
@Component({
  selector: 'app-streaming',
  standalone: true,
  imports: [
    ChatComponent,
    ChatWelcomeSuggestionComponent,
    ExampleChatLayoutComponent,
  ],
  template: `
    <example-chat-layout
      title="LangGraph streaming"
      description="Watch an answer arrive as the agent writes it."
    >
      <button
        headerActions
        type="button"
        [disabled]="agent.status() === 'running'"
        (click)="newConversation(conversation)"
      >
        New conversation
      </button>
      <chat
        placeholder="Ask about LangGraph…"
        #conversation
        [welcomeDisabled]="true"
        main
        [agent]="agent"
        class="flex-1 min-w-0"
      >
        <p chatFooterStatus role="status" class="example-submission-status">
          {{
            agent.status() === 'running'
              ? 'Receiving response…'
              : agent.error()
              ? 'Response failed. Try again.'
              : 'Ready.'
          }}
        </p>
        <div chatWelcomeSuggestions>
          @for (s of suggestions; track s.value) {
          <chat-welcome-suggestion
            [label]="s.label"
            [value]="s.value"
            [description]="s.description"
            (selected)="send($event)"
          />
          }
        </div>
      </chat>
    </example-chat-layout>
  `,
})
export class StreamingComponent {
  protected newConversation(conversation: ChatComponent): void {
    if (this.agent.status() === 'running') return;
    this.agent.switchThread(null);
    this.inspection.reset();
    conversation.clearDraft();
  }

  private readonly sourceAgent = injectAgent(STREAMING_AGENT);
  private readonly publisher = inject(COCKPIT_INSPECTION_PUBLISHER);
  private readonly inspection = createInspectionRecorder('angular', (frame) =>
    this.publisher?.(frame)
  );
  // Chat and welcome suggestions share the same actual submission boundary.
  protected readonly agent = withAgentOverrides(this.sourceAgent, {
    submit: async (input, options) => {
      const text = typeof input === 'string' ? input : input?.message ?? '';
      const id = this.inspection.startCall(text);
      try {
        const result = await this.sourceAgent.submit(input, options);
        this.inspection.settleCall(id, 'settled');
        return result;
      } catch (error) {
        this.inspection.settleCall(id, 'rejected');
        throw error;
      }
    },
  });

  constructor() {
    effect(() => {
      const sourceMessages = this.sourceAgent.messages();
      const latestTurnMessage = sourceMessages
        .filter(
          (message) => message.role === 'user' || message.role === 'assistant'
        )
        .at(-1);
      // A new user turn has no assistant outcome until its own response arrives.
      const delivery =
        latestTurnMessage?.role === 'assistant'
          ? latestTurnMessage.delivery
          : undefined;
      const messages = sourceMessages.map((message) => ({
        id: message.id,
        role: message.role,
        // `content` is the text of the message's text blocks, never the blocks.
        text: message.content,
      }));
      const busy = this.sourceAgent.status() === 'running';
      const graphState = this.sourceAgent.state();
      this.inspection.observe({
        messages,
        busy,
        state: {
          busy,
          // True once the thread has reported messages or graph state.
          hasValue:
            messages.length > 0 ||
            (graphState != null && Object.keys(graphState).length > 0),
          status: this.sourceAgent.status(),
          hasFailure: this.sourceAgent.error() != null,
          messageCount: messages.length,
          deliveryPhase: delivery?.phase ?? null,
          outcome: delivery?.phase === 'complete' ? delivery.outcome : null,
        },
      });
    });
    inject(DestroyRef).onDestroy(() => this.inspection.dispose());
  }
  // Typed read: the ref carries the LangGraph session type through DI, so a
  // field only that backend publishes is a signal here without a cast.
  protected readonly _retainedRun = this.sourceAgent.retainedRun;
  protected readonly suggestions = WELCOME_SUGGESTIONS;

  protected send(text: string): void {
    void this.agent.submit({ message: text });
  }
}
