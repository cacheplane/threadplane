import type { RuntimeContext } from '@dawn-ai/sdk';
import type { z } from 'zod';

import { dispatchLifecycleJobs } from '../../dispatcher.js';
import { loadLifecycleRuntimeConfiguration } from '../../campaign/send.js';
import state from './state.js';

type DispatchState = z.infer<typeof state>;

function configuredBatchSize(): number {
  const raw = process.env['LIFECYCLE_BATCH_SIZE'];
  if (!raw) return 20;
  const value = Number(raw);
  if (!Number.isInteger(value))
    throw new Error('LIFECYCLE_BATCH_SIZE is invalid');
  return value;
}

export async function workflow(
  current: DispatchState,
  context: RuntimeContext
): Promise<DispatchState> {
  const configuration = loadLifecycleRuntimeConfiguration(process.env);
  const result = await dispatchLifecycleJobs({
    batchSize: configuredBatchSize(),
    campaignEnabled: configuration.campaignEnabled,
    campaignEnrollmentEnabled: configuration.campaignEnrollmentEnabled,
    installRuntimeHelloEnabled: configuration.installRuntimeHelloEnabled,
    installDigestEnabled: configuration.installDigestEnabled,
    observationProcessingEnabled: configuration.observationProcessingEnabled,
    campaignEnrollmentStartAt: configuration.campaignEnrollmentStartAt,
    signal: context.signal,
  });
  return { ...current, result };
}
