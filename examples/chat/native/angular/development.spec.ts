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
    angularAbort: {
      controller: AbortController;
      received: string;
      outcome: string;
    };
  }
}

const workspace = resolve(__dirname, '../../../../');
const native = 'examples/chat/native/angular';
const key = 'owned-angular-proxy-key-sentinel';
const secret = 'owned-angular-browser-secret-sentinel';
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
const host = (wrong: boolean) => `import {Component} from '@angular/core';
import {MarkdownComponent} from '@threadplane/angular/markdown';
@Component({selector:'owned-negative',standalone:true,imports:[MarkdownComponent],template:\`<threadplane-markdown [snapshot]="${
  wrong ? 'value' : 'snapshot'
}" />\`})
export class OwnedNegative { readonly value='bad'; readonly snapshot = null! as import('@threadplane/content/markdown').MarkdownSnapshot; }\n`;
function installation(temporary: string, consumer: string) {
  const artifacts: Record<string, string> = {};
  function inventory(directory: string) {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      assert.equal(lstatSync(path).isSymbolicLink(), false);
      if (statSync(path).isDirectory()) inventory(path);
      else artifacts[relative(consumer, path)] = hash(path);
    }
  }
  for (const name of ['core', 'content', 'angular', 'langgraph'])
    inventory(join(consumer, 'node_modules/@threadplane', name));
  const archives = readdirSync(temporary)
    .filter((file) => file.endsWith('.tgz'))
    .sort();
  expect(archives).toHaveLength(4);
  return {
    artifacts,
    lock: hash(join(consumer, 'package-lock.json')),
    archives: Object.fromEntries(
      archives.map((file) => [
        file,
        {
          hash: hash(join(temporary, file)),
          mtime: statSync(join(temporary, file)).mtimeMs,
        },
      ])
    ),
  };
}

