import { timingSafeEqual } from 'node:crypto';

// The website intentionally consumes the internal growth boundary.
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  createDatabaseExecutor,
  createInboxRuntime,
  loadInboxConfig,
  recoverInbox,
} from '@threadplane-internal/growth';

interface RecoveryRouteDependencies {
  secret: () => string;
  recover: () => Promise<{ received: number; processed: number }>;
}

/** Builds a bearer-authenticated recovery endpoint suitable for Vercel Cron. */
export function createInboxRecoveryRoute(
  deps: RecoveryRouteDependencies = {
    secret: () => process.env['CRON_SECRET'] ?? '',
    recover: async () => {
      const config = loadInboxConfig();
      if (!config.enabled) throw new Error('Receiving is disabled');
      const runtime = createInboxRuntime();
      const db = createDatabaseExecutor();
      try {
        return await recoverInbox(db, config, runtime);
      } finally {
        await db.close?.();
      }
    },
  }
): { GET: (request: Request) => Promise<Response> } {
  return {
    async GET(request) {
      const secret = deps.secret();
      const expected = Buffer.from(`Bearer ${secret}`);
      const received = Buffer.from(request.headers.get('authorization') ?? '');
      if (
        secret.length < 32 ||
        received.length !== expected.length ||
        !timingSafeEqual(received, expected)
      )
        return new Response('Unauthorized', {
          status: 401,
          headers: { 'Cache-Control': 'no-store' },
        });
      try {
        return Response.json(await deps.recover(), {
          headers: { 'Cache-Control': 'no-store' },
        });
      } catch {
        return new Response('Recovery unavailable', {
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
        });
      }
    },
  };
}

/** Allow a bounded receiving recovery to finish on a supported Vercel plan. */
export const maxDuration = 300;

/** GET /api/cron/inbox-recovery. */
export const { GET } = createInboxRecoveryRoute();
