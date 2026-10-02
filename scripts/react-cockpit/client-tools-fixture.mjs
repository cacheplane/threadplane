/** Local real-SDK tool exchange proof; never included in public deployment. */
export function createClientToolsFixture() {
  let requests = [];
  const threads = new Map(), runs = new Map();
  let sequence = 0, failCreation = false, holdState = false, failState = false, holdCalls = false, held;
  const json = (response, value, status = 200) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  const weather = { location: 'Portland', temperatureF: 68, conditions: 'Sunny', humidity: 55, windMph: 8 };
  const names = ['get_weather', 'slow_status_check', 'weather_card', 'weather_snapshot', 'confirm_booking'];
  function calls(text) {
    const call = (id, name, args) => ({ id: sequence === 1 ? id : `${id}-${sequence}`, name, args, type: 'tool_call' });
    if (text === 'Weather') return [call('weather-1', 'get_weather', { location: 'Portland' })];
    if (text === 'Card') return [call('card-1', 'weather_card', { ...weather, location: '<script>Portland</script>' })];
    if (text === 'Snapshot') return [call('snapshot-1', 'weather_snapshot', weather)];
    if (text === 'Mixed') return [call('snapshot-1', 'weather_snapshot', weather), call('weather-1', 'get_weather', { location: 'Portland' })];
    if (text === 'Bookings') return ['booking-a', 'booking-b'].map((id) => call(id, 'confirm_booking', { summary: 'Fictional booking' }));
    if (text === 'Slow') return [call('slow-1', 'slow_status_check', {})];
    if (text === 'Malformed') return [call('bad-1', 'weather_card', { ...weather, humidity: 101 })];
    if (text === 'Unknown') return [call('unknown-1', 'constructor', {})];
    return [];
  }
  return async function handle(request, response, pathname) {
    if (pathname === '/__reset') {
      held?.response.end(); held = undefined;
      requests = []; threads.clear(); runs.clear(); sequence = 0;
      failCreation = holdState = failState = holdCalls = false;
      json(response, {}); return true;
    }
    if (pathname === '/__requests') { json(response, requests); return true; }
    if (pathname === '/__threads') { json(response, [...threads.values()]); return true; }
    if (pathname === '/__lifetime') { json(response, { active: !!held }); return true; }
    if (pathname === '/__fail-create') { failCreation = true; json(response, {}); return true; }
    if (pathname === '/__hold-state') { holdState = true; json(response, {}); return true; }
    if (pathname === '/__hold-calls') { holdCalls = true; json(response, {}); return true; }
    if (pathname === '/__fail-state') { failState = true; json(response, {}); return true; }
    if (pathname === '/__release') {
      const current = held; held = undefined;
      if (current && !current.response.destroyed) current.finish();
      json(response, {}); return true;
    }
    if (!pathname.startsWith('/api/') && !pathname.startsWith('/developer-api/')) return false;
    let input = '';
    for await (const chunk of request) input += chunk;
    const body = input ? JSON.parse(input) : {};
    requests.push({ path: pathname, method: request.method, body, key: request.headers['x-api-key'] ?? null });
    if (pathname.endsWith('/threads')) {
      if (failCreation) { failCreation = false; json(response, { error: 'PRIVATE creation response' }, 500); return true; }
      threads.set(body.thread_id, { messages: [] });
      json(response, { thread_id: body.thread_id }); return true;
    }
    const threadId = /\/threads\/([^/]+)/.exec(pathname)?.[1];
    const state = threads.get(threadId);
    if (pathname.endsWith('/state') && request.method === 'POST') {
      if (!state || !Array.isArray(body.values?.messages)) { json(response, { error: 'Expected confirmed result write' }, 400); return true; }
      // Model an ambiguous write: durable effect succeeded, acknowledgement failed.
      state.messages.push(...body.values.messages);
      const finish = () => {
        if (failState) { failState = false; json(response, { error: 'PRIVATE uncertain acknowledgement' }, 500); }
        else json(response, {});
      };
      if (holdState) {
        holdState = false; const current = { response, finish }; held = current;
        response.on('close', () => { if (held === current) held = undefined; });
      } else finish();
      return true;
    }
    if (pathname.endsWith('/runs/stream')) {
      const catalog = body.input?.client_tools;
      if (!state || body.assistant_id !== 'client-tools' || body.command ||
          !Array.isArray(body.input?.messages) || !Array.isArray(catalog) ||
          JSON.stringify(catalog.map((tool) => tool.name)) !== JSON.stringify(names)) {
        json(response, { error: 'Expected confirmed tool input and authored catalog' }, 400); return true;
      }
      const message = body.input.messages.at(-1);
      if (message.content === 'Error') { json(response, { error: 'PRIVATE run response' }, 500); return true; }
      const runId = '00000000-0000-0000-0000-' + String(++sequence).padStart(12, '0');
      const run = { thread_id: threadId, status: 'running' }; runs.set(runId, run);
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'content-location': `/threads/${threadId}/runs/${runId}` });
      response.write(event('metadata', { run_id: runId }));
      state.messages.push(...body.input.messages);
      response.write(event('values', state));
      const toolCalls = message.type === 'tool' || message.role === 'tool' ? [] : calls(message.content);
      const answer = { type: 'ai', id: 'answer-' + runId, content: toolCalls.length ? '' : 'Browser result received.', ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
      if (toolCalls.length) {
        // This partial fragment is deliberately not actionable until final values.
        const first = toolCalls[0];
        response.write(event('messages', [{ type: 'AIMessageChunk', id: answer.id, content: '', tool_call_chunks: [{ index: 0, id: first.id, name: first.name, args: '{', type: 'tool_call_chunk' }] }, { langgraph_node: 'generate' }]));
      } else {
        response.write(event('messages', [{ type: 'AIMessageChunk', id: answer.id, content: 'Browser result' }, { langgraph_node: 'generate' }]));
        response.write(event('messages', [{ type: 'AIMessageChunk', id: answer.id, content: ' received.' }, { langgraph_node: 'generate' }]));
      }
      const finish = () => {
        state.messages.push(answer);
        const paused = message.content === 'Pause';
        response.write(event('values', { ...state, ...(paused ? { __interrupt__: [{ id: 'unexpected', value: null }] } : {}) }));
        run.status = paused ? 'interrupted' : 'success'; response.end();
      };
      if (holdCalls) {
        holdCalls = false; const current = { response, finish }; held = current;
        response.on('close', () => { if (held === current) held = undefined; });
      } else finish();
      return true;
    }
    if (pathname.endsWith('/cancel')) { held?.response.end(); held = undefined; json(response, {}); return true; }
    const runId = /\/runs\/([^/]+)$/.exec(pathname)?.[1];
    if (request.method === 'GET' && runId) {
      const run = runs.get(runId);
      json(response, run ? { run_id: runId, ...run } : { error: 'Unknown physical run' }, run ? 200 : 404); return true;
    }
    json(response, {}); return true;
  };
}