test('Angular development: live edits, template graph, proxy abort, restart boundaries and owned lifetime', async ({
  page,
}, testInfo) => {
  const { buildInputRoots, inputFingerprint } = await import(
    '../tooling/consumer.mjs'
  );
  const { excludedSourcePath } = await import('../tooling/source-policy.mjs');
  const original = inputFingerprint(
    workspace,
    buildInputRoots(workspace, 'angular')
  );
  const owned = realpathSync(
    mkdtempSync(join(tmpdir(), 'native-angular-development-'))
  );
  const root = join(owned, 'sources'),
    generations = join(owned, 'generations');
  mkdirSync(root);
  mkdirSync(generations);
  const logs: string[] = [],
    groups = new Set<number>();
  const baselineSignals = [
    process.listenerCount('SIGINT'),
    process.listenerCount('SIGTERM'),
  ];
  const evidence: Record<string, unknown> = { owned };
  const requests: {
    path: string;
    method?: string;
    body: string;
    authenticated: boolean;
    responseClosed: boolean;
    socketClosed: boolean;
  }[] = [];
  let cleaningUpstream = false;
  const upstream = http.createServer(async (request, response) => {
    const record = {
      path: request.url ?? '',
      method: request.method,
      body: '',
      authenticated: request.headers['x-api-key'] === key,
      responseClosed: false,
      socketClosed: false,
    };
    requests.push(record);
    response.once('close', () => {
      record.responseClosed = !cleaningUpstream;
    });
    request.socket.once('close', () => {
      record.socketClosed = !cleaningUpstream;
    });
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    record.body = Buffer.concat(chunks).toString();
    if (
      record.path === '/threads/search' ||
      record.path === '/threads/owned/history'
    )
      response.writeHead(200, { 'content-type': 'application/json' }).end('[]');
    else if (record.path === '/threads/owned/runs/stream') {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: owned-stream-open\n\n');
    } else if (record.path !== '/threads/held/history')
      response.writeHead(404).end();
  });
  let supervisor:
    | ReturnType<typeof import('../tooling/serve.mjs').startServe>
    | undefined;
  try {
    for (const local of buildInputRoots(workspace, 'angular')) {
      const source = join(workspace, local);
      if (!existsSync(source)) continue;
      mkdirSync(dirname(join(root, local)), { recursive: true });
      cpSync(source, join(root, local), {
        recursive: true,
        filter: (path) => {
          if (excludedSourcePath(relative(workspace, path))) return false;
          assert.equal(lstatSync(path).isSymbolicLink(), false);
          return true;
        },
      });
    }
    symlinkSync(
      realpathSync(join(workspace, 'node_modules')),
      join(root, 'node_modules'),
      'dir'
    );
    const source = join(root, native, 'src');
    const initialAsset = join(root, native, 'public/owned/existing.txt');
    mkdirSync(dirname(initialAsset), { recursive: true });
    writeFileSync(initialAsset, 'owned initial Angular asset');
    const main = join(source, 'main.ts');
    writeFileSync(
      main,
      readFileSync(main, 'utf8') + "\nimport './owned-imported';\n"
    );
    writeFileSync(join(source, 'owned-imported.ts'), host(false));
    writeFileSync(join(source, 'owned-unimported.ts'), host(false));
    const target = `http://127.0.0.1:${await listen(upstream)}`;
    const { startServe } = await import(
      pathToFileURL(join(root, 'examples/chat/native/tooling/serve.mjs')).href
    );
    const launch = async (port?: number, signal?: AbortSignal) => {
      if (port === undefined) {
        const reservation = http.createServer();
        port = await listen(reservation);
        await closeServer(reservation);
      }
      const started = startServe({
        root,
        temporaryParent: generations,
        options: {
          framework: 'angular',
          configuration: 'development',
          assistantId: 'owned-angular-assistant',
          port,
        },
        env: {
          ...process.env,
          NATIVE_LANGGRAPH_URL: target,
          NATIVE_LANGGRAPH_API_KEY: key,
          VITE_SECRET: secret,
        },
        signal,
        log: (line: string) => logs.push(line),
        killProcessGroup(pid: number, signal: NodeJS.Signals | number) {
          groups.add(pid);
          process.kill(pid, signal);
        },
      });
      supervisor = started;
      void started.closed.catch((error: Error) =>
        logs.push('Supervisor failed: ' + error.message)
      );
      return started;
    };
    const stopped = async (started: typeof supervisor, url?: string) => {
      expect(existsSync(started!.temporary)).toBe(false);
      if (url)
        await expect(
          fetch(url, { signal: AbortSignal.timeout(2000) })
        ).rejects.toThrow();
      for (const group of groups)
        assert.throws(() => process.kill(group, 0), { code: 'ESRCH' });
      expect(readdirSync(generations)).toEqual([]);
      expect([
        process.listenerCount('SIGINT'),
        process.listenerCount('SIGTERM'),
      ]).toEqual(baselineSignals);
    };
    const first = await launch();
    const ready = await first.ready;
    const before = installation(first.temporary, ready.consumer);
    const bodies: string[] = [],
      pending: Promise<void>[] = [],
      browserRequests: {
        url: string;
        headers: Record<string, string>;
        body: string | null;
      }[] = [];
    page.on('response', (response) => {
      if (
        response.url().startsWith(ready.url) &&
        !response.url().includes('/api/')
      )
        pending.push(
          response
            .text()
            .then((body) => {
              bodies.push(body);
            })
            .catch(() => {})
        );
    });
    page.on('request', (request) =>
      browserRequests.push({
        url: request.url(),
        headers: request.headers(),
        body: request.postData(),
      })
    );
    await page.goto(ready.url);
    await expect(
      page.getByRole('heading', { name: 'Loaded conversations' })
    ).toBeVisible();
    await expect(
      page.getByText('No loaded conversations match.')
    ).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      path: '/threads/search',
      method: 'POST',
      body: '{"limit":50,"offset":0}',
      authenticated: true,
    });
    expect(
      await page.evaluate(async () =>
        (await fetch('/assets/owned/existing.txt')).text()
      )
    ).toBe('owned initial Angular asset');
    writeFileSync(initialAsset, 'owned edited Angular asset');
    await expect
      .poll(() =>
        page.evaluate(async () =>
          (await fetch('/assets/owned/existing.txt')).text()
        )
      )
      .toBe('owned edited Angular asset');
    const app = join(source, 'app.component.ts'),
      originalApp = readFileSync(app, 'utf8');
    mkdirSync(join(source, 'owned'));
    const marker = join(source, 'owned/marker.ts');
    writeFileSync(marker, 'export const marker = "owned first marker";\n');
    writeFileSync(
      app,
      "import { marker } from './owned/marker';\n" +
        originalApp
          .replace(
            '<main>',
            '<main><output data-testid="marker">{{ marker }}</output>'
          )
          .replace(
            'export class AppComponent {',
            'export class AppComponent { readonly marker = marker;'
          )
    );
    await expect(page.getByTestId('marker')).toHaveText('owned first marker');
    const atomic = join(source, 'owned/.atomic');
    writeFileSync(atomic, 'export const marker = "owned atomic marker";\n');
    renameSync(atomic, marker);
    await expect(page.getByTestId('marker')).toHaveText('owned atomic marker');
    const styles = join(source, 'styles.css');
    writeFileSync(
      styles,
      readFileSync(styles, 'utf8') +
        '\nmain { background-color: rgb(1, 2, 3); }\n'
    );
    await expect(page.locator('main')).toHaveCSS(
      'background-color',
      'rgb(1, 2, 3)'
    );
    writeFileSync(
      app,
      readFileSync(app, 'utf8').replace(
        'Native conversation',
        'Owned Angular template edit'
      )
    );
    await expect(
      page.getByText('Owned Angular template edit', { exact: true })
    ).toBeVisible();
    {
      let start = logs.length;
      const renamed = join(dirname(marker), 'renamed.ts');
      renameSync(marker, renamed);
      await expect.poll(() => logs.slice(start).join('\n')).toMatch(/TS2307/);
      start = logs.length;
      renameSync(renamed, marker);
      await expect
        .poll(() => logs.slice(start).join('\n'))
        .toMatch(/Compilation complete\. Watching for file changes\./);
      await expect(page.getByTestId('marker')).toHaveText(
        'owned atomic marker'
      );
      evidence.liveRenameRecovery = true;
    }
    for (const kind of ['imported', 'unimported', 'added']) {
      const file = join(source, 'owned-' + kind + '.ts');
      let start = logs.length;
      writeFileSync(file, host(true));
      await expect.poll(() => logs.slice(start).join('\n')).toMatch(/TS2322/);
      await expect
        .poll(() => logs.slice(start).join('\n'))
        .toContain('owned-' + kind + '.ts');
      expect(logs.slice(start).join('\n')).not.toMatch(
        /Cannot find module|NG8001|NG8002/
      );
      start = logs.length;
      if (kind === 'added') rmSync(file);
      else writeFileSync(file, host(false));
      await expect
        .poll(() => logs.slice(start).join('\n'))
        .toMatch(/Compilation complete\. Watching for file changes\./);
    }
    for (const path of ['/threads/search', '/threads/owned/history']) {
      expect(
        await page.evaluate(
          async (path) =>
            (
              await fetch('/api' + path, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ limit: 1 }),
              })
            ).json(),
          path
        )
      ).toEqual([]);
    }
    for (const path of [
      '/threads/held/history',
      '/threads/owned/runs/stream',
    ]) {
      await page.evaluate((path) => {
        const controller = new AbortController();
        const state = { controller, received: '', outcome: '' };
        Object.assign(window, { angularAbort: state });
        void (async () => {
          try {
            const response = await fetch('/api' + path, {
              method: 'POST',
              body: '{}',
              signal: controller.signal,
            });
            const reader = response.body!.getReader();
            for (;;) {
              const part = await reader.read();
              if (part.done) break;
              state.received += new TextDecoder().decode(part.value);
            }
          } catch (error) {
            state.outcome = (error as Error).name;
          }
        })();
      }, path);
      await expect
        .poll(() => requests.some((record) => record.path === path))
        .toBe(true);
      if (path.endsWith('/stream'))
        await expect
          .poll(() => page.evaluate(() => window.angularAbort.received))
          .toContain('owned-stream-open');
      expect(requests.find((record) => record.path === path)).toMatchObject({
        authenticated: true,
        responseClosed: false,
        socketClosed: false,
      });
      await page.evaluate(() => window.angularAbort.controller.abort());
      await expect
        .poll(
          () => requests.find((record) => record.path === path)?.responseClosed
        )
        .toBe(true);
      await expect
        .poll(
          () => requests.find((record) => record.path === path)?.socketClosed
        )
        .toBe(true);
      await expect
        .poll(() => page.evaluate(() => window.angularAbort.outcome))
        .toBe('AbortError');
    }
    // Full browser reloads create a fresh real owner and one bounded search.
    // Match every forwarded owner request to its actual browser request; the
    // four explicit fetch fixtures below remain separate proxy-only evidence.
    const ownerBody = '{"limit":50,"offset":0}';
    const ownerRequests = requests.filter(
      (record) => record.path === '/threads/search' && record.body === ownerBody
    );
    expect(ownerRequests.length).toBeGreaterThanOrEqual(1);
    expect(ownerRequests.length).toBe(
      browserRequests.filter(
        (record) =>
          new URL(record.url).pathname === '/api/threads/search' &&
          record.body === ownerBody
      ).length
    );
    expect(
      requests
        .filter((record) => !ownerRequests.includes(record))
        .map(({ path, method, body }) => ({ path, method, body }))
    ).toEqual([
      { path: '/threads/search', method: 'POST', body: '{"limit":1}' },
      { path: '/threads/owned/history', method: 'POST', body: '{"limit":1}' },
      { path: '/threads/held/history', method: 'POST', body: '{}' },
      { path: '/threads/owned/runs/stream', method: 'POST', body: '{}' },
    ]);
    expect(
      requests.every(
        (record) => record.authenticated && record.method === 'POST'
      )
    ).toBe(true);
    expect(installation(first.temporary, ready.consumer)).toEqual(before);
    await Promise.all(pending);
    for (const sentinel of [key, secret, target])
      expect(
        [
          readFileSync(
            join(ready.consumer, 'shared/browser-config.json'),
            'utf8'
          ),
          readFileSync(
            join(ready.consumer, 'angular/.native-proxy.json'),
            'utf8'
          ),
          JSON.stringify(browserRequests),
          ...bodies,
          ...logs,
        ].join('\n')
      ).not.toContain(sentinel);
    evidence.installation = before;
    evidence.requests = requests;
    evidence.ownerSearchesBeforeRestart = ownerRequests.length;
    await page.screenshot({
      path: testInfo.outputPath('angular-development-recovered.png'),
    });
    // Angular's installed server watches resolved asset files, not additions to
    // the asset glob. Existing assets update live; new static assets need restart.
    const asset = join(root, native, 'public/owned/nested.txt');
    writeFileSync(asset, 'owned Angular asset');
    await expect
      .poll(() =>
        existsSync(join(ready.consumer, 'angular/public/owned/nested.txt'))
      )
      .toBe(true);
    const assetBeforeRestart = await page.evaluate(async () => {
      const response = await fetch('/assets/owned/nested.txt');
      return { status: response.status, body: await response.text() };
    });
    expect([200, 404]).toContain(assetBeforeRestart.status);
    if (assetBeforeRestart.status === 200)
      expect(assetBeforeRestart.body).toBe('owned Angular asset');
    evidence.assetBeforeRestart = assetBeforeRestart;
    // The locked CLI caches a deleted module's resolution failure after
    // recreation, independently reproduced without this mirror. ngc recovers;
    // a fresh generation is the supported recovery boundary for the server.
    let deletionStart = logs.length;
    rmSync(marker);
    await expect
      .poll(() => logs.slice(deletionStart).join('\n'))
      .toMatch(/Application bundle generation failed/);
    await expect
      .poll(() => logs.slice(deletionStart).join('\n'))
      .toMatch(/TS2307/);
    deletionStart = logs.length;
    writeFileSync(
      marker,
      'export const marker = "owned restored after restart";\n'
    );
    await expect
      .poll(() => logs.slice(deletionStart).join('\n'))
      .toMatch(/Compilation complete\. Watching for file changes\./);
    expect(installation(first.temporary, ready.consumer)).toEqual(before);
    evidence.restorationDiagnosticsBeforeRestart = logs
      .slice(deletionStart)
      .join('\n');
    await first.close();
    await first.closed;
    await stopped(first, ready.url);
    evidence.normalCleanup = true;

    const second = await launch();
    const secondReady = await second.ready;
    await page.goto(secondReady.url);
    await expect(page.getByTestId('marker')).toHaveText(
      'owned restored after restart'
    );
    evidence.deletedModuleRestartVerified = true;
    expect(
      await page.evaluate(async () =>
        (await fetch('/assets/owned/nested.txt')).text()
      )
    ).toBe('owned Angular asset');
    evidence.newStaticAssetRestartVerified = true;
    const frozen = join(root, native, 'angular.json');
    writeFileSync(frozen, readFileSync(frozen, 'utf8') + '\n');
    await expect(second.closed).rejects.toThrow(
      /Frozen development inputs changed.*restart/
    );
    await stopped(second, secondReady.url);
    evidence.frozenConfigCleanup = true;

    const occupied = http.createServer((_request, response) =>
      response.end('owned listener survives')
    );
    const port = await listen(occupied);
    try {
      const failed = await launch(port);
      await expect(failed.ready).rejects.toThrow(
        /Angular CLI exited unexpectedly/
      );
      await expect(failed.closed).rejects.toThrow(
        /Angular CLI exited unexpectedly/
      );
      await stopped(failed);
      expect(await (await fetch(`http://127.0.0.1:${port}`)).text()).toBe(
        'owned listener survives'
      );
      evidence.occupiedPortCleanup = true;
    } finally {
      await closeServer(occupied);
    }

    const controller = new AbortController();
    const start = logs.length;
    const cancelled = await launch(undefined, controller.signal);
    await expect
      .poll(() => logs.slice(start).join('\n'))
      .toContain('Building core from frozen inputs');
    controller.abort();
    await expect(cancelled.ready).rejects.toThrow(/aborted/);
    await cancelled.closed;
    await stopped(cancelled);
    evidence.startupCancellationCleanup = true;
    evidence.processGroupsGone = [...groups];
  } finally {
    try {
      await supervisor?.close();
    } finally {
      cleaningUpstream = true;
      if (upstream.listening) await closeServer(upstream);
      evidence.originalInputsUnchanged = isDeepStrictEqual(
        inputFingerprint(workspace, buildInputRoots(workspace, 'angular')),
        original
      );
      writeFileSync(
        testInfo.outputPath('supervisor.log'),
        logs.join('\n') + '\n'
      );
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
