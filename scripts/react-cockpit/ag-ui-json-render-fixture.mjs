/** Offline installed-client proof server; never assembled into public assets. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
const run = promisify(execFile);
export function createAgUiJsonRenderFixture() {
  let requests = [],
    held,
    mode = 'healthy',
    holding = null;
  const json = (response, value, status = 200) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  return async function handle(request, response, pathname) {
    if (pathname === '/__reset') {
      held?.response.end();
      held = undefined;
      requests = [];
      mode = 'healthy';
      holding = null;
      json(response, {});
      return true;
    }
    if (pathname === '/__requests') {
      json(response, requests);
      return true;
    }
    if (pathname === '/__lifetime') {
      json(response, { active: Boolean(held) });
      return true;
    }
    if (pathname === '/__release') {
      const current = held;
      held = undefined;
      if (current && !current.response.destroyed) current.finish();
      json(response, {});
      return true;
    }
    if (pathname.startsWith('/__mode/')) {
      mode = decodeURIComponent(pathname.slice(8));
      json(response, {});
      return true;
    }
    if (pathname.startsWith('/__hold/')) {
      holding = pathname.slice(8);
      json(response, {});
      return true;
    }
    if (!['/ag-ui/json-render/agent', '/developer-agent'].includes(pathname))
      return false;
    let input = '';
    for await (const chunk of request) input += chunk;
    let body;
    try {
      body = JSON.parse(input);
    } catch {
      json(response, { error: 'Invalid native request' }, 400);
      return true;
    }
    requests.push({ path: pathname, method: request.method, body });
    const human = body.messages?.at(-1);
    if (
      request.method !== 'POST' ||
      body.protocolVersion !== '1.0' ||
      typeof body.threadId !== 'string' ||
      typeof body.runId !== 'string' ||
      human?.role !== 'user' ||
      typeof human.content !== 'string'
    ) {
      json(response, { error: 'Invalid native request' }, 400);
      return true;
    }
    if (mode === 'http-error') {
      json(response, { error: 'PRIVATE upstream failure' }, 500);
      return true;
    }
    let wire;
    try {
      const source = resolve('cockpit/ag-ui/json-render/python');
      const pending = run(
        resolve(source, '.venv/bin/python'),
        [resolve('scripts/react-cockpit/ag-ui-json-render-wire.py')],
        { cwd: source, maxBuffer: 32 * 1024 * 1024 }
      );
      // The child receives the exact native request; no history or state is reconstructed.
      pending.child.stdin.end(JSON.stringify(body));
      const result = await pending;
      wire = JSON.parse(result.stdout);
    } catch {
      json(response, { error: 'Offline producer failed' }, 500);
      return true;
    }
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
    });
    const emit = (event) =>
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    const final = wire.findLast((event) => event.type === 'MESSAGES_SNAPSHOT');
    const tail = final?.messages ?? [];
    const tools = tail.filter((row) => row.role === 'tool');
    if (mode === 'run-error')
      wire = [
        wire[0],
        { type: 'RUN_ERROR', message: 'PRIVATE provider failure' },
      ];
    if (mode === 'wrong-run')
      wire = wire.map((event) =>
        event.type === 'RUN_FINISHED' ? { ...event, runId: 'wrong-run' } : event
      );
    if (mode === 'wrong-thread')
      wire = wire.map((event) =>
        event.type === 'RUN_FINISHED'
          ? { ...event, threadId: 'wrong-thread' }
          : event
      );
    if (mode === 'eof')
      wire = wire.filter((event) => event.type !== 'RUN_FINISHED');
    if (mode === 'child')
      wire.splice(1, 0, {
        type: 'SUBAGENT_STARTED',
        subagentRunId: 'child',
        name: 'worker',
      });
    if (mode === 'legacy')
      wire.splice(1, 0, {
        type: 'CUSTOM',
        name: 'on_interrupt',
        value: { note: 'legacy pause' },
      });
    if (mode === 'notice-eof')
      wire = [
        ...wire.filter((event) => event.type !== 'RUN_FINISHED'),
        { type: 'CUSTOM', name: 'unsupported', value: {} },
      ];
    if (mode === 'bad-state')
      for (const event of wire)
        if (event.type === 'STATE_SNAPSHOT')
          event.snapshot.on_time = { value: { invalid: true }, delta: null };
    if (final && mode === 'truncated-prefix')
      final.messages = tail.slice(body.messages.length - 1);
    if (final && mode === 'duplicate-result')
      final.messages = [
        ...tail.slice(0, -1),
        { ...tools[0], id: 'duplicate-result' },
        tail.at(-1),
      ];
    if (final && mode === 'orphan-result')
      final.messages = [
        ...tail.slice(0, -1),
        { id: 'orphan', role: 'tool', toolCallId: 'orphan', content: '{}' },
        tail.at(-1),
      ];
    if (final && mode === 'missing-result')
      final.messages = tail.filter((row) => row !== tools[0]);
    if (final && mode === 'wrong-result-id') tools[0].id = 'wrong-result';
    if (final && mode === 'unknown-tool') {
      const owner = tail.find(
        (row) => row.role === 'assistant' && row.toolCalls?.length
      );
      owner.toolCalls[0].function.name = 'unknown_dashboard_tool';
    }
    if (mode === 'malformed-spec')
      for (const event of wire) {
        if (
          event.type === 'TOOL_CALL_ARGS' &&
          event.delta.includes('dashboard_grid')
        )
          event.delta = event.delta.replace('dashboard_grid', 'custom_html');
        if (event.type === 'MESSAGES_SNAPSHOT')
          for (const row of event.messages)
            if (row.role === 'assistant') {
              for (const call of row.toolCalls ?? [])
                if (call.function.name === 'render_spec')
                  call.function.arguments = call.function.arguments.replace(
                    'dashboard_grid',
                    'custom_html'
                  );
            }
      }
    requests.at(-1).final = final?.messages;
    requests.at(-1).state = wire.findLast(
      (event) => event.type === 'STATE_SNAPSHOT'
    )?.snapshot;
    const finish = () => {
      for (const event of wire) emit(event);
      response.end();
    };
    if (holding) {
      const stage = holding;
      holding = null;
      let split =
        stage === 'state'
          ? wire.findIndex((event) => event.type === 'STATE_SNAPSHOT') + 1
          : stage === 'result'
          ? wire.findIndex((event) => event.type === 'TOOL_CALL_RESULT') + 1
          : stage === 'final'
          ? wire.findLastIndex((event) => event.type === 'RUN_FINISHED')
          : 1;
      if (split < 1) split = 1;
      for (const event of wire.slice(0, split)) emit(event);
      wire = wire.slice(split);
      const current = { response, finish };
      held = current;
      response.once('close', () => {
        if (held === current) held = undefined;
      });
    } else finish();
    return true;
  };
}
