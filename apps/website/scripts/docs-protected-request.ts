import type { Route } from '@playwright/test';

/** Forward a protected documentation request without exposing its bypass elsewhere. */
export async function forwardProtectedDocsRequest(
  route: Route,
  secret: string
): Promise<void> {
  // continue({ headers }) forwards overrides across redirects, without routing
  // the redirected URL again. Fetch once so the browser never owns the secret.
  const response = await route.fetch({
    headers: {
      ...route.request().headers(),
      'x-vercel-protection-bypass': secret,
    },
    maxRedirects: 0,
    maxRetries: 0,
    timeout: 15000,
  });
  if (response.status() >= 300 && response.status() < 400)
    throw new Error(
      `Protected documentation request redirected (HTTP ${response.status()})`
    );
  await route.fulfill({ response });
}
