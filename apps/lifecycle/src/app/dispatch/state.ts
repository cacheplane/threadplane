import { z } from 'zod';

export default z
  .object({
    trigger: z.enum(['cron', 'nudge']),
    dogfood_fixture_marker: z
      .literal('threadplane-preview-dogfood-v1')
      .optional(),
    submission_id: z.uuid().optional(),
    result: z
      .object({
        leased: z.number().int().nonnegative(),
        dispatched: z.number().int().nonnegative(),
        recoveryPaused: z.boolean(),
        operatorAlerts: z.array(
          z.enum(['mailbox_recovery_required', 'observation_projection_failed'])
        ),
      })
      .strict()
      .optional(),
  })
  .strict();
