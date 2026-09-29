import { expect, test } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

declare global {
  interface Window {
    ownedAbortProof: {
      controller: AbortController;
      received: string;
      outcome: string;
    };
  }
}

const workspace = resolve(__dirname, '../../../../');
const native = 'examples/chat/native/react';
const key = 'owned-development-api-key-sentinel';
const clientSecret = 'owned-development-vite-secret-sentinel';
const hash = (path: string) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

async function listen(server: http.Server) {
  await new Promise<void>((yes, no) => {
    server.once('error', no);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', no);
      yes();
    });
  });
  return (server.address() as { port: number }).port;
}

async function closeServer(server: http.Server) {
  await new Promise<void>((yes, no) => {
    server.close((error) => (error ? no(error) : yes()));
    server.closeAllConnections();
  });
}

function copySources(
  destination: string,
  inputRoots: string[],
  excludedSourcePath: (path: string) => boolean
) {
  // Explicit build roots only: no stale dist, private dotenv, or source links.
  // The shared input manifest includes auxiliary graph metadata and the one
  // eagerly loaded helper trace; it does not include unrelated library trees.
  for (const local of inputRoots) {
    const source = join(workspace, local);
    if (!existsSync(source)) continue;
    mkdirSync(dirname(join(destination, local)), { recursive: true });
    cpSync(source, join(destination, local), {
      recursive: true,
      filter: (path) => {
        if (excludedSourcePath(relative(workspace, path))) return false;
        assert.equal(
          lstatSync(path).isSymbolicLink(),
          false,
          `Source link: ${path}`
        );
        return true;
      },
    });
  }
  // Foundation CLIs only. The authored application gets its own installed tree.
  symlinkSync(
    realpathSync(join(workspace, 'node_modules')),
    join(destination, 'node_modules'),
    'dir'
  );
  assert.equal(existsSync(join(destination, 'dist')), false);
}

function installationSnapshot(temporary: string, consumer: string) {
  const tarballs = readdirSync(temporary)
    .filter((name) => name.endsWith('.tgz'))
    .sort();
  expect(tarballs).toHaveLength(4);
  const packages = [
    'typescript',
    'vite',
    'react',
    'react-dom',
    '@threadplane/core',
    '@threadplane/content',
    '@threadplane/react',
    '@threadplane/langgraph',
  ];
  return {
    tarballs: Object.fromEntries(
      tarballs.map((name) => [
        name,
        {
          sha256: hash(join(temporary, name)),
          mtime: statSync(join(temporary, name)).mtimeMs,
        },
      ])
    ),
    lock: hash(join(consumer, 'package-lock.json')),
    packages: Object.fromEntries(
      packages.map((name) => [
        name,
        JSON.parse(
          readFileSync(
            join(consumer, 'node_modules', name, 'package.json'),
            'utf8'
          )
        ).version,
      ])
    ),
  };
}

