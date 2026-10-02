/** Local browser proof server. Never assembled into a public deployment. */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reactCockpitConfiguration } from './configuration.mjs';
import { createInterruptsFixture } from './interrupts-fixture.mjs';
import { createMemoryFixture } from './memory-fixture.mjs';
import { createClientToolsFixture } from './client-tools-fixture.mjs';
import { createPersistenceFixture } from './persistence-fixture.mjs';
import { createDurableFixture } from './durable-fixture.mjs';
import { createSubgraphsFixture } from './subgraphs-fixture.mjs';
import { createTimeTravelFixture } from './time-travel-fixture.mjs';
import { createDeploymentRuntimeFixture } from './deployment-runtime-fixture.mjs';
import { createAgUiStreamingFixture } from './ag-ui-streaming-fixture.mjs';

const configuration = reactCockpitConfiguration(process.argv[2]);
const agUiStreamingFixture =
  configuration.adapter === 'ag-ui' ? createAgUiStreamingFixture() : null;
const deploymentRuntimeFixture =
  configuration.topic === 'deployment-runtime'
    ? createDeploymentRuntimeFixture()
    : null;
const timeTravelFixture =
  configuration.topic === 'time-travel' ? createTimeTravelFixture() : null;
const subgraphsFixture =
  configuration.topic === 'subgraphs' ? createSubgraphsFixture() : null;
const durableFixture =
  configuration.topic === 'durable-execution' ? createDurableFixture() : null;
const persistenceFixture =
  configuration.topic === 'persistence' ? createPersistenceFixture() : null;
const interruptsFixture =
  configuration.topic === 'interrupts' ? createInterruptsFixture() : null;
const memoryFixture =
  configuration.topic === 'memory' ? createMemoryFixture() : null;
const clientToolsFixture =
  configuration.topic === 'client-tools' ? createClientToolsFixture() : null;

const root = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../dist/' + configuration.appPath
);
let requests = [];
let held;
let finishHeld;
let failCreation = false;
const event = (type, data) =>
  `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
const json = (response, value, status = 200) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
};
const release = () => {
  if (!held) return;
  held.write(
    event('messages', [
      { type: 'AIMessageChunk', id: 'answer-1', content: ' complete' },
      { langgraph_node: 'generate' },
    ])
  );
  finishHeld?.();
  held.end();
  held = undefined;
};
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (
    agUiStreamingFixture &&
    (await agUiStreamingFixture(request, response, pathname))
  )
    return;
  if (
    deploymentRuntimeFixture &&
    (await deploymentRuntimeFixture(request, response, pathname))
  )
    return;
  if (
    timeTravelFixture &&
    (await timeTravelFixture(request, response, pathname))
  )
    return;
  if (subgraphsFixture && (await subgraphsFixture(request, response, pathname)))
    return;
  if (durableFixture && (await durableFixture(request, response, pathname)))
    return;
  if (
    persistenceFixture &&
    (await persistenceFixture(request, response, pathname))
  )
    return;
  if (
    clientToolsFixture &&
    (await clientToolsFixture(request, response, pathname))
  )
    return;
  if (memoryFixture && (await memoryFixture(request, response, pathname)))
    return;
  if (
    interruptsFixture &&
    (await interruptsFixture(request, response, pathname))
  )
    return;
  if (pathname === '/__reset') {
    held?.end();
    held = undefined;
    requests = [];
    failCreation = false;
    return json(response, {});
  }
  if (pathname === '/__release') {
    release();
    return json(response, {});
  }
  if (pathname === '/__requests') return json(response, requests);
  if (pathname === '/__lifetime')
    return json(response, { active: Boolean(held) });
  if (pathname === '/__fail-create') {
    failCreation = true;
    return json(response, {});
  }
  if (pathname.startsWith('/api/') || pathname.startsWith('/developer-api/')) {
    let input = '';
    for await (const chunk of request) input += chunk;
    const body = input ? JSON.parse(input) : {};
    requests.push({
      path: pathname,
      method: request.method,
      body,
      key: request.headers['x-api-key'] ?? null,
    });
    if (pathname.endsWith('/threads')) {
      if (failCreation) {
        failCreation = false;
        return json(response, { error: 'PRIVATE creation response' }, 500);
      }
      return json(response, { thread_id: body.thread_id });
    }
    if (pathname.endsWith('/runs/stream')) {
      const text = body.input.messages.at(-1).content;
      if (text === 'Error')
        return json(response, { error: 'PRIVATE response' }, 500);
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'content-location': `/threads/${
          pathname.split('/')[3]
        }/runs/00000000-0000-0000-0000-000000000001`,
      });
      response.write(
        event('metadata', { run_id: '00000000-0000-0000-0000-000000000001' })
      );
      response.write(event('values', { messages: body.input.messages }));
      response.write(
        event('messages', [
          {
            type: 'AIMessageChunk',
            id: text === 'Second' ? 'answer-2' : 'answer-1',
            content:
              text === 'Literal'
                ? '<script>private markup</script>'
                : text === 'First'
                ? 'Live partial'
                : 'Second answer',
          },
          { langgraph_node: 'generate' },
        ])
      );
      const answer = {
        type: 'ai',
        id: text === 'Second' ? 'answer-2' : 'answer-1',
        content:
          text === 'Literal'
            ? '<script>private markup</script>'
            : text === 'First'
            ? 'Live partial complete'
            : 'Second answer',
      };
      const finish = () =>
        response.write(
          event('values', { messages: [...body.input.messages, answer] })
        );
      if (text === 'First') {
        held = response;
        finishHeld = finish;
        response.on('close', () => {
          if (held === response) held = undefined;
        });
      } else {
        finish();
        response.end();
      }
      return;
    }
    if (pathname.endsWith('/cancel')) {
      held?.end();
      held = undefined;
      return json(response, {});
    }
    if (request.method === 'GET' && /\/runs\/[^/]+$/.test(pathname)) {
      return json(response, {
        run_id: '00000000-0000-0000-0000-000000000001',
        thread_id: pathname.split('/')[3],
        status: 'success',
      });
    }
    return json(response, {});
  }
  if (pathname === '/') {
    if (request.headers.host?.endsWith(':' + configuration.port)) {
      response.writeHead(302, { location: configuration.base });
      return response.end();
    }
    response.writeHead(200);
    return response.end('React cockpit proof server');
  }
  const prefix = configuration.base;
  if (!pathname.startsWith(prefix)) {
    response.writeHead(404);
    return response.end();
  }
  const file = resolve(
    root,
    decodeURIComponent(pathname.slice(prefix.length)) || 'index.html'
  );
  if (file !== root && !file.startsWith(root + sep)) {
    response.writeHead(404);
    return response.end();
  }
  try {
    response.writeHead(200, {
      'content-type':
        { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[
          extname(file)
        ] ?? 'application/octet-stream',
    });
    response.end(readFileSync(file));
  } catch {
    response.writeHead(404);
    response.end();
  }
});
server.listen(configuration.port, '127.0.0.1');
if (!process.argv.includes('--no-parent'))
  createServer(server.listeners('request')[0]).listen(3000, '127.0.0.1');
