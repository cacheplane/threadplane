/** Event names for agent runtime creation, requests, and stream lifecycle telemetry. */
export type AgentRuntimeTelemetryEvent =
  | 'tplane:runtime_instance_created'
  | 'tplane:runtime_request_created'
  | 'tplane:stream_started'
  | 'tplane:stream_ended'
  | 'tplane:stream_errored';

/** Transport and optional request, model, timing, and error details attached to runtime telemetry. */
export interface AgentRuntimeTelemetryProperties {
  transport: 'langgraph' | 'ag-ui' | 'custom' | string;
  surface?: string;
  requestType?: string;
  provider?: string;
  model?: string;
  durationMs?: number;
  errorClass?: string;
}

/** A runtime telemetry event paired with its properties. */
export interface AgentRuntimeTelemetryPayload {
  event: AgentRuntimeTelemetryEvent;
  properties: AgentRuntimeTelemetryProperties;
}

/** Receives runtime telemetry payloads synchronously or asynchronously. */
export type AgentRuntimeTelemetrySink = (payload: AgentRuntimeTelemetryPayload) => void | Promise<void>;
