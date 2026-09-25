import type { Server } from 'node:http';

export interface ScriptedService {
  readonly baseUrl: string;
  readonly token: string;
  stats(): { method: string; path: string | undefined; closed: boolean }[];
  close(): Promise<void>;
}
export function startScriptedService(options?: {
  loadService?: () => Promise<{ createAgUiServer(): Server }>;
  startupTimeoutMs?: number;
}): Promise<ScriptedService>;
export function bounded<T>(
  promise: Promise<T>,
  label?: string,
  timeoutMs?: number
): Promise<T>;
export function waitUntil(
  predicate: () => boolean,
  label: string,
  timeoutMs?: number
): Promise<void>;
