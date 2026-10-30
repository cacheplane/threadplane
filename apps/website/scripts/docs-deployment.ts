/** Source identity observed from one already-built website. */
export interface DocsIdentity {
  readonly origin: string;
  readonly revision: string;
}

interface RevisionOptions {
  readonly origin: string;
  readonly revision: string;
  readonly attempts?: number;
  readonly delayMs?: number;
  readonly timeoutMs?: number;
  readonly bypassOrigin?: string;
  readonly bypassSecret?: string;
  readonly fetchRevision?: (
    url: string,
    init: RequestInit
  ) => Promise<Response>;
}

/** Audit a whole HTTPS origin, or an explicit local production server. */
export function requireDocsOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Documentation audit requires a plain HTTPS origin');
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !(
      url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    )
  ) {
    throw new Error(
      'Documentation audit requires a plain HTTPS origin or HTTP loopback'
    );
  }
  return url.origin;
}

/** Retain useful errors without URL credentials, query strings, or protection secrets. */
export function redactDiagnostic(
  value: string,
  secrets: readonly string[] = []
): string {
  let safe = value.replace(/https?:\/\/[^\s<>"']+/g, (candidate) => {
    try {
      const url = new URL(candidate);
      return `${url.origin}${url.pathname}`;
    } catch {
      return '[invalid-url]';
    }
  });
  for (const secret of secrets.filter(Boolean))
    safe = safe.split(secret).join('[redacted]');
  return safe;
}

/** Retry propagation only; every request is bounded and redirects fail closed. */
export async function waitForDocsRevision(
  options: RevisionOptions
): Promise<DocsIdentity> {
  const origin = requireDocsOrigin(options.origin);
  if (!/^[a-f0-9]{40}$/.test(options.revision))
    throw new Error('Expected a full lowercase source revision');
  const attempts = options.attempts ?? 12;
  const delayMs = options.delayMs ?? 5000;
  const timeoutMs = options.timeoutMs ?? 5000;
  if (
    !Number.isInteger(attempts) ||
    attempts < 1 ||
    attempts > 24 ||
    !Number.isFinite(delayMs) ||
    delayMs < 0 ||
    delayMs > 10000 ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 10000
  ) {
    throw new Error('Invalid documentation readiness limits');
  }
  const request = options.fetchRevision ?? fetch;
  let errorMessage = '';
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const response = await request(`${origin}/api/docs-revision`, {
            redirect: 'error',
            cache: 'no-store',
            signal: controller.signal,
            headers: {
              'Cache-Control': 'no-cache',
              ...(origin === options.bypassOrigin && options.bypassSecret
                ? { 'x-vercel-protection-bypass': options.bypassSecret }
                : {}),
            },
          });
          if (!response.ok || response.redirected)
            throw new Error(
              `Identity request failed with HTTP ${response.status} or redirect`
            );
          const body: unknown = await response.json();
          if (
            !body ||
            typeof body !== 'object' ||
            !('revision' in body) ||
            body.revision !== options.revision
          ) {
            throw new Error(
              `Expected revision ${options.revision} at ${origin}; received a different or missing revision`
            );
          }
          return { origin, revision: options.revision };
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error(`Identity request timed out at ${origin}`));
          }, timeoutMs);
        }),
      ]);
    } catch (error) {
      errorMessage = redactDiagnostic(
        error instanceof Error ? error.message : String(error),
        [options.bypassSecret ?? '']
      );
    } finally {
      clearTimeout(timer);
    }
    if (attempt + 1 < attempts)
      await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Documentation deployment not ready: ${errorMessage}`);
}

/** Bind one non-retried browser sweep to immutable/public identities before and after. */
export async function verifyDocsDeployment(
  options: Omit<RevisionOptions, 'origin' | 'attempts'> & {
    readonly origins: readonly string[];
    readonly auditOrigin: string;
    readonly audit: (origin: string) => Promise<void>;
    readonly onIdentity?: (
      phase: 'before' | 'after',
      identity: DocsIdentity
    ) => void;
  }
): Promise<void> {
  const origins = [...new Set(options.origins.map(requireDocsOrigin))];
  const auditOrigin = requireDocsOrigin(options.auditOrigin);
  if (!origins.length || !origins.includes(auditOrigin))
    throw new Error('The audit origin must be one of the verified artifacts');
  const check = async (phase: 'before' | 'after') => {
    await Promise.all(
      origins.map(async (origin) => {
        const identity = await waitForDocsRevision({
          ...options,
          origin,
          attempts: phase === 'before' ? 12 : 1,
        });
        options.onIdentity?.(phase, identity);
      })
    );
  };
  await check('before');
  await options.audit(auditOrigin);
  await check('after');
}
