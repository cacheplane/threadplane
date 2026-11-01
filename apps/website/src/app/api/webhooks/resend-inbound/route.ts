import { Resend } from 'resend';

// The website intentionally consumes the internal growth boundary.
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  admitInboxEvent,
  admitLinkedInReceipt,
  createDatabaseExecutor,
  createInboxRuntime,
  createResendForwardSender,
  downloadInboxRaw,
  forwardLinkedInReceipt,
  type InboxConfig,
  type LinkedInIngestConfig,
  type LinkedInProcessOutcome,
  loadInboxConfig,
  loadLinkedInIngestConfig,
  parseLinkedInNotification,
  processInboxReceipt,
  processLinkedInReceipt,
  type SqlExecutor,
} from '@threadplane-internal/growth';
import { readBoundedBody } from '../../_internal/read-bounded-body';

interface InboundDependencies {
  forwardReceipt?: (db: SqlExecutor, id: string) => Promise<string | null>;
  loadConfig: () => InboxConfig;
  loadSecret: () => string;
  verify: (input: {
    payload: string;
    headers: { id: string; timestamp: string; signature: string };
    webhookSecret: string;
  }) => unknown;
  createDatabase: () => SqlExecutor;
  admit: typeof admitInboxEvent;
  process: (
    db: SqlExecutor,
    id: string,
    config: Extract<InboxConfig, { enabled: true }>
  ) => Promise<string>;
  loadLinkedInConfig: () => LinkedInIngestConfig;
  admitLinkedIn: typeof admitLinkedInReceipt;
  processLinkedIn: (
    db: SqlExecutor,
    id: string,
    config: Extract<LinkedInIngestConfig, { enabled: true }>
  ) => Promise<LinkedInProcessOutcome>;
  forwardLinkedIn: (db: SqlExecutor, id: string) => Promise<string | null>;
}

const defaults = (): InboundDependencies => ({
  loadConfig: loadInboxConfig,
  loadSecret: () => process.env['RESEND_INBOUND_WEBHOOK_SECRET'] ?? '',
  verify: (input) => new Resend('re_verify_only').webhooks.verify(input),
  createDatabase: createDatabaseExecutor,
  admit: admitInboxEvent,
  process: (db, id, config) =>
    processInboxReceipt(db, id, config, createInboxRuntime()),
  forwardReceipt: (db, id) => createInboxRuntime().forwardReceipt(db, id),
  loadLinkedInConfig: () => loadLinkedInIngestConfig(),
  admitLinkedIn: admitLinkedInReceipt,
  processLinkedIn: (db, id, config) =>
    processLinkedInReceipt(db, id, config, {
      getReceived: createInboxRuntime().getReceived,
      parse: parseLinkedInNotification,
      now: () => new Date(),
    }),
  forwardLinkedIn: (db, id) => {
    const runtime = createInboxRuntime();
    return forwardLinkedInReceipt(db, id, {
      environment: runtime.environment,
      getReceived: runtime.getReceived,
      getRaw: downloadInboxRaw,
      send: createResendForwardSender(process.env['RESEND_API_KEY'] ?? ''),
    });
  },
});

/** Builds an isolated, signed receiving endpoint; acknowledgements require durable admission. */
export function createResendInboundRoute(
  deps: InboundDependencies = defaults()
): { POST: (request: Request) => Promise<Response> } {
  const response = (status: number) =>
    new Response(status === 200 ? 'Accepted' : 'Unable to process request', {
      status,
      headers: { 'Cache-Control': 'no-store' },
    });
  return {
    async POST(request) {
      let config: InboxConfig;
      let secret: string;
      let linkedInConfig: LinkedInIngestConfig;
      try {
        config = deps.loadConfig();
        linkedInConfig = deps.loadLinkedInConfig();
        secret = deps.loadSecret();
      } catch {
        return response(503);
      }
      if (!config.enabled || !secret || secret.length > 2048)
        return response(503);
      const header = (name: string) => {
        const value = request.headers.get(name);
        return value && value.length <= 2048 && !/[\r\n\0]/.test(value)
          ? value
          : null;
      };
      const id = header('svix-id'),
        timestamp = header('svix-timestamp'),
        signature = header('svix-signature');
      if (!id || !timestamp || !signature) return response(400);
      const payload = await readBoundedBody(request, 65536);
      if (payload === null) return response(413);
      let verified: unknown;
      try {
        verified = deps.verify({
          payload,
          headers: { id, timestamp, signature },
          webhookSecret: secret,
        });
      } catch {
        return response(400);
      }
      let db: SqlExecutor | undefined;
      try {
        db = deps.createDatabase();
        const emailId = await deps.admit(db, verified, config);
        if (emailId) {
          let failed = false;
          try {
            await deps.process(db, emailId, config);
          } catch {
            failed = true;
          }
          try {
            await deps.forwardReceipt?.(db, emailId);
          } catch {
            failed = true;
          }
          if (failed) return response(503);
        } else if (linkedInConfig.enabled) {
          const linkedInId = await deps.admitLinkedIn(
            db,
            verified,
            linkedInConfig
          );
          if (linkedInId) {
            let failed = false;
            try {
              await deps.processLinkedIn(db, linkedInId, linkedInConfig);
            } catch {
              failed = true;
            }
            try {
              await deps.forwardLinkedIn(db, linkedInId);
            } catch {
              failed = true;
            }
            if (failed) return response(503);
          }
        }
        return response(200);
      } catch {
        return response(503);
      } finally {
        await db?.close?.();
      }
    },
  };
}

/** POST /api/webhooks/resend-inbound. */
export const { POST } = createResendInboundRoute();