test('development: authored refresh, native diagnostics, browser abort and owned cleanup', async ({
  page,
}, testInfo) => {
  const { buildInputRoots, inputFingerprint } = await import(
    '../tooling/consumer.mjs'
  );
  const { excludedSourcePath } = await import('../tooling/source-policy.mjs');
  const original = inputFingerprint(workspace);
  const owned = realpathSync(
    mkdtempSync(join(tmpdir(), 'native-development-proof-'))
  );
  const root = join(owned, 'sources');
  const generations = join(owned, 'generations');
  mkdirSync(root);
  mkdirSync(generations);
  const logs: string[] = [];
  const evidence: Record<string, unknown> = { owned };
  const requests: {
    path: string;
    method?: string;
    payload?: unknown;
    authenticated: boolean;
    responseClosed: boolean;
    socketClosed: boolean;
  }[] = [];
  evidence.requests = requests;
  const groups = new Set<number>();
  const baselineSignals = [
    process.listenerCount('SIGINT'),
    process.listenerCount('SIGTERM'),
  ];
  let supervisor:
    | ReturnType<typeof import('../tooling/serve.mjs').startServe>
    | undefined;
  let upstreamCleanup = false;
  const upstream = http.createServer(async (request, response) => {
    const observation = {
      path: request.url ?? '',
      method: request.method,
      payload: undefined as unknown,
      authenticated: request.headers['x-api-key'] === key,
      responseClosed: false,
      socketClosed: false,
    };
    requests.push(observation);
    // Response/socket closure while held open is the cancellation proof. A GET
    // request's normal body completion is deliberately not observed here.
    response.once('close', () => {
      observation.responseClosed = !upstreamCleanup;
    });
    request.socket.once('close', () => {
      observation.socketClosed = !upstreamCleanup;
    });
    if (request.url === '/threads/search') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      observation.payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      response.writeHead(200, { 'content-type': 'application/json' }).end('[]');
    } else if (request.url === '/owned-sse') {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: owned-stream-open\n\n');
    } else if (request.url !== '/owned-held') {
      response.writeHead(404).end();
    }
  });
  try {
    copySources(root, buildInputRoots(workspace), excludedSourcePath);
    const upstreamPort = await listen(upstream);
    const target = `http://127.0.0.1:${upstreamPort}`;
    const { startServe } = await import(
      pathToFileURL(join(root, 'examples/chat/native/tooling/serve.mjs')).href
    );
    const launch = async () => {
      const reservation = http.createServer();
      const port = await listen(reservation);
      await closeServer(reservation);
      const started = startServe({
        root,
        temporaryParent: generations,
        options: {
          configuration: 'development',
          assistantId: 'owned-development-assistant',
          port,
        },
        env: {
          ...process.env,
          NATIVE_LANGGRAPH_URL: target,
          NATIVE_LANGGRAPH_API_KEY: key,
          VITE_SECRET: clientSecret,
        },
        log: (line: string) => logs.push(line),
        killProcessGroup: (pid: number, signal: NodeJS.Signals | number) => {
          groups.add(pid);
          process.kill(pid, signal);
        },
      });
      supervisor = started;
      void started.closed.catch((error: Error) =>
        logs.push(`Supervisor failed: ${error.message}`)
      );
      const ready = await started.ready;
      expect(new URL(ready.url).port).toBe(String(port));
      expect(
        lstatSync(join(ready.consumer, 'node_modules')).isSymbolicLink()
      ).toBe(false);
      return { started, ...ready };
    };
    const assertStopped = async (url: string, temporary: string) => {
      expect(existsSync(temporary)).toBe(false);
      await expect(async () => {
        await fetch(url, { signal: AbortSignal.timeout(2_000) });
      }).rejects.toThrow();
      for (const group of groups)
        assert.throws(() => process.kill(group, 0), { code: 'ESRCH' });
      expect([
        process.listenerCount('SIGINT'),
        process.listenerCount('SIGTERM'),
      ]).toEqual(baselineSignals);
      expect(readdirSync(generations)).toEqual([]);
    };
    const first = await launch();
    const before = installationSnapshot(
      first.started.temporary,
      first.consumer
    );
    expect(before.packages.typescript).toBe('5.9.3');
    expect(before.packages.vite).toBe('7.3.1');
    const served: string[] = [];
    const pendingResponses: Promise<void>[] = [];
    page.on('response', (response) => {
      if (
        !response.url().startsWith(first.url) ||
        response.url().includes('/api/')
      )
        return;
      pendingResponses.push(
        response
          .text()
          .then((body) => {
            served.push(body);
          })
          .catch(() => {})
      );
    });
    const apiRequests: string[] = [];
    let documentNumber = 0;
    const searchDocuments: number[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) documentNumber++;
    });
    const browserRequests: { url: string; headers: Record<string, string> }[] =
      [];
    page.on('request', (request) => {
      browserRequests.push({ url: request.url(), headers: request.headers() });
      if (new URL(request.url()).pathname.startsWith('/api/'))
        apiRequests.push(request.url());
      if (new URL(request.url()).pathname === '/api/threads/search')
        searchDocuments.push(documentNumber);
    });
    await page.goto(first.url);
    await expect(
      page.getByRole('heading', { name: 'A place for your next conversation.' })
    ).toBeVisible();
    await expect(
      page.getByText('Select a conversation or start a new one.')
    ).toBeVisible();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toMatchObject({
      path: '/threads/search',
      method: 'POST',
      payload: { limit: 50, offset: 0 },
      authenticated: true,
    });
    expect(apiRequests.map((url) => new URL(url).pathname)).toEqual([
      '/api/threads/search',
    ]);

    const source = join(root, native, 'src');
    const app = join(source, 'app.tsx');
    const originalApp = readFileSync(app, 'utf8');
    const marker = join(source, 'owned-proof/marker.ts');
    const authoredCheckStart = logs.length;
    mkdirSync(dirname(marker));
    writeFileSync(
      marker,
      'export const developmentMarker = "owned marker one";\n'
    );
    writeFileSync(
      app,
      "import { developmentMarker } from './owned-proof/marker';\n" +
        originalApp.replace(
          '<main>',
          '<main><output data-testid="development-marker">{developmentMarker}</output>'
        )
    );
    // No page.reload/navigation here: only the live Vite connection can update it.
    await expect(page.getByTestId('development-marker')).toHaveText(
      'owned marker one'
    );
    await expect.poll(() => requests.length).toBe(2);
    const atomic = join(dirname(marker), '.marker-atomic');
    writeFileSync(
      atomic,
      'export const developmentMarker = "owned marker two";\n'
    );
    renameSync(atomic, marker);
    await expect(page.getByTestId('development-marker')).toHaveText(
      'owned marker two'
    );
    await expect.poll(() => requests.length).toBe(3);
    await expect
      .poll(() => logs.slice(authoredCheckStart).join('\n'))
      .toMatch(/Found 0 errors\. Watching for file changes\./);
    const publicFile = join(root, native, 'public/owned-proof/nested.txt');
    mkdirSync(dirname(publicFile), { recursive: true });
    writeFileSync(publicFile, 'owned nested public asset');
    await expect
      .poll(async () =>
        page.evaluate(async () =>
          (await fetch('/owned-proof/nested.txt')).text()
        )
      )
      .toBe('owned nested public asset');

    let diagnosticStart = logs.length;
    const renamed = join(dirname(marker), 'renamed.ts');
    renameSync(marker, renamed);
    await expect
      .poll(() => logs.slice(diagnosticStart).join('\n'))
      .toMatch(/app\.tsx.*TS2307.*owned-proof\/marker/);
    diagnosticStart = logs.length;
    writeFileSync(
      renamed,
      'export const developmentMarker = "owned marker recovered";\n'
    );
    renameSync(renamed, marker);
    await expect
      .poll(() => logs.slice(diagnosticStart).join('\n'))
      .toMatch(/Found 0 errors\. Watching for file changes\./);
    await expect(page.getByTestId('development-marker')).toHaveText(
      'owned marker recovered'
    );
    await expect.poll(() => requests.length).toBe(4);

    const negative = join(source, 'owned-proof/snapshot.tsx');
    diagnosticStart = logs.length;
    // Compiled by the app's tsconfig; deliberately never invoked in the UI.
    writeFileSync(
      negative,
      'import { Markdown } from \'@threadplane/react/markdown\';\nexport const invalidSnapshot = () => <Markdown snapshot="wrong snapshot" />;\n'
    );
    await expect
      .poll(() => logs.slice(diagnosticStart).join('\n'))
      .toMatch(
        /snapshot\.tsx.*TS2322: Type 'string' is not assignable to type 'MarkdownSnapshot'/
      );
    expect(logs.slice(diagnosticStart).join('\n')).not.toMatch(/TS2307/);
    diagnosticStart = logs.length;
    rmSync(negative);
    await expect
      .poll(() => logs.slice(diagnosticStart).join('\n'))
      .toMatch(/Found 0 errors\. Watching for file changes\./);
    await expect(page.getByTestId('development-marker')).toHaveText(
      'owned marker recovered'
    );
    await page.screenshot({
      path: testInfo.outputPath('development-recovered.png'),
    });
    // Each successful document starts exactly one directory refresh. The
    // intentionally broken import document never reaches composition.
    expect(requests).toHaveLength(4);
    expect(new Set(searchDocuments).size).toBe(4);

    for (const path of ['owned-held', 'owned-sse']) {
      await page.evaluate((path) => {
        const controller = new AbortController();
        const state = { controller, received: '', outcome: '' };
        Object.assign(window, { ownedAbortProof: state });
        void (async () => {
          try {
            const response = await fetch('/api/' + path, {
              signal: controller.signal,
            });
            const reader = response.body!.getReader();
            for (;;) {
              const part = await reader.read();
              if (part.done) break;
              state.received += new TextDecoder().decode(part.value);
            }
            state.outcome = 'completed';
          } catch (error) {
            state.outcome = (error as Error).name;
          }
        })();
      }, path);
      await expect
        .poll(
          () => requests.filter((request) => request.path === '/' + path).length
        )
        .toBe(1);
      if (path === 'owned-sse')
        await expect
          .poll(() => page.evaluate(() => window.ownedAbortProof.received))
          .toContain('owned-stream-open');
      expect(
        requests.find((request) => request.path === '/' + path)
      ).toMatchObject({
        responseClosed: false,
        socketClosed: false,
      });
      await page.evaluate(() => window.ownedAbortProof.controller.abort());
      await expect
        .poll(
          () =>
            requests.find((request) => request.path === '/' + path)
              ?.responseClosed,
          {
            message: `Browser abort must physically close upstream response for ${path}`,
            timeout: 5_000,
          }
        )
        .toBe(true);
      await expect
        .poll(
          () =>
            requests.find((request) => request.path === '/' + path)
              ?.socketClosed
        )
        .toBe(true);
      await expect
        .poll(() => page.evaluate(() => window.ownedAbortProof.outcome))
        .toBe('AbortError');
    }
    expect(
      requests
        .filter((request) => request.path !== '/threads/search')
        .map(({ path, authenticated, responseClosed, socketClosed }) => ({
          path,
          authenticated,
          responseClosed,
          socketClosed,
        }))
    ).toEqual([
      {
        path: '/owned-held',
        authenticated: true,
        responseClosed: true,
        socketClosed: true,
      },
      {
        path: '/owned-sse',
        authenticated: true,
        responseClosed: true,
        socketClosed: true,
      },
    ]);
    expect(apiRequests).toHaveLength(6);
    await Promise.all(pendingResponses);
    const browserConfig = readFileSync(
      join(first.consumer, 'shared/browser-config.json'),
      'utf8'
    );
    expect(JSON.parse(browserConfig)).toEqual({
      assistantId: 'owned-development-assistant',
      apiBase: '/api',
    });
    for (const sentinel of [key, clientSecret, target]) {
      expect(
        [
          browserConfig,
          JSON.stringify(browserRequests),
          ...served,
          ...logs,
        ].join('\n')
      ).not.toContain(sentinel);
      expect(await page.content()).not.toContain(sentinel);
    }
    expect(
      installationSnapshot(first.started.temporary, first.consumer)
    ).toEqual(before);
    expect(logs.filter((line) => line.startsWith('Building '))).toHaveLength(3);
    evidence.first = {
      installation: before,
      requests,
      diagnostics: ['TS2307', 'TS2322', 'zero errors'],
      refresh: 'authored, atomic and recovery',
      browser: testInfo.project.name,
    };
    const closing = first.started.close();
    expect(first.started.close()).toBe(closing);
    await closing;
    await first.started.closed;
    await assertStopped(first.url, first.started.temporary);
    expect(groups.size).toBe(3);
    evidence.normalCleanup = true;

    const second = await launch();
    await page.goto(second.url);
    await expect(page.getByTestId('development-marker')).toHaveText(
      'owned marker recovered'
    );
    await expect
      .poll(
        () =>
          requests.filter((request) => request.path === '/threads/search')
            .length
      )
      .toBe(5);
    const frozen = join(root, 'libs/react/src/index.ts');
    writeFileSync(
      frozen,
      readFileSync(frozen, 'utf8') + '\n// Owned frozen-input invalidation.\n'
    );
    await expect(second.started.closed).rejects.toThrow(
      /Frozen development inputs changed.*restart/i
    );
    await assertStopped(second.url, second.started.temporary);
    expect(groups.size).toBe(6);
    expect(logs.filter((line) => line.startsWith('Building '))).toHaveLength(6);
    expect(requests).toHaveLength(7);
    expect(new Set(searchDocuments).size).toBe(5);
    expect(
      requests
        .filter((request) => request.path === '/threads/search')
        .map(({ method, payload }) => ({ method, payload }))
    ).toEqual([
      { method: 'POST', payload: { limit: 50, offset: 0 } },
      { method: 'POST', payload: { limit: 50, offset: 0 } },
      { method: 'POST', payload: { limit: 50, offset: 0 } },
      { method: 'POST', payload: { limit: 50, offset: 0 } },
      { method: 'POST', payload: { limit: 50, offset: 0 } },
    ]);
    for (const sentinel of [key, clientSecret, target])
      expect(logs.join('\n')).not.toContain(sentinel);
    evidence.frozenCleanup = true;
    evidence.processGroupsGone = [...groups];
  } finally {
    // Preserve sources if the supervisor cannot confirm descendant cleanup.
    try {
      await supervisor?.close();
    } finally {
      upstreamCleanup = true;
      if (upstream.listening) await closeServer(upstream);
      writeFileSync(
        testInfo.outputPath('supervisor.log'),
        logs.join('\n') + '\n'
      );
      evidence.originalInputsUnchanged = isDeepStrictEqual(
        inputFingerprint(workspace),
        original
      );
      evidence.originalInputFiles = Object.keys(original).length;
      writeFileSync(
        testInfo.outputPath('evidence.json'),
        JSON.stringify(evidence, null, 2)
      );
      expect(evidence.originalInputsUnchanged).toBe(true);
      if (
        (!supervisor || !existsSync(supervisor.temporary)) &&
        readdirSync(generations).length === 0
      )
        rmSync(owned, { recursive: true, force: true });
    }
  }
});
