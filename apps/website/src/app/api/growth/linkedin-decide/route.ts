import { NextResponse, type NextRequest } from 'next/server';

// The website intentionally consumes the growth library through its internal boundary.
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  FOUNDER_LINKEDIN_DECIDE_TOKEN_MAX_AGE_SECONDS,
  createDatabaseExecutor,
  decideLead,
  loadGrowthTokenKeyring,
  verifyGrowthActionToken,
  type DecideLeadInput,
  type DecideLeadResult,
  type GrowthTokenKeyring,
  type SqlExecutor,
} from '@threadplane-internal/growth';

import { readBoundedBody } from '../../_internal/read-bounded-body';

const MAX_REQUEST_BODY_LENGTH = 2_048;
const FAILURE_BODY = 'Unable to process this request.';

type Decision = 'reject' | 'deny';

interface FounderLinkedInDecideRouteDependencies {
  now: () => Date;
  loadTokenKeyring: () => GrowthTokenKeyring;
  createDatabase: () => SqlExecutor;
  decideLead: (
    executor: SqlExecutor,
    input: DecideLeadInput
  ) => Promise<DecideLeadResult>;
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

function confirmationResponse(token: string, decision: Decision): NextResponse {
  const heading =
    decision === 'deny' ? 'Deny this lead forever' : 'Reject this lead';
  return htmlResponse(
    heading,
    'Submit this form to confirm.',
    `<form method="post" action="/api/growth/linkedin-decide"><input type="hidden" name="token" value="${escapeHtmlAttribute(
      token
    )}"><button type="submit">Confirm</button></form>`
  );
}

function successResponse(decision: Decision): NextResponse {
  return htmlResponse(
    decision === 'deny' ? 'Lead denied forever' : 'Lead rejected',
    'The decision is recorded.'
  );
}

function defaultDependencies(): FounderLinkedInDecideRouteDependencies {
  return {
    now: () => new Date(),
    loadTokenKeyring: () => loadGrowthTokenKeyring(),
    createDatabase: () => createDatabaseExecutor(),
    decideLead,
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

export function createFounderLinkedInDecideRoute(
  overrides: Partial<FounderLinkedInDecideRouteDependencies> = {}
): {
  GET: (request: NextRequest) => Promise<NextResponse>;
  POST: (request: NextRequest) => Promise<NextResponse>;
} {
  const dependencies = { ...defaultDependencies(), ...overrides };

  function verify(token: string, verifiedAt = dependencies.now()) {
    try {
      const payload = verifyGrowthActionToken(token, {
        expectedPurpose: 'founder_linkedin_decide',
        keyring: dependencies.loadTokenKeyring(),
        now: verifiedAt,
        maxAgeSeconds: FOUNDER_LINKEDIN_DECIDE_TOKEN_MAX_AGE_SECONDS,
      });
      if (!payload) return null;
      // This route never approves: only reject and deny are accepted.
      if (payload.reason !== 'reject' && payload.reason !== 'deny') return null;
      return {
        leadId: payload.contactId,
        decision: payload.reason as Decision,
      };
    } catch {
      return null;
    }
  }

  return {
    async GET(request) {
      const token = new URL(request.url).searchParams.get('token')?.trim();
      if (!token) return failureResponse();
      const verified = verify(token);
      return verified
        ? confirmationResponse(token, verified.decision)
        : failureResponse();
    },

    async POST(request) {
      const receivedAt = dependencies.now();
      const token = await readToken(request);
      if (!token) return failureResponse();
      const verified = verify(token, receivedAt);
      if (!verified) return failureResponse();

      const executor = dependencies.createDatabase();
      try {
        const result = await dependencies.decideLead(executor, {
          leadId: verified.leadId,
          decision: verified.decision,
          decidedBy: 'founder_email_link',
          now: receivedAt,
        });
        return result === 'applied' || result === 'already_decided'
          ? successResponse(verified.decision)
          : failureResponse();
      } catch {
        return failureResponse();
      } finally {
        await executor.close?.();
      }
    },
  };
}

export const { GET, POST } = createFounderLinkedInDecideRoute();
