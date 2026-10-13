import { createSession } from '@threadplane/ag-ui';
import type { ClientToolCall } from '@threadplane/ag-ui';
import type { ToolContracts } from '@threadplane/core/tools';
import { createClientToolsController } from './tools';

/** Compile-only checks against the actual native generic declaration boundary. */
export function checkToolDeclarations() {
  const controller = createClientToolsController(() => undefined);
  const session = createSession({ threadId: 'compile-only', url: 'http://127.0.0.1:1', interruptMode: 'native' }, controller.tools);
  const calls = session.getSnapshot().clientTools.calls;
  const typed: readonly ClientToolCall<ToolContracts<typeof controller.tools>>[] = calls;
  for (const call of typed) {
    if (call.name === 'get_weather') {
      const location: string | undefined = call.args?.location;
      const temperature: number | undefined = call.result?.temperatureF;
      void location; void temperature;
      // @ts-expect-error Narrowed weather args do not acquire booking fields.
      void call.args?.summary;
      // @ts-expect-error Native observed business arguments are readonly.
      if (call.args) call.args.location = 'changed';
    }
    if (call.name === 'confirm_booking') {
      const summary: string | undefined = call.args?.summary;
      const confirmed: boolean | undefined = call.result?.confirmed;
      void summary; void confirmed;
      // @ts-expect-error Native result observations are readonly.
      if (call.result) call.result.confirmed = true;
    }
    if (call.name === 'weather_snapshot' || call.name === 'weather_card') {
      const displayed: true | undefined = call.result?.displayed; void displayed;
    }
    if (call.name === 'slow_status_check') {
      const status: 'complete' | undefined = call.result?.status; void status;
    }
    // @ts-expect-error Native local observations retain readonly identity.
    call.callId = 'changed';
  }
  // @ts-expect-error Observed native calls cannot be appended.
  calls.push({});
  // @ts-expect-error Heterogeneous handlers preserve their specific authored arguments.
  void controller.tools.get_weather.handler({ summary: 'wrong' }, { signal: new AbortController().signal });
  // @ts-expect-error Booking execution receives only the real signal, never fabricated IDs.
  void controller.tools.confirm_booking.handler({ summary: 'fictional' }, { signal: new AbortController().signal, callId: 'fake' });
}
