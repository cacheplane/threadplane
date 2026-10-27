import { NextResponse, type NextRequest } from 'next/server';

// The website intentionally consumes the growth library through its internal boundary.
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  createDatabaseExecutor,
  growthStopEventKey,
  loadGrowthTokenKeyring,
  normalizeEmail,
  stopContact,
  stopLegacyEmailUnsubscribe,
  verifyGrowthActionToken,
  type EmailHmacKeyring,
  type GrowthTokenKeyring,
  type SqlExecutor,
  type StopContactInput,
  type StopContactResult,
} from '@threadplane-internal/growth';

import { readBoundedBody } from '../_internal/read-bounded-body';

const UNSUBSCRIBE_TOKEN_MAX_AGE_SECONDS = 5 * 365 * 24 * 60 * 60;
const POLICY_VERSION = 'growth-lifecycle-v1';
const MAX_REQUEST_BODY_LENGTH = 2_048;
const FAILURE_BODY = 'Unable to process this request.';

interface UnsubscribeRouteDependencies {
  now: () => Date;
  loadTokenKeyring: () => GrowthTokenKeyring;
  loadEmailKeyring: () => EmailHmacKeyring;
  createDatabase: () => SqlExecutor;
  stopLegacyEmailUnsubscribe: typeof stopLegacyEmailUnsubscribe;
  stopContact: (
    executor: SqlExecutor,
    input: StopContactInput
  ) => Promise<Pick<StopContactResult, 'applied' | 'effective'>>;
}

interface PostInput {
  token: string;
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/[&<>"'`]/gu, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return '&#96;';
    }
  });
}

function htmlResponse(title: string, message: string, form = ''): NextResponse {
  return new NextResponse(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body><main><h1>${title}</h1><p>${message}</p>${form}</main></body></html>`,
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/html; charset=utf-8',
      },
    }
  );
}

function failureResponse(): NextResponse {
  return new NextResponse(FAILURE_BODY, {
    status: 400,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

function confirmationResponse(token: string): NextResponse {
  return htmlResponse(
    'Confirm email preference',
    'Submit this form to update the contact preference.',
    `<form method="post" action="/api/unsubscribe"><input type="hidden" name="token" value="${escapeHtmlAttribute(
      token
    )}"><button type="submit">Confirm</button></form>`
  );
}

function successResponse(): NextResponse {
  return htmlResponse('Email preference updated', 'The request was recorded.');
}

/**
 * A server fault is never reported as a recorded preference. The recipient gets
 * a retryable answer with no internal detail, and the caller can try again.
 */
function retryableFailureResponse(): NextResponse {
  return new NextResponse(FAILURE_BODY, {
    status: 503,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'Retry-After': '30',
    },
  });
}

function parseVersion(value: string | undefined): number {
  if (!value || !/^\d+$/u.test(value)) {
    throw new Error('Growth email HMAC active version is required');
  }
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version <= 0 || version > 32_767) {
    throw new Error('Growth email HMAC active version is invalid');
  }
  return version;
}

function loadEmailHmacKeyring(
  environment: NodeJS.ProcessEnv = process.env
): EmailHmacKeyring {
  const version = parseVersion(environment['GROWTH_EMAIL_HMAC_ACTIVE_VERSION']);
  const secret = environment['GROWTH_EMAIL_HMAC_ACTIVE_SECRET'];
  if (!secret) throw new Error('Growth email HMAC active secret is required');

  let previous: { version: number; secret: string }[] = [];
  const rawPrevious = environment['GROWTH_EMAIL_HMAC_PREVIOUS_KEYS'];
  if (rawPrevious) {
    const parsed = JSON.parse(rawPrevious) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('Growth email HMAC previous keys must be an array');
    }
    previous = parsed.map((candidate) => {
      if (
        candidate === null ||
        typeof candidate !== 'object' ||
        Array.isArray(candidate)
      ) {
        throw new Error('Growth email HMAC previous key is invalid');
      }
      const record = candidate as Record<string, unknown>;
      if (
        typeof record['version'] !== 'number' ||
        typeof record['secret'] !== 'string'
      ) {
        throw new Error('Growth email HMAC previous key is invalid');
      }
      return { version: record['version'], secret: record['secret'] };
    });
  }
  return {
    active: { version, secret },
    ...(previous.length === 0 ? {} : { previous }),
  };
}

function defaultDependencies(): UnsubscribeRouteDependencies {
  return {
    now: () => new Date(),
    loadTokenKeyring: () => loadGrowthTokenKeyring(),
    loadEmailKeyring: () => loadEmailHmacKeyring(),
    createDatabase: () => createDatabaseExecutor(),
    stopLegacyEmailUnsubscribe,
    stopContact,
  };
}

