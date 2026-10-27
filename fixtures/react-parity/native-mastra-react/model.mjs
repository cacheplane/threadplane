/** Offline Responses seam. Positive AG-UI events are authored by the unchanged service. */
import http from 'node:http';
export function selectResponse(body) {
  const items = Array.isArray(body.input) ? body.input : [];
  const outputs = items.filter((i) => i.type === 'function_call_output');
  if (outputs.length) {
    if (
      outputs.length !== 1 ||
      items.filter((i) => i.type === 'function_call').length !== 1
    )
      throw new Error('Unmatched ambiguous continuation');
    const output = outputs.at(-1);
    const calls = items.filter(
      (i) => i.type === 'function_call' && i.call_id === output.call_id
    );
    if (calls.length !== 1 || calls[0].name !== 'reserve_campsite')
      throw new Error('Unmatched continuation correlation');
    let args;
    try {
      args = JSON.parse(calls[0].arguments);
    } catch {
      throw new Error('Unmatched malformed reservation arguments');
    }
    if (args.site !== 'North Pines' || args.nights !== 2)
      throw new Error('Unmatched reservation arguments');
    const approved =
      'Reserved North Pines for 2 night(s) — total $90. Confirmation TP-0288.';
    const declined =
      'Reservation for North Pines was declined by the user. Nothing was booked.';
    if (
      output.output === JSON.stringify(approved) ||
      output.output === approved
    )
      return {
        content:
          'The fictional North Pines reservation is approved for 2 nights.',
      };
    if (
      output.output === JSON.stringify(declined) ||
      output.output === declined
    )
      return {
        content:
          'The North Pines reservation was declined. Nothing was booked.',
      };
    throw new Error('Unmatched reservation output');
  }
  if (items.some((i) => i.type === 'function_call'))
    throw new Error('Unmatched incomplete continuation');
  const users = items.filter((i) => i.role === 'user');
  const last = users.at(-1);
  const text =
    typeof last?.content === 'string'
      ? last.content
      : (last?.content ?? []).map((p) => p.text ?? '').join('');
  if (users.length !== 1 || !/reserve.*North Pines.*2 nights/i.test(text))
    throw new Error('Unmatched initial request');
  return {
    toolCalls: [
      {
        name: 'reserve_campsite',
        arguments: { site: 'North Pines', nights: 2 },
      },
    ],
  };
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

export function createMockOpenAi(records, { hold = false } = {}) {
  return http.createServer(async (req, res) => {
    req.setTimeout(15000, () => req.destroy());
    res.setTimeout(25000, () => res.destroy());
    if (records.length >= 12) {
      res.writeHead(429).end();
      return;
    }
    let body = '';
    for await (const c of req) {
      body += c;
      if (body.length > 2000000) {
        req.destroy();
        return;
      }
    }
    let parsed;
    try {
      parsed = body ? JSON.parse(body) : {};
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (req.method !== 'POST' || !req.url?.endsWith('/responses')) {
      res.writeHead(500).end('unexpected endpoint ' + req.url);
      return;
    }
    records.push({ bytes: body, body: parsed });
    let entry;
    try {
      entry = { response: selectResponse(parsed) };
      records.at(-1).match = entry.response;
    } catch (error) {
      records.at(-1).error = String(error);
      res.writeHead(422).end(String(error));
      return;
    }
    if (!entry) {
      res.writeHead(500).end('no script entry matched: ' + 'unmatched');
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
    if (hold) {
      records.at(-1).held = true;
      await new Promise((resolve) => res.once('close', resolve));
      records.at(-1).closed = true;
      return;
    }
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
