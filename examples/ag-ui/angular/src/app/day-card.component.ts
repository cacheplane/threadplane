import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { ViewProps } from '@threadplane/angular/chat';
import { z } from 'zod/v4';

/**
 * Schema for the `day_card` view tool — co-located with the component so the
 * inputs and the schema shape can be kept in sync at a glance.
 * `client-tools.ts` imports this schema to pass to `view(…, DAY_CARD_SCHEMA, …)`.
 */
export const DAY_CARD_SCHEMA = z.object({
  day: z.number().int().min(1),
  places: z.array(z.string()),
});

/** Input types derived directly from the `day_card` schema — guarantees this
 *  component stays compatible with the view() check at compile time. */
type Inputs = ViewProps<typeof DAY_CARD_SCHEMA>;

/**
 * A frontend-owned view rendered for the `day_card` client tool. The model
 * fills `day` and `places`; this card recaps one itinerary day after an edit.
 */
@Component({
  selector: 'app-day-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dc">
      <div class="dc__head">Day {{ day() }}</div>
      <ul class="dc__list">
        @for (p of places(); track p) {
          <li class="dc__item">{{ p }}</li>
        } @empty {
          <li class="dc__item dc__item--empty">No stops</li>
        }
      </ul>
    </div>
  `,
  styles: [
    `
      .dc {
        border: 1px solid var(--tplane-chat-separator, #e5e7eb);
        border-radius: 12px;
        padding: 16px;
        max-width: 280px;
      }
      .dc__head {
        font-weight: 600;
        margin-bottom: 8px;
      }
      .dc__list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .dc__item {
        opacity: 0.9;
      }
      .dc__item--empty {
        opacity: 0.5;
      }
    `,
  ],
})
export class DayCardComponent {
  readonly day = input.required<Inputs['day']>();
  readonly places = input<Inputs['places']>([]);
}
