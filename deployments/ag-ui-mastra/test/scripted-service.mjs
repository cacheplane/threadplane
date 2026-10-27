// Test-only scripted model and owned loopback service setup. No service import occurs
// until the local endpoint, disposable database and dummy credentials are set.
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// ── scripted model ─────────────────────────────────────────────────────────
// aimock-style matcher list: tool-output matchers FIRST so continuation
// requests never re-match the original tool-call entry.
const SCRIPT = [
  {
    match: { hasToolOutput: 'check_conditions' },
    response: {
      content: 'Clear skies at Yosemite Valley with a high of 18°C.',
    },
  },
  {
    match: { hasToolOutput: 'updateWorkingMemory' },
    response: { content: 'Started your Yosemite Weekend packing list.' },
  },
  {
    match: { hasToolOutput: 'reserve_campsite' },
    response: { content: 'Booked — North Pines is reserved for 2 nights.' },
  },
  {
    match: { userIncludes: 'weather' },
    response: {
      toolCalls: [
        {
          name: 'check_conditions',
          arguments: { location: 'Yosemite Valley' },
        },
      ],
    },
  },
  {
    match: { userIncludes: 'packing list' },
    response: {
      toolCalls: [
        {
          name: 'updateWorkingMemory',
          arguments: {
            memory: {
              packing_list: {
                title: 'Yosemite Weekend',
                items: [
                  { name: 'tent', qty: 1 },
                  { name: 'sleeping bag', qty: 2 },
                ],
              },
            },
          },
        },
      ],
    },
  },
  {
    match: { userIncludes: 'reserve' },
    response: {
      toolCalls: [
        {
          name: 'reserve_campsite',
          arguments: { site: 'North Pines', nights: 2 },
        },
      ],
    },
  },
  { match: { userIncludes: 'hello' }, response: { content: 'Hello there.' } },
];

function requestContext(body) {
  const items = Array.isArray(body.input) ? body.input : [];
  const callNamesById = new Map(
    items
      .filter((i) => i.type === 'function_call')
      .map((i) => [i.call_id, i.name])
  );
  const toolOutputNames = items
    .filter((i) => i.type === 'function_call_output')
    .map((i) => callNamesById.get(i.call_id))
    .filter(Boolean);
  const lastUser = [...items].reverse().find((i) => i.role === 'user');
  const userText = !lastUser
    ? ''
    : typeof lastUser.content === 'string'
    ? lastUser.content
    : (lastUser.content ?? []).map((p) => p.text ?? '').join('');
  return { toolOutputNames, userText: userText.toLowerCase() };
}

function pickEntry(body) {
  const ctx = requestContext(body);
  return SCRIPT.find((entry) => {
    if (entry.match.hasToolOutput !== undefined) {
      return ctx.toolOutputNames.includes(entry.match.hasToolOutput);
    }
    return ctx.userText.includes(entry.match.userIncludes);
  });
}

let mockCall = 0;
function responsesOutput(entry) {
  mockCall++;
  if (entry.response.toolCalls) {
    return entry.response.toolCalls.map((t, i) => ({
      id: `fc_mock${mockCall}_${i}`,
      call_id: `call_mock${mockCall}_${i}`,
      type: 'function_call',
      name: t.name,
      arguments: JSON.stringify(t.arguments ?? {}),
      status: 'completed',
    }));
  }
  return [
    {
      id: `msg_mock${mockCall}`,
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [
        {
          type: 'output_text',
          text: String(entry.response.content),
          annotations: [],
          logprobs: [],
        },
      ],
    },
  ];
}

function responsesEnvelope(id, model, out, status) {
  const completed = status === 'completed';
  return {
    id,
    object: 'response',
    created_at: 1,
    completed_at: completed ? 1 : null,
    status,
    background: false,
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    max_tool_calls: null,
    metadata: null,
    model,
    output: completed ? out : [],
    parallel_tool_calls: true,
    previous_response_id: null,
    prompt: null,
    reasoning: null,
    service_tier: 'default',
    temperature: null,
    text: { format: { type: 'text' } },
    tool_choice: 'auto',
    tools: [],
    top_p: null,
    truncation: 'disabled',
    usage: completed
      ? {
          input_tokens: 0,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 0,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 0,
        }
      : null,
  };
}

