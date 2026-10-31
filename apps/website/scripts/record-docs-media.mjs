/**
 * Films current cockpit applications, with repository fixtures driving the real
 * LangGraph service. Requires existing builds, Playwright, Python environment and
 * ffmpeg. Never reads a provider key or publishes to a remote store.
 *
 * node apps/website/scripts/record-docs-media.mjs [streaming|persistence|tools|ui] [angular|react]
 */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { LLMock } from 'aimock';
import { encodeDocsMedia } from './encode-docs-media.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const runId = new Date().toISOString().replaceAll(':', '-');
const work = join(root, 'dist/docs-media', runId);
mkdirSync(work, { recursive: true });
const definitions = {
  streaming: {
    topic: 'streaming',
    prompt: 'Tell me one quick fact about Angular signals in two sentences.',
    answer: 'Angular signals are a reactive primitive',
  },
  persistence: {
    topic: 'persistence',
    prompt: 'Hello',
    answer: 'how can I help you today?',
  },
  tools: {
    topic: 'client-tools',
    prompt: "What's the weather in San Francisco?",
    answer: 'sunny in San Francisco',
  },
  ui: { topic: 'spec-rendering' },
};
const selected = process.argv[2] ? [process.argv[2]] : Object.keys(definitions);
const frontends = process.argv[3] ? [process.argv[3]] : ['angular', 'react'];
assert(
  selected.every((id) => Object.hasOwn(definitions, id)),
  'Unknown lesson'
);
assert(
  frontends.every((id) => ['angular', 'react'].includes(id)),
  'Unknown frontend'
);
const hash = (file) =>
  createHash('sha256').update(readFileSync(file)).digest('hex');
function files(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
const sourceFiles = [
  'apps/website/scripts/record-docs-media.mjs',
  'apps/website/scripts/encode-docs-media.mjs',
  'libs/example-layouts/src/lib/install-embedded-theme.ts',
];
const mock = new LLMock({ port: 0, chunkSize: 12, latency: 100 });
for (const topic of ['streaming', 'persistence', 'client-tools']) {
  const fixture = `cockpit/langgraph/${topic}/angular/e2e/fixtures/${topic}.json`;
  mock.addFixturesFromJSON(
    JSON.parse(readFileSync(join(root, fixture), 'utf8')).fixtures
  );
  sourceFiles.push(fixture, `cockpit/langgraph/${topic}/python/src/graph.py`);
}
let backend;
let browser;
let appServer;
const graphPort = 5739;
const appPort = 4739;
const log = join(work, 'langgraph.log');
async function ready(url) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* Wait for owned process. */
    }
    if (backend?.exitCode !== null && backend?.exitCode !== undefined)
      throw Error(`LangGraph exited; inspect ${log}`);
    await new Promise((done) => setTimeout(done, 500));
  }
  throw Error(`Server did not become ready: ${url}`);
}
async function serve(directory, base) {
  const requests = [];
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname.startsWith('/api/')) {
      requests.push({ method: request.method, path: pathname });
      const upstream = httpRequest(
        {
          hostname: '127.0.0.1',
          port: graphPort,
          path: request.url.slice(4),
          method: request.method,
          headers: { ...request.headers, host: `127.0.0.1:${graphPort}` },
        },
        (incoming) => {
          response.writeHead(incoming.statusCode, incoming.headers);
          incoming.pipe(response);
        }
      );
      upstream.on('error', () => {
        response.writeHead(502);
        response.end();
      });
      request.pipe(upstream);
      response.on('close', () => upstream.destroy());
      return;
    }
    const local = pathname.startsWith(base)
      ? pathname.slice(base.length)
      : pathname.slice(1);
    const file = resolve(directory, local || 'index.html');
    if (!file.startsWith(directory + '/')) {
      response.writeHead(404);
      response.end();
      return;
    }
    try {
      const content = readFileSync(file);
      response.writeHead(200, {
        'content-type':
          {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.svg': 'image/svg+xml',
          }[extname(file)] ?? 'application/octet-stream',
      });
      response.end(content);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((done) => server.listen(appPort, '127.0.0.1', done));
  return { server, requests };
}

