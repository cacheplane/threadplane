import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { test } from 'node:test';
import { chromium } from '@playwright/test';
import { forwardProtectedDocsRequest } from './docs-protected-request';

const listen = async (server: Server) => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
};
const close = (server: Server) =>
  new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => (error ? reject(error) : resolve()));
  });

for (const kind of ['document', 'asset']) {
  test(
    `protected ${kind} redirects never send the bypass to another origin`,
    { timeout: 45000 },
    async () => {
      const received: string[] = [];
      const destination = createServer((request, response) => {
        received.push(
          String(request.headers['x-vercel-protection-bypass'] ?? '')
        );
        response.end('unexpected destination');
      });
      const destinationOrigin = await listen(destination);
      const protectedRequests: string[] = [];
      const source = createServer((request, response) => {
        protectedRequests.push(
          String(request.headers['x-vercel-protection-bypass'] ?? '')
        );
        if (kind === 'asset' && request.url === '/') {
          response.setHeader('content-type', 'text/html');
          response.end('<img src="/asset.png" alt="redirect test">');
        } else {
          response.writeHead(302, {
            Location: `${destinationOrigin}/redirect-target`,
          });
          response.end();
        }
      });
      const sourceOrigin = await listen(source);
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
      try {
      browser = await chromium.launch();
        const context = await browser.newContext();
        const failures: string[] = [];
        await context.route('**/*', async (route) => {
          try {
            if (new URL(route.request().url()).origin === sourceOrigin)
              return await forwardProtectedDocsRequest(
                route,
                'dummy-test-bypass'
              );
            return await route.abort();
          } catch (error) {
            failures.push(String(error));
            await route.abort();
          }
        });
        const page = await context.newPage();
        await page
          .goto(sourceOrigin, { waitUntil: 'load', timeout: 15000 })
          .catch(() => undefined);
        assert.ok(protectedRequests.length > 0);
        assert.ok(
          protectedRequests.every((value) => value === 'dummy-test-bypass')
        );
        assert.deepEqual(
          received,
          [],
          'a redirected request reached the second origin'
        );
        assert.equal(failures.length, 1, 'the redirect must fail closed');
        assert.match(failures[0], /redirect/i);
        assert.doesNotMatch(failures[0], /dummy-test-bypass/);
      } finally {
      await browser?.close();
        await Promise.all([close(source), close(destination)]);
      }
    }
  );
}
