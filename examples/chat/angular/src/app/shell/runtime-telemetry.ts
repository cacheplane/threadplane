import type {
  LangGraphTelemetryEvent,
  LangGraphTelemetrySink,
} from '@threadplane/langgraph';

const CANONICAL_DEMO_SURFACE = 'canonical_demo';
const BLOCKED_PROPERTY_KEYS = new Set([
  'messages',
  'threadId',
  'assistantId',
  'apiUrl',
]);

export interface BrowserTelemetryCapture {
  capture(event: LangGraphTelemetryEvent, properties?: Record<string, unknown>): Promise<void>;
}

export function createCanonicalDemoRuntimeTelemetrySink(
  telemetry: BrowserTelemetryCapture,
  readModel: () => string,
): LangGraphTelemetrySink {
  return ({ event, properties }) => {
    const safeProperties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties ?? {})) {
      if (!BLOCKED_PROPERTY_KEYS.has(key)) safeProperties[key] = value;
    }
    return telemetry.capture(event, {
      ...safeProperties,
      surface: CANONICAL_DEMO_SURFACE,
      model: readModel(),
    });
  };
}

/**
 * The agent outlives its sessions: every thread switch builds a new session,
 * and each one reports `tplane:runtime_instance_created`. The demo has one
 * runtime instance, the agent, so only the first report is forwarded.
 */
export function oncePerAgent(sink: LangGraphTelemetrySink): LangGraphTelemetrySink {
  let created = false;
  return (payload) => {
    if (payload.event === 'tplane:runtime_instance_created') {
      if (created) return undefined;
      created = true;
    }
    return sink(payload);
  };
}
