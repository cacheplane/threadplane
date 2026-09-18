import { InjectionToken, inject } from '@angular/core';

export type CockpitAgUiRuntimeConnection = Readonly<{
  adapter: 'ag-ui';
  url: string;
}>;

export type CockpitLangGraphRuntimeConnection = Readonly<{
  adapter: 'langgraph';
  apiUrl: string;
  assistantId: string;
  clientOptions?: Readonly<{ defaultHeaders: Readonly<Record<string, string>> }>;
}>;

export type CockpitRuntimeConnection =
  | CockpitAgUiRuntimeConnection
  | CockpitLangGraphRuntimeConnection;

/**
 * The generation-scoped Agent connection resolved before Angular bootstrap.
 * Compatible examples consume this token from provider factories so app-root
 * and component-local DI scopes keep their existing ownership.
 */
export const COCKPIT_RUNTIME_CONNECTION =
  new InjectionToken<CockpitRuntimeConnection>('COCKPIT_RUNTIME_CONNECTION');

export function injectCockpitRuntimeConnection(): CockpitRuntimeConnection {
  return inject(COCKPIT_RUNTIME_CONNECTION);
}
