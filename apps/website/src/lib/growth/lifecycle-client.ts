import 'server-only';

import { randomUUID } from 'node:crypto';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const LIFECYCLE_RESPONSE_MAX_BYTES = 64 * 1_024;
const INVALID_LIFECYCLE_STATE = 'Lifecycle dispatch returned invalid state';

export interface InvokeLifecycleInput {
  baseUrl: string;
  serviceSecret: string;
  timeoutMs?: number;
  trigger: 'cron' | 'nudge';
  submissionId?: string;
}

export interface InvokeLifecycleDependencies {
  fetch: typeof fetch;
  randomUUID: () => string;
}

export type LifecycleOperatorAlert =
  | 'mailbox_recovery_required'
  | 'marketing_dispatch_failed';

export interface InvokeLifecycleResult {
  operatorAlerts: LifecycleOperatorAlert[];
  threadId: string;
}

const defaultDependencies: InvokeLifecycleDependencies = {
  fetch,
  randomUUID,
};

function lifecycleBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Lifecycle base URL is invalid');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search ||
    url.hash
  ) {
    throw new Error('Lifecycle base URL must be an HTTPS origin');
  }
  return url.origin;
}

function timeout(value: number | undefined): number {
  const resolved = value ?? 15_000;
  if (!Number.isInteger(resolved) || resolved < 250 || resolved > 60_000) {
    throw new Error(
      'Lifecycle timeout must be between 250 and 60000 milliseconds'
    );
  }
  return resolved;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function parseLifecycleState(
  value: unknown,
  input: Pick<InvokeLifecycleInput, 'submissionId' | 'trigger'>
): LifecycleOperatorAlert[] {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['trigger', 'result'], ['submission_id']) ||
    value['trigger'] !== input.trigger ||
    !isRecord(value['result'])
  ) {
    throw new Error('Lifecycle dispatch returned invalid state');
  }
  if (
    input.submissionId
      ? value['submission_id'] !== input.submissionId
      : 'submission_id' in value
  ) {
    throw new Error('Lifecycle dispatch returned invalid state');
  }
  const result = value['result'];
  if (
    !exactKeys(result, [
      'dispatched',
      'leased',
      'operatorAlerts',
      'recoveryPaused',
    ]) ||
    !isCount(result['dispatched']) ||
    !isCount(result['leased']) ||
    typeof result['recoveryPaused'] !== 'boolean' ||
    !Array.isArray(result['operatorAlerts']) ||
    !result['operatorAlerts'].every(
      (alert) =>
        alert === 'mailbox_recovery_required' ||
        alert === 'marketing_dispatch_failed'
    )
  ) {
    throw new Error('Lifecycle dispatch returned invalid state');
  }
  const operatorAlerts = [
    ...new Set(result['operatorAlerts'] as LifecycleOperatorAlert[]),
  ];
  if (
    result['recoveryPaused'] !==
    operatorAlerts.includes('mailbox_recovery_required')
  ) {
    throw new Error('Lifecycle dispatch returned invalid state');
  }
  return operatorAlerts;
}

async function cancelResponseBody(response: Response): Promise<void> {
  if (response.body !== null && !response.body.locked) {
    await response.body.cancel().catch(() => undefined);
  }
}

async function readLifecycleState(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const normalizedLength = declaredLength.trim();
    const byteLength = Number(normalizedLength);
    if (
      !/^\d+$/u.test(normalizedLength) ||
      !Number.isSafeInteger(byteLength) ||
      byteLength > LIFECYCLE_RESPONSE_MAX_BYTES
    ) {
      await cancelResponseBody(response);
      throw new Error(INVALID_LIFECYCLE_STATE);
    }
  }

  if (response.body === null) {
    throw new Error(INVALID_LIFECYCLE_STATE);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const decoded: string[] = [];
  let bytesRead = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > LIFECYCLE_RESPONSE_MAX_BYTES) {
        throw new Error(INVALID_LIFECYCLE_STATE);
      }
      decoded.push(decoder.decode(value, { stream: true }));
    }
    decoded.push(decoder.decode());
    return JSON.parse(decoded.join('')) as unknown;
  } catch {
    await reader.cancel().catch(() => undefined);
    throw new Error(INVALID_LIFECYCLE_STATE);
  } finally {
    reader.releaseLock();
  }
}

export async function invokeLifecycle(
  input: InvokeLifecycleInput,
  dependencies: Partial<InvokeLifecycleDependencies> = {}
): Promise<InvokeLifecycleResult> {
  const resolved = { ...defaultDependencies, ...dependencies };
  const origin = lifecycleBaseUrl(input.baseUrl);
  if (!input.serviceSecret) {
    throw new Error('Lifecycle service secret is required');
  }
  if (input.submissionId && !UUID_V4.test(input.submissionId)) {
    throw new Error('Lifecycle submission ID must be a UUID v4');
  }
  const threadId = resolved.randomUUID();
  if (!UUID_V4.test(threadId)) {
    throw new Error('Lifecycle thread ID must be a UUID v4');
  }

  let response: Response;
  try {
    response = await resolved.fetch(`${origin}/threads/${threadId}/runs/wait`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.serviceSecret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        route: '/dispatch#workflow',
        input: {
          trigger: input.trigger,
          ...(input.submissionId ? { submission_id: input.submissionId } : {}),
        },
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(timeout(input.timeoutMs)),
    });
  } catch {
    throw new Error('Lifecycle dispatch request failed');
  }
  if (!response.ok) {
    await cancelResponseBody(response);
    throw new Error('Lifecycle dispatch was not accepted');
  }
  const state = await readLifecycleState(response);
  return {
    operatorAlerts: parseLifecycleState(state, input),
    threadId,
  };
}