async function readPostInput(request: Request): Promise<PostInput | null> {
  const url = new URL(request.url);
  const contentType = request.headers.get('content-type');
  const mediaType = contentType?.split(';', 1)[0]?.trim().toLowerCase();
  if (
    mediaType !== 'application/x-www-form-urlencoded' &&
    mediaType !== 'multipart/form-data'
  ) {
    return null;
  }

  let bodyText: string;
  try {
    const boundedBody = await readBoundedBody(request, MAX_REQUEST_BODY_LENGTH);
    if (boundedBody === null) return null;
    bodyText = boundedBody;
  } catch {
    return null;
  }
  const queryEntries = [...url.searchParams.entries()];
  let formEntries: [string, string][];
  try {
    if (mediaType === 'multipart/form-data') {
      const form = await new Request(request.url, {
        method: 'POST',
        headers: { 'content-type': contentType as string },
        body: bodyText,
      }).formData();
      const entries = [...form.entries()];
      if (entries.some(([, value]) => typeof value !== 'string')) return null;
      formEntries = entries as [string, string][];
    } else {
      formEntries = [...new URLSearchParams(bodyText).entries()];
    }
  } catch {
    return null;
  }

  if (queryEntries.length > 0) {
    const queryToken = queryEntries[0]?.[1].trim() ?? '';
    return queryEntries.length === 1 &&
      queryEntries[0]?.[0] === 'token' &&
      queryToken.length > 0 &&
      formEntries.length === 1 &&
      formEntries[0]?.[0] === 'List-Unsubscribe' &&
      formEntries[0]?.[1] === 'One-Click'
      ? { token: queryToken }
      : null;
  }

  const bodyToken = formEntries[0]?.[1].trim() ?? '';
  return formEntries.length === 1 &&
    formEntries[0]?.[0] === 'token' &&
    bodyToken.length > 0
    ? { token: bodyToken }
    : null;
}

async function withDatabase<T>(
  dependencies: UnsubscribeRouteDependencies,
  operation: (executor: SqlExecutor) => Promise<T>
): Promise<T> {
  const executor = dependencies.createDatabase();
  try {
    return await operation(executor);
  } finally {
    await executor.close?.();
  }
}

function signedStopInput(
  payload: NonNullable<ReturnType<typeof verifyGrowthActionToken>>,
  receivedAt: Date
): StopContactInput {
  return {
    contactId: payload.contactId,
    reason: 'unsubscribe',
    eventKey: growthStopEventKey(payload),
    occurredAt: receivedAt,
    source: 'signed_unsubscribe',
    provenance: {
      actor: 'recipient',
      kind: 'one_click',
      policyVersion: POLICY_VERSION,
    },
  };
}

export function createUnsubscribeRoute(
  overrides: Partial<UnsubscribeRouteDependencies> = {}
): {
  GET: (request: NextRequest) => Promise<NextResponse>;
  POST: (request: NextRequest) => Promise<NextResponse>;
} {
  const dependencies = { ...defaultDependencies(), ...overrides };

  return {
    async GET(request) {
      const url = new URL(request.url);
      const token = url.searchParams.get('token')?.trim();
      const legacyEmail = url.searchParams.get('email');

      if (token) {
        let payload;
        try {
          payload = verifyGrowthActionToken(token, {
            expectedPurpose: 'unsubscribe',
            keyring: dependencies.loadTokenKeyring(),
            now: dependencies.now(),
            maxAgeSeconds: UNSUBSCRIBE_TOKEN_MAX_AGE_SECONDS,
          });
        } catch {
          return failureResponse();
        }
        return payload ? confirmationResponse(token) : failureResponse();
      }

      if (legacyEmail === null) return failureResponse();
      try {
        normalizeEmail(legacyEmail);
      } catch {
        return failureResponse();
      }

      try {
        const occurredAt = dependencies.now();
        await withDatabase(dependencies, async (executor) => {
          await dependencies.stopLegacyEmailUnsubscribe(executor, {
            email: legacyEmail,
            keyring: dependencies.loadEmailKeyring(),
            occurredAt,
            source: 'legacy_raw_email_unsubscribe',
            policyVersion: POLICY_VERSION,
          });
        });
        // Known and unknown addresses share this shape, so the link still does
        // not reveal whether the address is on file.
        return successResponse();
      } catch {
        return retryableFailureResponse();
      }
    },

    async POST(request) {
      const receivedAt = dependencies.now();
      const input = await readPostInput(request);
      if (!input) return failureResponse();

      let payload;
      try {
        payload = verifyGrowthActionToken(input.token, {
          expectedPurpose: 'unsubscribe',
          keyring: dependencies.loadTokenKeyring(),
          now: receivedAt,
          maxAgeSeconds: UNSUBSCRIBE_TOKEN_MAX_AGE_SECONDS,
        });
      } catch {
        return failureResponse();
      }
      if (!payload) return failureResponse();

      try {
        await withDatabase(dependencies, (executor) =>
          dependencies.stopContact(
            executor,
            signedStopInput(payload, receivedAt)
          )
        );
        return successResponse();
      } catch {
        return retryableFailureResponse();
      }
    },
  };
}

const route = createUnsubscribeRoute();

export const GET = route.GET;
export const POST = route.POST;
