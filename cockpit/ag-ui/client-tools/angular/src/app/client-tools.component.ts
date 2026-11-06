import { Component } from '@angular/core';
import { ChatComponent, tools, action, view, ask } from '@threadplane/chat';
import { injectAgent } from '@threadplane/ag-ui';
import { ExampleChatLayoutComponent } from '@threadplane/example-layouts';
import { z } from 'zod/v4';
import { WeatherCardComponent } from './weather-card.component';
import { ConfirmBookingComponent } from './confirm-booking.component';
import { weatherCardSchema, confirmBookingSchema } from './schemas';

/**
 * Client-tools demo — tools declared in the browser that the model calls and
 * the browser executes. `get_weather` is an async FUNCTION (its return becomes
 * the result); `weather_card` is a VIEW (the model fills its props, rendered
 * inline, auto-acknowledged); `confirm_booking` is an ASK (an interactive
 * component whose emitted value becomes the result). The catalog is shipped to
 * the model via the AG-UI adapter; the backend graph binds the client stubs
 * (no server implementation) and ends the turn so the browser executes them.
 *
 * Under `strict: true` the typed `view`/`ask` overloads verify at compile time
 * that every field the schema produces is a declared `input()` on the paired
 * component. Mismatches become errors here, not silent runtime failures.
 */
// #region tool-registry
const clientTools = tools({
  get_weather: action(
    'Look up the current weather for a location.',
    z.object({ location: z.string() }),
    async ({ location }) => ({ location, temperatureF: 68, conditions: 'Sunny', humidity: 55, windMph: 8 }),
  ),
  slow_status_check: action(
    'Run a cancellable local status check. Use when the user asks to test stopping a slow browser tool.',
    z.object({ label: z.string().default('status check') }),
    async ({ label }, { signal }) => {
      await waitForAbortableDelay(3000, signal);
      return { label, status: 'complete' };
    },
  ),
  weather_card: view(
    'Display a weather card for a location with the given readings.',
    weatherCardSchema,
    WeatherCardComponent,
  ),
  weather_snapshot: view(
    'Display a weather card as a terminal snapshot without asking the assistant to summarize afterwards.',
    weatherCardSchema,
    WeatherCardComponent,
    { followUp: false },
  ),
  confirm_booking: ask(
    'Ask the user to confirm a booking before finalizing it.',
    confirmBookingSchema,
    ConfirmBookingComponent,
  ),
});
// #endregion

// #region abortable-delay
function waitForAbortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timeout = window.setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timeout);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}
// #endregion

// #region chat-wiring
@Component({
  selector: 'app-client-tools',
  standalone: true,
  imports: [ChatComponent, ExampleChatLayoutComponent],
  template: `
    <example-chat-layout
      title="AG-UI client tools"
      description="Five browser tools demonstrate simulated weather, a cancellable status check and an explicit fictional booking decision."
    >
      <chat placeholder="Try an example prompt…" [welcomeDisabled]="true" main [agent]="agent" [clientTools]="clientTools" class="flex-1 min-w-0">
        <p chatFooterStatus role="status" class="example-submission-status">{{ agent.isLoading() ? 'Receiving response…' : agent.error() ? 'Response failed. Try again.' : 'Ready.' }}</p>
      </chat>
    </example-chat-layout>
  `,
})
export class ClientToolsComponent {
  protected readonly agent = injectAgent();
  protected readonly clientTools = clientTools;
}
// #endregion
