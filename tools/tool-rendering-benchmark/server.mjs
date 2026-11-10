import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  argumentFragments,
  executeTool,
  getScenario,
  hashValue,
} from './scenarios.mjs';

const terminal = new Set([
  'complete',
  'partial',
  'error',
  'aborted',
  'denied',
  'paused',
]);
const participantName = /^[a-zA-Z0-9_-]{1,60}$/;
const sleep = (ms, signal) =>
  new Promise((done) => {
    if (signal.aborted) return done();
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      done();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });

/** Local scripted-agent server. Native protocols share real tools and one audit ledger. */
export async function createBenchmarkServer({
  port = 4809,
  fragmentDelayMs = 25,
  toolDelayMs = 600,
} = {}) {
  const runs = new Map();
  const notes = [];
  const streams = new Set();
  const gates = new Map();
  const recoveries = new Map();
  let address;
  function stop(run, reason = 'aborted') {
    if (terminal.has(run.record.status)) return;
    run.record.status = reason;
    run.record.endedAt = Date.now();
    run.controller.abort();
    run.decide?.(false);
    run.response.end();
    streams.delete(run);
  }
  const server = createServer(async (request, response) => {
    const json = (status, value) => {
      response.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      response.end(JSON.stringify(value));
    };
    try {
      const origin = request.headers.origin;
      if (origin) {
        let allowed = false;
        try {
          const parsed = new URL(origin);
          allowed =
            parsed.protocol === 'http:' &&
            ['127.0.0.1', 'localhost'].includes(parsed.hostname) &&
            [String(address?.port), '4810', '4811', '4812'].includes(
              parsed.port
            );
        } catch {
          /* Invalid origins are rejected. */
        }
        if (!allowed)
          return json(403, { error: 'Not a local benchmark origin' });
        response.setHeader('access-control-allow-origin', origin);
        response.setHeader('vary', 'Origin');
      }
      if (request.method === 'OPTIONS') {
        response.writeHead(204, {
          'access-control-allow-methods': 'GET,POST,OPTIONS',
          'access-control-allow-headers':
            'content-type,x-benchmark-participant',
        });
        return response.end();
      }
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/health')
        return json(200, {
          scriptedAgent: true,
          nativeProtocols: ['ag-ui', 'ai-sdk'],
        });
      if (request.method === 'GET' && url.pathname === '/receipts')
        return json(
          200,
          [...runs.values()].map((run) => run.record)
        );
      if (request.method !== 'POST')
        return json(405, { error: 'Method not allowed' });
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 128_000)
          return json(413, { error: 'Benchmark request too large' });
      }
      const input = body ? JSON.parse(body) : {};
      if (url.pathname.startsWith('/reset/')) {
        const participant = url.pathname.slice('/reset/'.length);
        if (!participantName.test(participant))
          return json(400, { error: 'Invalid participant' });
        for (const run of runs.values())
          if (run.record.participant === participant) {
            run.revoked = true;
            stop(run);
          }
        for (const gate of gates.values())
          if (gate.participant === participant) gate.revoked = true;
        for (const [key, recovery] of recoveries)
          if (recovery.participant === participant) recoveries.delete(key);
        return json(200, { reset: true });
      }
      if (url.pathname.startsWith('/approve/')) {
        const run = runs.get(url.pathname.slice('/approve/'.length));
        if (!run || run.revoked)
          return json(410, { error: 'Approval is no longer current' });
        if (run.record.status !== 'waiting' || run.decided)
          return json(409, { error: 'Approval already resolved' });
        if (typeof input.approved !== 'boolean')
          return json(400, { error: 'Explicit approval decision required' });
        run.decided = true;
        run.record.approved = input.approved;
        run.decide(input.approved);
        return json(200, { accepted: true });
      }
      const protocol = url.pathname.slice(1);
      if (!['ag-ui', 'ai-sdk'].includes(protocol))
        return json(404, { error: 'Unknown benchmark protocol' });
      const participant =
        url.searchParams.get('participant') ??
        request.headers['x-benchmark-participant'];
      if (typeof participant !== 'string' || !participantName.test(participant))
        return json(400, { error: 'Invalid participant' });
      if ([...streams].some((run) => run.record.participant === participant))
        return json(409, { error: 'Participant already has an active run' });
      let scenario;
      try {
        scenario = getScenario(
          url.searchParams.get('scenario') ?? 'references'
        );
      } catch {
        return json(400, { error: 'Unknown benchmark scenario' });
      }
      // Presentation variant only: the same calls and results, with confirmed
      // references also published as message citations in agent state.
      const citeSources =
        protocol === 'ag-ui' && url.searchParams.get('layout') === 'sources';
      if (scenario.nativeApproval && protocol !== 'ag-ui')
        return json(400, { error: 'Native approval requires AG-UI' });
      const threadId =
        typeof input.threadId === 'string'
          ? input.threadId
          : typeof input.id === 'string'
          ? input.id
          : participant;
      let gate;
      if (input.resume !== undefined) {
        if (
          !scenario.nativeApproval ||
          !Array.isArray(input.resume) ||
          input.resume.length !== 1
        )
          return json(400, { error: 'Exactly one native response required' });
        const decision = input.resume[0];
        if (
          !decision ||
          typeof decision.interruptId !== 'string' ||
          !(
            (decision.status === 'resolved' &&
              typeof decision.payload === 'boolean') ||
            (decision.status === 'cancelled' && decision.payload === undefined)
          )
        )
          return json(400, {
            error: 'Explicit approval or cancellation required',
          });
        gate = gates.get(decision.interruptId);
        if (!gate || gate.revoked)
          return json(410, { error: 'Native approval is no longer current' });
        if (
          gate.consumed ||
          gate.participant !== participant ||
          gate.threadId !== threadId ||
          typeof input.runId !== 'string' ||
          !input.runId ||
          input.runId === gate.sourceRunId
        )
          return json(409, {
            error: 'Native approval correlation mismatch or already consumed',
          });
      }
      const user = Array.isArray(input.messages)
        ? input.messages.findLast((message) => message?.role === 'user')
        : undefined;
      const content = user?.content ?? user?.parts;
      const prompt =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
          ? content
              .filter(
                (part) => part?.type === 'text' && typeof part.text === 'string'
              )
              .map((part) => part.text)
              .join('')
          : undefined;
      const recoveryKey = JSON.stringify([participant, threadId]);
      const recovery = scenario.recoverableRead
        ? recoveries.get(recoveryKey)
        : undefined;
      const expectedPrompt = recovery ? scenario.retryPrompt : scenario.prompt;
      if (!gate && prompt !== expectedPrompt)
        return json(400, {
          error: 'The live user prompt does not match this scenario',
        });
      if (!gate && scenario.nativeApproval) {
        // A valid new explicit request supersedes an old unclaimed pause.
        for (const old of gates.values())
          if (
            old.participant === participant &&
            old.threadId === threadId &&
            !old.consumed
          )
            old.revoked = true;
      }
      // Claim synchronously before the first streaming await. Never retry a write
      // after an uncertain response; the consumed gate remains audit evidence.
      if (gate) gate.consumed = true;
      const id = randomUUID();
      const nativeRunId = typeof input.runId === 'string' ? input.runId : id;
      const calls = recovery
        ? [{ ...scenario.calls[1], id: 'read-sorted-retry' }]
        : scenario.calls;
      const messageId = id + '-assistant';
      const cited = new Map();
      const record = {
        id,
        participant,
        protocol,
        scenario: scenario.id,
        prompt: prompt ?? gate?.prompt,
        promptHash: hashValue(prompt ?? gate?.prompt),
        expectedPromptHash: hashValue(expectedPrompt),
        nativeRunId,
        threadId,
        startedAt: Date.now(),
        status: 'running',
        tools: [],
        events: [],
        ...(gate
          ? {
              sourceRunId: gate.sourceRunId,
              interruptId: gate.id,
              approved:
                input.resume[0].status === 'resolved' &&
                input.resume[0].payload === true,
            }
          : {}),
        ...(recovery ? { retryOf: recovery.runId } : {}),
      };
      const run = {
        record,
        response,
        controller: new AbortController(),
        revoked: false,
        decided: false,
      };
      runs.set(id, run);
      // Retain bounded terminal evidence; never discard an active run/gate.
      while (runs.size > 100) {
        const oldest = [...runs].find(([, candidate]) =>
          terminal.has(candidate.record.status)
        );
        if (!oldest) break;
        runs.delete(oldest[0]);
      }
      streams.add(run);
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        ...(protocol === 'ai-sdk'
          ? { 'x-vercel-ai-ui-message-stream': 'v1' }
          : {}),
      });
      response.flushHeaders();
      response.on('close', () => {
        if (!terminal.has(record.status)) stop(run);
      });
      const active = () =>
        !run.controller.signal.aborted && !response.destroyed;
      const emit = (event) => {
        if (!active()) return;
        record.events.push({
          type: event.type,
          toolCallId: event.toolCallId,
          at: Date.now(),
        });
        response.write(
          'data: ' +
            JSON.stringify(
              protocol === 'ag-ui' ? { ...event, timestamp: Date.now() } : event
            ) +
            '\n\n'
        );
      };
      const finish = (status) => {
        record.status = status;
        record.endedAt = Date.now();
        streams.delete(run);
        if (protocol === 'ai-sdk' && active())
          response.write('data: [DONE]\n\n');
        response.end();
      };
      if (protocol === 'ag-ui') {
        emit({ type: 'RUN_STARTED', threadId, runId: nativeRunId });
        emit({ type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' });
      } else emit({ type: 'start', messageId });
      for (const call of calls) {
        if (!active()) break;
        const nativeId = gate?.toolCallId ?? id + '-' + call.id;
        const tool = {
          canonicalId: call.id,
          nativeId,
          name: call.name,
          argsHash: hashValue(call.args),
          status: 'preparing',
          executionCount: 0,
        };
        record.tools.push(tool);
        if (!gate) {
          emit(
            protocol === 'ag-ui'
              ? {
                  type: 'TOOL_CALL_START',
                  toolCallId: nativeId,
                  toolCallName: call.name,
                  parentMessageId: messageId,
                }
              : {
                  type: 'tool-input-start',
                  toolCallId: nativeId,
                  toolName: call.name,
                }
          );
          for (const delta of argumentFragments(call.args)) {
            if (!active()) break;
            emit(
              protocol === 'ag-ui'
                ? { type: 'TOOL_CALL_ARGS', toolCallId: nativeId, delta }
                : {
                    type: 'tool-input-delta',
                    toolCallId: nativeId,
                    inputTextDelta: delta,
                  }
            );
            await sleep(fragmentDelayMs, run.controller.signal);
          }
          if (!active()) break;
          tool.argsCompletedAt = Date.now();
          tool.status = 'running';
          emit(
            protocol === 'ag-ui'
              ? { type: 'TOOL_CALL_END', toolCallId: nativeId }
              : {
                  type: 'tool-input-available',
                  toolCallId: nativeId,
                  toolName: call.name,
                  input: call.args,
                }
          );
        }
        tool.status = 'running';
        if (scenario.nativeApproval && !gate) {
          const interruptId = nativeRunId + ':approval:' + id;
          gates.set(interruptId, {
            id: interruptId,
            participant,
            threadId,
            sourceRunId: nativeRunId,
            toolCallId: nativeId,
            prompt: scenario.prompt,
            consumed: false,
            revoked: false,
          });
          tool.status = 'waiting';
          record.interruptId = interruptId;
          emit({ type: 'TEXT_MESSAGE_END', messageId });
          emit({
            type: 'RUN_FINISHED',
            threadId,
            runId: nativeRunId,
            outcome: {
              type: 'interrupt',
              interrupts: [
                {
                  id: interruptId,
                  reason: 'Approve saving the comparison note',
                  toolCallId: nativeId,
                  message: call.args.text,
                },
              ],
            },
          });
          finish('paused');
          return;
        }
        if (gate && !record.approved) {
          tool.status = 'denied';
          const cancellation = { saved: false, cancelled: true };
          tool.cancellationHash = hashValue(cancellation);
          tool.resultPublishedAt = Date.now();
          emit({
            type: 'TOOL_CALL_RESULT',
            messageId: nativeId + '-cancelled',
            toolCallId: nativeId,
            role: 'tool',
            content: JSON.stringify(cancellation),
          });
          emit({
            type: 'TEXT_MESSAGE_CONTENT',
            messageId,
            delta: 'Saving the note was cancelled.',
          });
          emit({ type: 'TEXT_MESSAGE_END', messageId });
          emit({ type: 'RUN_FINISHED', threadId, runId: nativeRunId });
          finish('denied');
          return;
        }
        if (scenario.requiresApproval) {
          const decision = new Promise((resolve) => {
            run.decide = resolve;
          });
          record.status = 'waiting';
          tool.status = 'waiting';
          emit(
            protocol === 'ag-ui'
              ? {
                  type: 'CUSTOM',
                  name: 'benchmark-approval-request',
                  value: { approvalId: id, toolCallId: nativeId },
                }
              : {
                  type: 'tool-approval-request',
                  approvalId: id,
                  toolCallId: nativeId,
                }
          );
          const approved = await decision;
          if (!active()) break;
          if (!approved) {
            tool.status = 'denied';
            if (protocol === 'ai-sdk')
              emit({ type: 'tool-output-denied', toolCallId: nativeId });
            else
              emit({
                type: 'CUSTOM',
                name: 'benchmark-approval-denied',
                value: { toolCallId: nativeId },
              });
            if (protocol === 'ag-ui')
              emit({ type: 'TEXT_MESSAGE_END', messageId });
            if (protocol === 'ag-ui')
              emit({ type: 'RUN_FINISHED', threadId, runId: nativeRunId });
            else emit({ type: 'finish' });
            finish('denied');
            return;
          }
          record.status = 'running';
        }
        await sleep(scenario.delayMs ?? toolDelayMs, run.controller.signal);
        if (!active()) break;
        tool.executedAt = Date.now();
        tool.executionCount++;
        let result;
        try {
          if (scenario.recoverableRead === call.id && !recovery) {
            recoveries.set(recoveryKey, { participant, runId: id });
            throw new Error(
              'Read temporarily unavailable; explicit read-only retry required'
            );
          }
          result = await executeTool(call.name, call.args, {
            approved: record.approved === true,
            save(text) {
              const note = { id: 'note-' + (notes.length + 1), text };
              notes.push(note);
              return { saved: true, id: note.id };
            },
          });
        } catch (error) {
          tool.status = 'error';
          tool.errorHash = hashValue(error.message);
          const recoverable =
            scenario.continueOnError || scenario.recoverableRead;
          if (protocol === 'ag-ui' && recoverable)
            emit({
              type: 'TOOL_CALL_RESULT',
              messageId: nativeId + '-error',
              toolCallId: nativeId,
              role: 'tool',
              content: JSON.stringify({
                error: error.message,
                recoverable: true,
              }),
            });
          emit(
            protocol === 'ag-ui'
              ? scenario.continueOnError
                ? {
                    type: 'CUSTOM',
                    name: 'benchmark-read-error',
                    value: { toolCallId: nativeId, message: error.message },
                  }
                : {
                    type: 'RUN_ERROR',
                    message: error.message,
                    code: 'BENCHMARK_TOOL_ERROR',
                  }
              : {
                  type: 'tool-output-error',
                  toolCallId: nativeId,
                  errorText: error.message,
                }
          );
          if (scenario.continueOnError) continue;
          if (protocol === 'ai-sdk')
            emit({ type: 'finish', finishReason: 'error' });
          finish('error');
          return;
        }
        if (!active()) break;
        tool.status = 'complete';
        tool.resultHash = hashValue(result);
        tool.resultPublishedAt = Date.now();
        emit(
          protocol === 'ag-ui'
            ? {
                type: 'TOOL_CALL_RESULT',
                messageId: nativeId + '-result',
                toolCallId: nativeId,
                role: 'tool',
                content: JSON.stringify(result),
              }
            : {
                type: 'tool-output-available',
                toolCallId: nativeId,
                output: result,
              }
        );
        if (citeSources) {
          const before = cited.size;
          for (const row of Array.isArray(result) ? result : [result])
            if (
              row &&
              typeof row === 'object' &&
              typeof row.url === 'string' &&
              typeof row.title === 'string' &&
              !cited.has(row.url)
            )
              cited.set(row.url, {
                id: 'source-' + (cited.size + 1),
                index: cited.size + 1,
                title: row.title,
                url: row.url,
                snippet: typeof row.summary === 'string' ? row.summary : '',
              });
          if (cited.size > before)
            emit({
              type: 'STATE_SNAPSHOT',
              snapshot: { citations: { [messageId]: [...cited.values()] } },
            });
        }
      }
      if (!active()) return;
      if (protocol === 'ag-ui') {
        emit({
          type: 'TEXT_MESSAGE_CONTENT',
          messageId,
          delta: scenario.conclusion,
        });
        emit({ type: 'TEXT_MESSAGE_END', messageId });
        emit({ type: 'RUN_FINISHED', threadId, runId: nativeRunId });
      } else {
        emit({ type: 'text-start', id: messageId + '-text' });
        emit({
          type: 'text-delta',
          id: messageId + '-text',
          delta: scenario.conclusion,
        });
        emit({ type: 'text-end', id: messageId + '-text' });
        emit({ type: 'finish' });
      }
      finish(
        record.tools.some((tool) => tool.status === 'error')
          ? 'partial'
          : 'complete'
      );
    } catch {
      if (!response.headersSent)
        json(400, { error: 'Invalid benchmark request' });
      else response.end();
    }
  });
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', done);
  });
  address = server.address();
  return {
    url: 'http://127.0.0.1:' + address.port,
    receipts: () =>
      structuredClone([...runs.values()].map((run) => run.record)),
    savedNotes: () => structuredClone(notes),
    activeStreams: () => streams.size,
    async close() {
      for (const run of streams) stop(run);
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    },
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const server = await createBenchmarkServer();
  process.stdout.write(
    JSON.stringify({ url: server.url, scriptedAgent: true }) + '\n'
  );
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await server.close();
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}
