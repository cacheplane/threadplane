import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { TripSummaryCard } from '../../shared/message-content';

@Component({
  selector: 'native-trip-summary',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="trip-summary" aria-label="Trip summary">
      <h4>{{ card().title }}</h4>
      <p class="trip-summary-counts">
        {{ card().dayCount }} {{ card().dayCount === 1 ? 'day' : 'days' }} ·
        {{ card().stopCount }} {{ card().stopCount === 1 ? 'stop' : 'stops' }}
      </p>
      @if (card().days.length === 0) {
      <p>No days supplied.</p>
      } @else {
      <ol class="trip-summary-days">
        @for (day of card().days; track $index) {
        <li class="trip-summary-day">
          <h5>{{ day.label }}</h5>
          @if (day.places.length === 0) {
          <p>No stops</p>
          } @else {
          <ul>
            @for (place of day.places; track $index) {
            <li class="trip-summary-place">{{ place }}</li>
            }
          </ul>
          }
        </li>
        }
      </ol>
      } @if (card().note !== undefined) {
      <p class="trip-summary-note">{{ card().note }}</p>
      }
    </section>
  `,
})
export class TripSummaryComponent {
  readonly card = input.required<TripSummaryCard>();
}
