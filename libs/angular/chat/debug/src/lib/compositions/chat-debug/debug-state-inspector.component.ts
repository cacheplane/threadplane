import {
  Component,
  input,
  ChangeDetectionStrategy,
} from '@angular/core';
import { JsonPipe } from '@angular/common';
import { CHAT_DEBUG_TOKENS } from './chat-debug-tokens';

@Component({
  selector: 'chat-debug-state-inspector',
  standalone: true,
  imports: [JsonPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    CHAT_DEBUG_TOKENS,
    `
    .debug-state-inspector {
      overflow: auto;
      max-height: 256px;
    }
    .debug-state-inspector__pre {
      font-size: var(--tplane-chat-font-size-xs);
      font-family: var(--tplane-chat-font-mono);
      color: var(--tplane-chat-text);
      white-space: pre-wrap;
      word-break: break-all;
      margin: 0;
    }
    `,
  ],
  template: `
    <div class="debug-state-inspector">
      <pre class="debug-state-inspector__pre">{{ state() | json }}</pre>
    </div>
  `,
})
export class DebugStateInspectorComponent {
  readonly state = input<Record<string, unknown>>({});
}
