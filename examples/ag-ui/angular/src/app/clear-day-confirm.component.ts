import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { injectRenderHost } from '@threadplane/angular/render';
import { ItineraryStore } from './itinerary-store';

/**
 * The interactive component for the `clear_day` client tool (an `ask`). The
 * model fills `day`; the user confirms or cancels. Because an ask emits the
 * tool result and the handler layer cannot intercept it, the mutation happens
 * HERE: Clear writes the shared `ItineraryStore` (so the panel updates live)
 * and then announces the outcome via `injectRenderHost().result(...)`, which
 * becomes the tool result that resumes the run. Cancel never touches the store.
 *
 * Once the ask resolves, the chat library writes the emitted value back onto the
 * local tool call, so this component re-renders with `cleared`/`removed` as
 * props (chat-tool-views spreads `{...args, ...result, status}` into it). When
 * `cleared()` is defined we render a FROZEN line with no buttons; the live
 * interactive card only shows while `cleared()` is still undefined.
 */
@Component({
  selector: 'app-clear-day-confirm',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (cleared() === undefined) {
      <div class="cdc">
        <p class="cdc__summary">Clear all {{ count() }} stops on day {{ day() }}?</p>
        <div class="cdc__actions">
          <button type="button" class="cdc__btn cdc__btn--primary" (click)="clear()">Clear</button>
          <button type="button" class="cdc__btn" (click)="cancel()">Cancel</button>
        </div>
      </div>
    } @else if (cleared() === true) {
      <div class="cdc cdc--resolved">
        <p class="cdc__summary">Day {{ day() }} cleared — {{ removed() }} removed ✓</p>
      </div>
    } @else {
      <div class="cdc cdc--resolved">
        <p class="cdc__summary">Kept day {{ day() }} — clear cancelled</p>
      </div>
    }
  `,
  styles: [
    `
      .cdc {
        border: 1px solid var(--tplane-chat-separator, #e5e7eb);
        border-radius: 12px;
        padding: 16px;
        max-width: 360px;
      }
      .cdc--resolved .cdc__summary {
        margin: 0;
        opacity: 0.85;
      }
      .cdc__summary {
        margin: 0 0 12px;
      }
      .cdc__actions {
        display: flex;
        gap: 8px;
      }
      .cdc__btn {
        padding: 6px 14px;
        border-radius: 8px;
        border: 1px solid var(--tplane-chat-separator, #e5e7eb);
        background: transparent;
        color: inherit;
        cursor: pointer;
      }
      .cdc__btn--primary {
        background: var(--tplane-chat-accent, #2563eb);
        color: #fff;
        border-color: transparent;
      }
    `,
  ],
})
export class ClearDayConfirmComponent {
  readonly day = input.required<number>();
  /** Spread back onto props after the ask resolves (undefined while interactive). */
  readonly cleared = input<boolean | undefined>(undefined);
  readonly removed = input<number | undefined>(undefined);
  private readonly store = inject(ItineraryStore);
  private readonly host = injectRenderHost();

  protected readonly count = computed(
    () => this.store.stops().filter((s) => s.day === this.day()).length,
  );

  protected clear(): void {
    const day = this.day();
    const removed = this.store.clearDay(day);
    this.host.result({ cleared: true, day, removed });
  }

  protected cancel(): void {
    this.host.result({ cleared: false, day: this.day() });
  }
}
