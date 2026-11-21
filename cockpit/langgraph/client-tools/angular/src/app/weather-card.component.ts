import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { ClientToolViewProps } from '@threadplane/angular/chat';
import { weatherCardSchema } from './schemas';

/**
 * A frontend-owned view rendered for the `weather_card` tool call. Receives
 * the tool call's arguments while it streams (`location`), the merged result
 * on completion (`temperatureF`, `conditions`, `humidity`, `windMph`), and a
 * `status` of 'running' | 'complete'. Renders a loading affordance until the
 * result arrives.
 *
 * Input types are derived from {@link weatherCardSchema} via `ClientToolViewProps` so
 * that a schema change is a compile error here under `strict: true`.
 */

/** Props this component receives from the `weather_card` schema. */
type WeatherCardProps = ClientToolViewProps<typeof weatherCardSchema>;

@Component({
  selector: 'app-weather-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wc">
      <div class="wc__head">
        <span class="wc__loc">{{ location() ?? 'Weather' }}</span>
        @if (pending()) { <span class="wc__badge">Loading…</span> }
      </div>
      @if (!pending()) {
        <div class="wc__temp">{{ temperatureF() }}°F</div>
        <div class="wc__cond">{{ conditions() }}</div>
        <dl class="wc__meta">
          <div><dt>Humidity</dt><dd>{{ humidity() }}%</dd></div>
          <div><dt>Wind</dt><dd>{{ windMph() }} mph</dd></div>
        </dl>
      }
    </div>
  `,
  styles: [`
    .wc { border: 1px solid var(--ds-border, #e5e7eb); border-radius: 12px; padding: 16px; max-width: 320px; background: var(--ds-surface); color: var(--ds-text-primary); }
    .wc__head { display: flex; align-items: center; justify-content: space-between; }
    .wc__loc { font-weight: 600; }
    .wc__badge { font-size: 12px; color: var(--ds-text-muted); }
    .wc__temp { font-size: 32px; font-weight: 700; margin-top: 8px; }
    .wc__cond { color: var(--ds-text-secondary); }
    .wc__meta { display: flex; gap: 24px; margin: 12px 0 0; }
    .wc__meta dt { font-size: 11px; text-transform: uppercase; color: var(--ds-text-muted); }
    .wc__meta dd { margin: 0; font-weight: 600; }
  `],
})
export class WeatherCardComponent {
  // Schema-derived inputs — types anchored to WeatherCardProps so a schema
  // change is a compile error. Optional because the framework sends partial
  // props during streaming (args arrive before the tool result).
  readonly location    = input<WeatherCardProps['location']>();
  readonly temperatureF = input<WeatherCardProps['temperatureF']>();
  readonly conditions  = input<WeatherCardProps['conditions']>();
  readonly humidity    = input<WeatherCardProps['humidity']>();
  readonly windMph     = input<WeatherCardProps['windMph']>();
  /** Extra input not in the schema: injected by the framework for rendering state. */
  readonly status = input<WeatherCardProps['status']>();
  readonly clientTool = input<WeatherCardProps['clientTool']>();

  readonly pending = computed(() => this.clientTool()?.phase !== 'complete' || this.temperatureF() === undefined);
}
