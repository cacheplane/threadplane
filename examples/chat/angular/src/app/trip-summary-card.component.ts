import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { ViewProps } from '@threadplane/angular/chat';
import { z } from 'zod/v4';

/**
 * Schema for the `show_trip_summary` view tool — co-located with the component
 * so the inputs and the schema shape can be kept in sync at a glance.
 * `client-tools.ts` imports this schema to pass to
 * `view(…, TRIP_SUMMARY_SCHEMA, …, { followUp: false })`.
 */
export const TRIP_SUMMARY_SCHEMA = z.object({
  title: z.string(),
  days: z.array(
    z.object({
      day: z.number().int().min(1),
      places: z.array(z.string()),
    }),
  ),
  note: z.string().optional(),
});

/** Input types derived directly from the `show_trip_summary` schema —
 *  guarantees this component stays compatible with the view() check at
 *  compile time. */
type Inputs = ViewProps<typeof TRIP_SUMMARY_SCHEMA>;

/**
 * A frontend-owned view rendered for the `show_trip_summary` client tool.
 *
 * This is the demo's TERMINAL client tool: it is declared with
 * `followUp: false`, so mounting this card acknowledges the tool call and the
 * turn ENDS — there is no follow-up model turn. The tool result is still
 * written back to the durable thread (the LangGraph adapter flushes the
 * buffered `ToolMessage` even though no continuation run is started), which is
 * what keeps the next user message from hitting a provider 400 over an
 * `AIMessage(tool_calls=[…])` with no matching `ToolMessage`.
 */
@Component({
  selector: 'app-trip-summary-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="tsc">
      <header class="tsc__head">
        <h3 class="tsc__title">{{ title() }}</h3>
        <p class="tsc__meta">{{ dayCount() }} days · {{ stopCount() }} stops</p>
      </header>
      <ol class="tsc__days">
        @for (d of days(); track d.day) {
          <li class="tsc__day">
            <span class="tsc__day-label">Day {{ d.day }}</span>
            <span class="tsc__day-places">{{ d.places.join(' → ') || 'No stops' }}</span>
          </li>
        } @empty {
          <li class="tsc__day tsc__day--empty">Nothing planned yet</li>
        }
      </ol>
      @if (note()) {
        <p class="tsc__note">{{ note() }}</p>
      }
      <p class="tsc__end">Trip summary — end of turn</p>
    </section>
  `,
  styles: [
    `
      .tsc {
        border: 1px solid var(--tplane-chat-separator, #e5e7eb);
        border-radius: var(--tplane-chat-radius-card, 12px);
        background: var(--tplane-chat-surface-alt, transparent);
        color: var(--tplane-chat-text, inherit);
        font-family: var(--tplane-chat-font-family, inherit);
        padding: 16px;
        max-width: 360px;
      }
      .tsc__head {
        margin-bottom: 12px;
      }
      .tsc__title {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
      }
      .tsc__meta {
        margin: 4px 0 0;
        font-size: var(--tplane-chat-font-size-sm, 0.8125rem);
        color: var(--tplane-chat-text-muted, inherit);
      }
      .tsc__days {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .tsc__day {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .tsc__day-label {
        font-size: var(--tplane-chat-font-size-sm, 0.8125rem);
        font-weight: 600;
        color: var(--tplane-chat-primary, inherit);
      }
      .tsc__day-places {
        opacity: 0.9;
      }
      .tsc__day--empty {
        opacity: 0.5;
      }
      .tsc__note {
        margin: 12px 0 0;
        opacity: 0.9;
      }
      .tsc__end {
        margin: 12px 0 0;
        padding-top: 8px;
        border-top: 1px solid var(--tplane-chat-separator, #e5e7eb);
        font-size: var(--tplane-chat-font-size-sm, 0.8125rem);
        color: var(--tplane-chat-text-muted, inherit);
      }
    `,
  ],
})
export class TripSummaryCardComponent {
  readonly title = input.required<Inputs['title']>();
  readonly days = input<Inputs['days']>([]);
  readonly note = input<Inputs['note']>(undefined);

  protected readonly dayCount = computed(() => this.days().length);
  protected readonly stopCount = computed(() =>
    this.days().reduce((n, d) => n + (d.places?.length ?? 0), 0),
  );
}
