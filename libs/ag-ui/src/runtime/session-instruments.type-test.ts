import type { AGUIEvent } from '@ag-ui/client';
import { createSession } from './create-session';
import type {
  SessionDevtools,
  SessionTelemetrySink,
} from './session-instruments';

const sink: SessionTelemetrySink = async ({ event, properties }) => {
  const transport: 'ag-ui' = properties.transport;
  const requestType:
    | 'submit'
    | 'resume'
    | 'retry'
    | 'regenerate'
    | 'client-tool-continuation'
    | undefined = properties.requestType;
  void [event, transport, requestType];
};
const devtools: SessionDevtools = {
  report: (cause: string, changed: readonly string[]) => void [cause, changed],
  takeScriptedRun: () => ({ events: [{ type: 'RUN_STARTED' }] }),
};
const session = createSession({
  url: 'https://agent.invalid',
  a2uiClientCapabilities: {
    supportedCatalogIds: ['basic'],
    inlineCatalogs: [{}],
  },
  telemetry: sink,
  reportOperationFailure: (code: 'unauthorized' | 'network_blocked') =>
    void code,
  devtools,
});
createSession({ url: 'https://agent.invalid', telemetry: false });
const release: (() => void) | undefined = session.onRawEvent?.(
  (event: AGUIEvent) => void event.type
);
void release;
createSession({
  url: 'u',
  // @ts-expect-error capabilities list catalog identifiers
  a2uiClientCapabilities: { supportedCatalogIds: 'basic' },
});
// @ts-expect-error a sink is a function, or false to turn reporting off
createSession({ url: 'u', telemetry: true });
createSession({
  url: 'u',
  // @ts-expect-error a reporter is told a code, not an error
  reportOperationFailure: (error: Error) => void error,
});
createSession({
  url: 'u',
  // @ts-expect-error a scripted run has events
  devtools: { takeScriptedRun: () => ({ frames: [] }) },
});
