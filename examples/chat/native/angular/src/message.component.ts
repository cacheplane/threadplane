import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MarkdownComponent } from '@threadplane/angular/markdown';
import { ToolObservationComponent } from '@threadplane/angular/chat';
import type { MessageContent } from '../../shared/message-content';
import { TripSummaryComponent } from './trip-summary.component';

@Component({
  selector: 'native-message',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MarkdownComponent, ToolObservationComponent, TripSummaryComponent],
  template: `
    <article
      [class]="'message message-' + row().role"
      [attr.aria-label]="row().role + ' message'"
    >
      <h3 class="role-label">{{ row().role }}</h3>
      @if (row().role === 'tool') {
      <pre>{{ row().message.content }}</pre>
      } @else {
      <threadplane-markdown [snapshot]="row().markdown" />
      @if (row().role === 'assistant') { @for (card of row().tripSummaries;
      track card.callId) {
      <native-trip-summary [card]="card" />
      } } @for (call of row().toolCalls; track call.id) { @if
      (!hasSummary(call.id)) {
      <div class="tool-observation">
        <threadplane-tool-observation
          [name]="call.name"
          [argumentsText]="literal(call.args)"
          [resultText]="
            call.status === 'complete'
              ? literal(call.result)
              : call.status === 'error'
              ? call.error
              : undefined
          "
        />
        <p class="muted">Observed tool status: {{ call.status }}</p>
      </div>
      } } }
    </article>
  `,
})
export class MessageComponent {
  readonly row = input.required<MessageContent>();
  readonly hasSummary = (id: string) =>
    this.row().tripSummaries.some((card) => card.callId === id);
  readonly literal = (value: unknown) =>
    typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '';
}
