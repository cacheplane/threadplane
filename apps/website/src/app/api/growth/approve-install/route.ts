import { NextResponse, type NextRequest } from 'next/server';

// The website intentionally consumes the growth library through its internal boundary.
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  FOUNDER_APPROVE_INSTALL_TOKEN_MAX_AGE_SECONDS,
  approveContactFromInstallDigest,
  createDatabaseExecutor,
  growthStopEventKey,
  loadGrowthTokenKeyring,
  verifyGrowthActionToken,
  type ApproveContactFromInstallDigestInput,
  type ApproveContactFromInstallDigestResult,
  type EmailHmacKeyring,
  type GrowthTokenKeyring,
  type SqlExecutor,
} from '@threadplane-internal/growth';

import { loadEmailHmacKeyring } from '../../../../lib/growth/email-keyring';
import { readBoundedBody } from '../../_internal/read-bounded-body';

const MAX_REQUEST_BODY_LENGTH = 2_048;
const FAILURE_BODY = 'Unable to process this request.';

interface FounderApproveInstallRouteDependencies {
  now: () => Date;
  loadTokenKeyring: () => GrowthTokenKeyring;
  loadEmailKeyring: () => EmailHmacKeyring;
  createDatabase: () => SqlExecutor;
  approveContactFromInstallDigest: (
    executor: SqlExecutor,
    input: ApproveContactFromInstallDigestInput
  ) => Promise<ApproveContactFromInstallDigestResult>;
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
    'Confirm outreach approval',
    'Submit this form to approve founder outreach for this installer.',
    `<form method="post" action="/api/growth/approve-install"><input type="hidden" name="token" value="${escapeHtmlAttribute(token)}"><button type="submit">Approve</button></form>`
  );
}

function successResponse(): NextResponse {
  return htmlResponse(
    'Outreach approved',
    'The contact is approved and will be enrolled on the next lifecycle tick.'
  );
}

function defaultDependencies(): FounderApproveInstallRouteDependencies {
  return {
    now: () => new Date(),
    loadTokenKeyring: () => loadGrowthTokenKeyring(),
    loadEmailKeyring: () => loadEmailHmacKeyring(),
    createDatabase: () => createDatabaseExecutor(),
    approveContactFromInstallDigest,
  };
}

async function readToken(request: Request): Promise<string | null> {
  if ([...new URL(request.url).searchParams].length > 0) return null;
  const contentType = request.headers.get('content-type');
  if (
    contentType?.split(';', 1)[0]?.trim().toLowerCase() !==
    'application/x-www-form-urlencoded'
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
  if (bodyText.length === 0) {
    return null;
  }
  const entries = [...new URLSearchParams(bodyText).entries()];
  const token = entries[0]?.[1].trim() ?? '';
  return entries.length === 1 && entries[0]?.[0] === 'token' && token.length > 0
    ? token
    : null;
}

export function createFounderApproveInstallRoute(
  overrides: Partial<FounderApproveInstallRouteDependencies> = {}
): {
  GET: (request: NextRequest) => Promise<NextResponse>;
  POST: (request: NextRequest) => Promise<NextResponse>;
} {
  const dependencies = { ...defaultDependencies(), ...overrides };

  function verify(token: string, verifiedAt = dependencies.now()) {
    try {
      return verifyGrowthActionToken(token, {
        expectedPurpose: 'founder_approve_install',
        keyring: dependencies.loadTokenKeyring(),
        now: verifiedAt,
        maxAgeSeconds: FOUNDER_APPROVE_INSTALL_TOKEN_MAX_AGE_SECONDS,
      });
    } catch {
      return null;
    }
  }

  return {
    async GET(request) {
      const token = new URL(request.url).searchParams.get('token')?.trim();
      if (!token) return failureResponse();
      return verify(token) ? confirmationResponse(token) : failureResponse();
    },

    async POST(request) {
      const receivedAt = dependencies.now();
      const token = await readToken(request);
      if (!token) return failureResponse();
      const payload = verify(token, receivedAt);
      if (!payload) return failureResponse();

      const executor = dependencies.createDatabase();
      try {
        const result = await dependencies.approveContactFromInstallDigest(
          executor,
          {
            installObservationId: payload.contactId,
            occurredAt: receivedAt,
            eventKey: growthStopEventKey(payload),
            keyring: dependencies.loadEmailKeyring(),
          }
        );
        return result.approved ? successResponse() : failureResponse();
      } catch {
        return failureResponse();
      } finally {
        await executor.close?.();
      }
    },
  };
}

const route = createFounderApproveInstallRoute();

export const GET = route.GET;
export const POST = route.POST;