function createMockOpenAi() {
  return http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const parsed = body ? JSON.parse(body) : {};
    if (!req.url?.endsWith('/responses')) {
      res.writeHead(500).end('unexpected endpoint ' + req.url);
      return;
    }
    const entry = pickEntry(parsed);
    if (!entry) {
      res
        .writeHead(500)
        .end(
          'no script entry matched: ' + JSON.stringify(requestContext(parsed))
        );
      return;
    }
    const model = parsed.model ?? 'mock';
    const id = `resp_mock${mockCall}`;
    const out = responsesOutput(entry);
    let seq = 0;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (ev) =>
      res.write(
        `data: ${JSON.stringify({ ...ev, sequence_number: seq++ })}\n\n`
      );
    send({
      type: 'response.created',
      response: responsesEnvelope(id, model, out, 'in_progress'),
    });
    for (let oi = 0; oi < out.length; oi++) {
      const item = out[oi];
      if (item.type === 'function_call') {
        send({
          type: 'response.output_item.added',
          output_index: oi,
          item: { ...item, arguments: '', status: 'in_progress' },
        });
        // Two argument chunks so partial-args paths (STATE_DELTA) exercise.
        const mid = Math.ceil(item.arguments.length / 2);
        send({
          type: 'response.function_call_arguments.delta',
          output_index: oi,
          item_id: item.id,
          delta: item.arguments.slice(0, mid),
        });
        send({
          type: 'response.function_call_arguments.delta',
          output_index: oi,
          item_id: item.id,
          delta: item.arguments.slice(mid),
        });
        send({
          type: 'response.function_call_arguments.done',
          output_index: oi,
          item_id: item.id,
          name: item.name,
          arguments: item.arguments,
        });
        send({ type: 'response.output_item.done', output_index: oi, item });
        continue;
      }
      send({
        type: 'response.output_item.added',
        output_index: oi,
        item: { ...item, status: 'in_progress', content: [] },
      });
      const content = item.content[0];
      send({
        type: 'response.content_part.added',
        output_index: oi,
        content_index: 0,
        item_id: item.id,
        part: { ...content, text: '' },
      });
      for (const word of content.text.split(/(?<= )/)) {
        send({
          type: 'response.output_text.delta',
          output_index: oi,
          content_index: 0,
          item_id: item.id,
          delta: word,
          logprobs: [],
        });
      }
      send({
        type: 'response.output_text.done',
        output_index: oi,
        content_index: 0,
        item_id: item.id,
        text: content.text,
        logprobs: [],
      });
      send({
        type: 'response.content_part.done',
        output_index: oi,
        content_index: 0,
        item_id: item.id,
        part: content,
      });
      send({ type: 'response.output_item.done', output_index: oi, item });
    }
    send({
      type: 'response.completed',
      response: responsesEnvelope(id, model, out, 'completed'),
    });
    res.end('data: [DONE]\n\n');
  });
}

export async function bounded(
  promise,
  label = 'local service operation',
  timeoutMs = 10000
) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Check the deadline inside the loop: a rejected wait leaves no detached poller.
export async function waitUntil(predicate, label, timeoutMs = 10000) {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error(`${label} timed out`);
    await delay(5);
  }
}
async function listen(server, label, timeoutMs) {
  await bounded(
    new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    }),
    label,
    timeoutMs
  );
}

async function closeServer(server) {
  if (!server) return;
  const closed = new Promise((resolve, reject) =>
    server.close((error) =>
      error && error.code !== 'ERR_SERVER_NOT_RUNNING'
        ? reject(error)
        : resolve()
    )
  );
  server.closeAllConnections();
  await bounded(closed, 'owned server close');
}

let active = false;
export async function startScriptedService({
  loadService = () => import('../server.mjs'),
  startupTimeoutMs = 10000,
} = {}) {
  if (active)
    throw new Error(
      'Scripted service environment is already owned by this process'
    );
  active = true;
  const names = [
    'AG_UI_INTERNAL_TOKEN',
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'AG_UI_MASTRA_DB_PATH',
  ];
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]])
  );
  const token = 'test-internal-token';
  let mock, server, dbDir, closing;
  const requests = [];
  const close = () =>
    (closing ??= (async () => {
      try {
        await closeServer(server);
      } finally {
        try {
          await closeServer(mock);
        } finally {
          try {
            if (dbDir) rmSync(dbDir, { recursive: true, force: true });
          } finally {
            for (const [name, value] of Object.entries(previous)) {
              if (value === undefined) delete process.env[name];
              else process.env[name] = value;
            }
            active = false;
          }
        }
      }
    })());
  try {
    mock = createMockOpenAi();
    await listen(mock, 'model start', startupTimeoutMs);
    dbDir = mkdtempSync(join(tmpdir(), 'ag-ui-mastra-test-'));
    process.env.AG_UI_INTERNAL_TOKEN = token;
    process.env.OPENAI_API_KEY = 'sk-test-not-used';
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${mock.address().port}/v1`;
    process.env.AG_UI_MASTRA_DB_PATH = join(dbDir, 'mastra.db');
    const { createAgUiServer } = await bounded(
      loadService(),
      'service import',
      startupTimeoutMs
    );
    server = createAgUiServer();
    server.prependListener('request', (request, response) => {
      if (request.method !== 'POST') return;
      const record = {
        method: request.method,
        path: request.url,
        closed: false,
      };
      requests.push(record);
      response.once('close', () => {
        record.closed = true;
      });
    });
    await listen(server, 'service start', startupTimeoutMs);
    return {
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      token,
      stats: () => structuredClone(requests),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
