import { describe, expect, it, vi } from 'vitest';

// The website intentionally consumes the growth library through its internal boundary.
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  ResendWebhookPayloadError,
  type SqlExecutor,
} from '@threadplane-internal/growth';

import { createResendWebhookRoute } from './route';

const rawPayload = JSON.stringify({
  type: 'email.delivered',
  created_at: '2026-09-01T12:00:00.000Z',
  data: { email_id: 'resend-email-1' },
});

function request(
  body = rawPayload,
  headers: Record<string, string> = {}
): Request {
  return new Request('https://threadplane.ai/api/webhooks/resend', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'svix-id': 'msg_123',
      'svix-timestamp': '1788264000',
      'svix-signature': 'v1,signature',
      ...headers,
    },
    body,
  });
}

function harness() {
  const order: string[] = [];
  const verify = vi.fn((input: unknown) => {
    void input;
    order.push('verify');
    return JSON.parse(rawPayload) as unknown;
  });
  const database = {
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as SqlExecutor;
  const createDatabase = vi.fn(() => {
    order.push('database');
    return database;
  });
  const processVerifiedResendWebhook = vi.fn().mockImplementation(() => {
    order.push('process');
    return Promise.resolve({ applied: true });
  });
  const route = createResendWebhookRoute({
    loadWebhookSecret: () => 'whsec_test-secret',
    verify,
    createDatabase,
    processVerifiedResendWebhook,
  });
  return {
    ...route,
    order,
    verify,
    database,
    createDatabase,
    processVerifiedResendWebhook,
  };
}

describe('/api/webhooks/resend', () => {
  it('verifies the raw text and exact Svix headers before JSON/schema processing or DB creation', async () => {
    const test = harness();
    const body = rawPayload.replace('email.delivered', 'email.sent');
    test.verify.mockImplementationOnce(() => {
      test.order.push('verify');
      return {
        type: 'email.sent',
        data: { email_id: 'resend-email-1', message_id: '<actual@resend.dev>' },
      };
    });

    const response = await test.POST(request(body) as never);

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(test.verify).toHaveBeenCalledWith({
      payload: body,
      headers: {
        id: 'msg_123',
        timestamp: '1788264000',
        signature: 'v1,signature',
      },
      webhookSecret: 'whsec_test-secret',
    });
    expect(test.order).toEqual(['verify', 'database', 'process']);
    expect(test.processVerifiedResendWebhook).toHaveBeenCalledWith(
      test.database,
      {
        providerEventId: 'msg_123',
        payload: {
          type: 'email.sent',
          data: {
            email_id: 'resend-email-1',
            message_id: '<actual@resend.dev>',
          },
        },
      }
    );
    expect(test.database.close).toHaveBeenCalledTimes(1);
  });

  it.each(['svix-id', 'svix-timestamp', 'svix-signature'])(
    'rejects a missing %s before verification or database access',
    async (missing) => {
      const test = harness();
      const headers = {
        'svix-id': 'msg_123',
        'svix-timestamp': '1788264000',
        'svix-signature': 'v1,signature',
        [missing]: '',
      };
      const response = await test.POST(request(rawPayload, headers) as never);
      expect(response.status).toBe(400);
      expect(test.verify).not.toHaveBeenCalled();
      expect(test.createDatabase).not.toHaveBeenCalled();
    }
  );

  it('rejects a forged or stale signature without parsing or DB mutation', async () => {
    const test = harness();
    test.verify.mockImplementationOnce(() => {
      throw new Error('signature rejected');
    });
    const response = await test.POST(request() as never);
    expect(response.status).toBe(400);
    expect(test.createDatabase).not.toHaveBeenCalled();
    expect(test.processVerifiedResendWebhook).not.toHaveBeenCalled();
  });

  it('fails closed when the webhook secret is missing', async () => {
    const test = harness();
    const route = createResendWebhookRoute({
      loadWebhookSecret: () => '',
      verify: test.verify,
      createDatabase: test.createDatabase,
      processVerifiedResendWebhook: test.processVerifiedResendWebhook,
    });
    const response = await route.POST(request() as never);
    expect(response.status).toBe(503);
    expect(test.verify).not.toHaveBeenCalled();
    expect(test.createDatabase).not.toHaveBeenCalled();
  });

  it('rejects declared and actual bodies over the hard limit before verification', async () => {
    const declared = harness();
    const declaredResponse = await declared.POST(
      request('{}', { 'content-length': '65537' }) as never
    );
    expect(declaredResponse.status).toBe(413);
    expect(declared.verify).not.toHaveBeenCalled();

    const actual = harness();
    const actualResponse = await actual.POST(
      request('x'.repeat(65_537)) as never
    );
    expect(actualResponse.status).toBe(413);
    expect(actual.verify).not.toHaveBeenCalled();
  });

  it('cancels a chunked body as soon as it crosses the hard byte limit', async () => {
    const test = harness();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(40_000));
        controller.enqueue(new Uint8Array(30_000));
      },
      cancel,
    });
    const streamedRequest = new Request(
      'https://threadplane.ai/api/webhooks/resend',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'svix-id': 'msg_123',
          'svix-timestamp': '1788264000',
          'svix-signature': 'v1,signature',
        },
        body,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' }
    );

    const response = await test.POST(streamedRequest as never);

    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(test.verify).not.toHaveBeenCalled();
    expect(test.createDatabase).not.toHaveBeenCalled();
  });

  it('closes the database and returns 503 when verified payload processing fails', async () => {
    const test = harness();
    test.processVerifiedResendWebhook.mockRejectedValueOnce(
      new Error('bad schema')
    );
    const response = await test.POST(request() as never);
    expect(response.status).toBe(503);
    expect(test.database.close).toHaveBeenCalledTimes(1);
  });

  it('returns 400 for a typed payload validation failure', async () => {
    const test = harness();
    test.processVerifiedResendWebhook.mockRejectedValueOnce(
      new ResendWebhookPayloadError()
    );
    const response = await test.POST(request() as never);
    expect(response.status).toBe(400);
    expect(test.database.close).toHaveBeenCalledTimes(1);
  });

  it('does not log database error details', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const test = harness();
      test.processVerifiedResendWebhook.mockRejectedValueOnce(
        new Error('private database credential')
      );
      const response = await test.POST(request() as never);
      expect(response.status).toBe(503);
      expect(JSON.stringify(log.mock.calls)).not.toContain(
        'private database credential'
      );
    } finally {
      log.mockRestore();
    }
  });

  it('returns 503 only for a retryable tagged provider-ID attachment race', async () => {
    const test = harness();
    test.processVerifiedResendWebhook
      .mockResolvedValueOnce({
        applied: false,
        reason: 'retryable_unmatched_job',
      })
      .mockResolvedValueOnce({
        applied: true,
        activityKind: 'delivery.delivered',
        deliveryStatus: 'delivered',
      })
      .mockResolvedValueOnce({ applied: false, reason: 'replay' });

    const first = await test.POST(request() as never);
    const second = await test.POST(request() as never);
    const third = await test.POST(request() as never);

    expect([first.status, second.status, third.status]).toEqual([
      503, 200, 200,
    ]);
    expect(test.processVerifiedResendWebhook).toHaveBeenCalledTimes(3);
    expect(test.createDatabase).toHaveBeenCalledTimes(3);
    expect(test.database.close).toHaveBeenCalledTimes(3);
  });
});
