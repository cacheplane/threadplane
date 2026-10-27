import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { Message } from '@threadplane/core';

/** Readonly text rows with IDs unique within this list. Lifetime belongs to the caller. */
@Component({
  selector: 'threadplane-text-transcript',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section [attr.aria-label]="label()">
      <!-- Explicit role preserves list semantics when markers are hidden in WebKit. -->
      <ol role="list">
        @for (message of messages(); track message.id) {
        <li>
          <span>{{ speakers[message.role] }}</span>
          <p>{{ message.content }}</p>
        </li>
        }
      </ol>
    </section>
  `,
  styles: `
    :host { display: block; color: var(--ds-text-primary, #142435); font-family: inherit; }
    ol { margin: 0; padding: 0; list-style: none; }
    li { margin-block: 1rem; }
    span { font-weight: 600; }
    p { margin-block: .25rem; white-space: pre-wrap; overflow-wrap: anywhere; }
  `,
})
export class TextTranscriptComponent {
  readonly messages =
    input.required<readonly Pick<Message, 'id' | 'role' | 'content'>[]>();
  readonly label = input('Conversation');
  protected readonly speakers = {
    user: 'User',
    assistant: 'Assistant',
    system: 'System',
    tool: 'Tool',
  };
}
