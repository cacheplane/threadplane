import { Resend } from 'resend';

// The website intentionally consumes the growth library through its internal boundary.
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  createDatabaseExecutor,
  processVerifiedResendWebhook,
  ResendWebhookPayloadError,
  type SqlExecutor,
} from '@threadplane-internal/growth';

import { readBoundedBody } from '../../_internal/read-bounded-body';

const MAX_WEBHOOK_BODY_BYTES = 65_536;
const MAX_SVIX_HEADER_LENGTH = 2_048;

interface VerifyWebhookInput {
  payload: string;
  headers: { id: string; timestamp: string; signature: string };
  webhookSecret: string;
}

interface ResendWebhookRouteDependencies {
  loadWebhookSecret: () => string;
  verify: (input: VerifyWebhookInput) => unknown;
  createDatabase: () => SqlExecutor;
  processVerifiedResendWebhook: typeof processVerifiedResendWebhook;
}

function response(status: number): Response {
  return new Response(
    status === 200 ? 'Accepted' : 'Unable to process request',
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
      },
    }
  );
}

function requiredHeader(request: Request, name: string): string | null {
  const value = request.headers.get(name)?.trim() ?? '';
  if (
    value.length === 0 ||
    value.length > MAX_SVIX_HEADER_LENGTH ||
    /[\r\n\0]/u.test(value)
  ) {
    return null;
  }
  return value;
}

function defaultDependencies(): ResendWebhookRouteDependencies {
  return {
    loadWebhookSecret: () => process.env['RESEND_WEBHOOK_SECRET'] ?? '',
    verify: (input) => new Resend().webhooks.verify(input),
    createDatabase: () => createDatabaseExecutor(),
    processVerifiedResendWebhook,
  };
}

export function createResendWebhookRoute(
  dependencies: ResendWebhookRouteDependencies = defaultDependencies()
): { POST: (request: Request) => Promise<Response> } {
  return {
    async POST(request: Request): Promise<Response> {
      let secret: string;
      try {
        secret = dependencies.loadWebhookSecret().trim();
      } catch {
        return response(503);
      }
      if (secret.length === 0 || secret.length > 2_048) return response(503);

      const id = requiredHeader(request, 'svix-id');
      const timestamp = requiredHeader(request, 'svix-timestamp');
      const signature = requiredHeader(request, 'svix-signature');
      if (!id || !timestamp || !signature) return response(400);

      const rawPayload = await readBoundedBody(request, MAX_WEBHOOK_BODY_BYTES);
      if (rawPayload === null) return response(413);

      let verifiedPayload: unknown;
      try {
        verifiedPayload = dependencies.verify({
          payload: rawPayload,
          headers: { id, timestamp, signature },
          webhookSecret: secret,
        });
      } catch {
        return response(400);
      }

      let database: SqlExecutor;
      try {
        database = dependencies.createDatabase();
      } catch {
        return response(503);
      }
      try {
        const result = await dependencies.processVerifiedResendWebhook(
          database,
          {
            providerEventId: id,
            payload: verifiedPayload,
          }
        );
        const status =
          !result.applied && result.reason === 'retryable_unmatched_job'
            ? 503
            : 200;
        console.info(
          JSON.stringify({
            route: 'webhooks/resend',
            status,
            applied: result.applied,
            reason: result.applied ? undefined : result.reason,
          })
        );
        return response(status);
      } catch (error) {
        const invalidPayload = error instanceof ResendWebhookPayloadError;
        const status = invalidPayload ? 400 : 503;
        console.info(
          JSON.stringify({
            route: 'webhooks/resend',
            status,
            reason: invalidPayload
              ? 'payload_rejected'
              : 'processing_unavailable',
          })
        );
        return response(status);
      } finally {
        await database.close?.();
      }
    },
  };
}

export const { POST } = createResendWebhookRoute();