try {
  await mock.start();
  if (selected.some((id) => id !== 'ui')) {
    const config = join(work, 'langgraph.json');
    writeFileSync(
      config,
      JSON.stringify({
        graphs: Object.fromEntries(
          ['streaming', 'persistence', 'client-tools'].map((topic) => [
            topic,
            join(root, `cockpit/langgraph/${topic}/python/src/graph.py`) +
              ':graph',
          ])
        ),
        dependencies: [join(root, 'examples/chat/python')],
        python_version: '3.12',
      })
    );
    // A deliberately closed environment: no inherited provider or tracing keys.
    const environment = Object.fromEntries(
      ['PATH', 'HOME', 'TMPDIR', 'LANG']
        .filter((key) => process.env[key])
        .map((key) => [key, process.env[key]])
    );
    backend = spawn(
      join(root, 'examples/chat/python/.venv/bin/langgraph'),
      [
        'dev',
        '--config',
        config,
        '--port',
        String(graphPort),
        '--host',
        '127.0.0.1',
        '--no-browser',
        '--no-reload',
      ],
      {
        cwd: work,
        env: {
          ...environment,
          OPENAI_BASE_URL: `${mock.url}/v1`,
          OPENAI_API_KEY: 'fixture-only',
          LANGSMITH_TRACING: 'false',
          LANGCHAIN_TRACING_V2: 'false',
          PYTHONDONTWRITEBYTECODE: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      }
    );
    let output = '';
    const recordLog = (bytes) => {
      output += bytes.toString();
      writeFileSync(log, output);
    };
    backend.stdout.on('data', recordLog);
    backend.stderr.on('data', recordLog);
    await ready(`http://127.0.0.1:${graphPort}/ok`);
  }
  browser = await chromium.launch();
  for (const demo of selected)
    for (const frontend of frontends) {
      const definition = definitions[demo];
      const product = demo === 'ui' ? 'render' : 'langgraph';
      const appPath = `cockpit/${product}/${definition.topic}/${frontend}`;
      const directory = join(root, 'dist', appPath);
      const base =
        frontend === 'react' ? `/${product}/${definition.topic}/react/` : '/';
      const serving = await serve(directory, base);
      appServer = serving.server;
      const id = `${demo}-${frontend}`;
      const captureDir = join(work, id);
      mkdirSync(captureDir);
      const context = await browser.newContext({
        viewport: { width: 640, height: 640 },
        deviceScaleFactor: 1,
        colorScheme: 'light',
        recordVideo: { dir: captureDir, size: { width: 640, height: 640 } },
      });
      const started = Date.now();
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      try {
        await page.goto(`http://127.0.0.1:${appPort}${base}`);
        const input =
          frontend === 'react'
            ? page.getByLabel('Message', { exact: true })
            : page.getByRole('textbox', {
                name: /type a message|message|prompt/i,
              });
        if (demo !== 'ui') await expect(input).toBeVisible();
        else
          await expect(
            page.getByRole('button', {
              name: frontend === 'react' ? 'Play' : 'Play or pause',
              exact: true,
            })
          ).toBeVisible();
        if (frontend === 'angular') {
          // The same supported theme message as the real docs/cockpit host.
          // The application's own bridge applies its ordinary light tokens.
          await page.evaluate(() =>
            window.postMessage(
              { type: 'tplane:theme', theme: 'light' },
              window.location.origin
            )
          );
          await expect(page.locator('html')).toHaveAttribute(
            'data-theme',
            'light'
          );
        }
        const trimStart = (Date.now() - started) / 1000;
        const phases = [];
        const phase = (text) =>
          phases.push({
            time: (Date.now() - started) / 1000 - trimStart,
            text,
          });
        phase(
          demo === 'ui' ? 'Play the local JSON sample.' : 'Send a message.'
        );
        await page.waitForTimeout(1800);
        if (demo === 'ui') {
          await page
            .getByRole('button', {
              name: frontend === 'react' ? 'Play' : 'Play or pause',
              exact: true,
            })
            .click();
          if (frontend === 'react') {
            await expect(
              page.getByRole('heading', {
                name: 'Welcome to React Spec Rendering',
                exact: true,
              })
            ).toBeVisible();
            await page
              .getByRole('button', { name: 'Pause', exact: true })
              .click();
            await expect(page.getByRole('status')).toContainText('Paused');
            phase('Inspect the partial render.');
            await page.screenshot({ path: join(captureDir, 'partial.png') });
            await page.waitForTimeout(3000);
            await page
              .getByRole('button', { name: 'Finish', exact: true })
              .click();
            await expect(page.getByRole('status')).toContainText('Complete');
          } else {
            phase('Partial JSON becomes components.');
            await page.waitForTimeout(4200);
            await expect(page.locator('.json__foot .state')).toHaveText(
              'Complete',
              { timeout: 30000 }
            );
          }
          // Chromium may stop emitting screencast frames after the last animation
          // tick. A normal screenshot flushes the real completed paint before the
          // reading hold; it does not inject or replace any recorded video frame.
          await page.screenshot({ path: join(captureDir, 'complete.png') });
          phase('Inspect the complete render.');
          await page.waitForTimeout(8000);
        } else {
          await input.pressSequentially(definition.prompt, { delay: 20 });
          phase(
            demo === 'tools'
              ? 'The browser runs the weather tool.'
              : 'Read the arriving response.'
          );
          await page
            .getByRole('button', { name: /^Send(?: message)?$/i })
            .click();
          const conversation =
            frontend === 'react'
              ? page.getByRole('region', { name: 'Conversation', exact: true })
              : page.locator('chat-message[data-role="assistant"]').last();
          await expect(conversation).toContainText(definition.answer, {
            timeout: 45000,
          });
          if (frontend === 'react')
            await expect(page.getByRole('status')).toHaveText(
              'Response complete.',
              { timeout: 30000 }
            );
          else
            await expect(
              page.locator('chat-message[data-role="assistant"]').last()
            ).toHaveAttribute('data-streaming', 'false', { timeout: 30000 });
          await page.waitForTimeout(2500);
          if (demo === 'persistence') {
            phase('Start a new conversation.');
            await page
              .getByRole('button', {
                name:
                  frontend === 'react' ? 'New conversation' : '+ New Thread',
                exact: true,
              })
              .click();
            if (frontend === 'react') await expect(conversation).toHaveText('');
            else
              await expect(
                page.locator('chat-message[data-role="assistant"]')
              ).toHaveCount(0);
            await page.waitForTimeout(2500);
            phase('Select the saved conversation.');
            await page
              .getByRole('button', {
                name: frontend === 'react' ? 'Conversation 1' : 'Thread 1',
                exact: true,
              })
              .click();
            await expect(conversation).toContainText(definition.answer, {
              timeout: 20000,
            });
            await page.waitForTimeout(4500);
          } else {
            phase(
              demo === 'tools'
                ? 'The returned result completes the turn.'
                : 'The response is complete.'
            );
            await page.waitForTimeout(5000);
          }
        }
        const trimEnd = (Date.now() - started) / 1000;
        await page.screenshot({ path: join(captureDir, 'result.png') });
        const finalText = await page.locator('body').innerText();
        assert.deepEqual(errors, [], 'No browser errors may be published');
        const raw = await page.video().path();
        await context.close();
        const sources = [
          ...sourceFiles,
          ...files(join(root, appPath, 'src'))
            .filter((file) => !file.includes('.spec.'))
            .map((file) => relative(root, file)),
        ];
        const metadata = {
          version: 1,
          id,
          demo,
          frontend,
          recordedAt: new Date().toISOString(),
          sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: root,
            encoding: 'utf8',
          }).trim(),
          sourceTreeDirty:
            execFileSync('git', ['status', '--porcelain'], {
              cwd: root,
              encoding: 'utf8',
            }).trim().length > 0,
          sourceKind:
            demo === 'ui' ? 'authored-local-json' : 'fixture-backed-langgraph',
          sourceDescription:
            demo === 'ui'
              ? 'Actual framework renderer playing the existing authored JSON sample; no model or backend.'
              : 'Actual framework app and LangGraph runtime; existing aimock responses, 12-character chunks with 100ms fixture delay. No live provider requests.',
          input:
            definition.prompt ??
            (frontend === 'react'
              ? 'Play the first authored sample, pause at its heading, then Finish.'
              : 'Play the first authored sample.'),
          viewport: { width: 640, height: 640 },
          theme:
            frontend === 'angular'
              ? {
                  mode: 'light',
                  mechanism: 'existing tplane:theme host message',
                }
              : { mode: 'light', mechanism: 'native application stylesheet' },
          edits: { trimStart, trimEnd, speed: 1 },
          phases,
          finalText,
          requests: serving.requests,
          sourceHashes: Object.fromEntries(
            sources.map((file) => [file, hash(join(root, file))])
          ),
          buildHashes: Object.fromEntries(
            files(directory).map((file) => [relative(root, file), hash(file)])
          ),
          rawSha256: hash(raw),
          reproduction: `node apps/website/scripts/record-docs-media.mjs ${demo} ${frontend}`,
        };
        writeFileSync(
          join(captureDir, 'capture.json'),
          JSON.stringify(metadata, null, 2)
        );
        encodeDocsMedia({ root, raw, captureDir, metadata });
        console.log(`Recorded ${id}: ${(trimEnd - trimStart).toFixed(2)}s`);
      } catch (error) {
        await page
          .screenshot({ path: join(captureDir, 'failure.png') })
          .catch(() => undefined);
        if (!page.isClosed())
          console.error(
            await page
              .locator('body')
              .innerText()
              .catch(() => 'Page unavailable')
          );
        await context.close().catch(() => undefined);
        throw error;
      } finally {
        await new Promise((done) => appServer.close(done));
        appServer = undefined;
      }
    }
} finally {
  await browser?.close();
  appServer?.close();
  if (backend && backend.exitCode === null) {
    try {
      process.kill(-backend.pid, 'SIGTERM');
    } catch {
      /* Already stopped. */
    }
  }
  await mock.stop();
}
