import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@langchain/langgraph-sdk';
import { createStreamingApplication } from '../../../../cockpit/langgraph/streaming/react/src/application.js';
import { createSession } from '../../../../libs/langgraph/src/runtime/create-session.js';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
interface RequestObservation {
  id: string;
  method: string;
  path: string;
  body: Json;
  status: number | null;
}
export interface WorkbenchRecording {
  version: 1;
  provenance: { kind: 'sdk-fixture'; description: string; source: string };
  frames: {
    id: string;
    label: string;
    elapsedMs: number;
    messages: { id: string; role: string; text: string }[];
    state: Json;
    requests: RequestObservation[];
    event: { type: string; payload: Json };
  }[];
}

// Authored fixture RESPONSE, never authored observation frames. No tools run.
const prompt =
  'Recap this supplied Paris itinerary: day 1 Louvre and Tuileries; day 2 Montmartre and a cafe. Walk between nearby stops. Do not call tools.';
const chunks = [
  'Here is your Paris itinerary.\n\n',
  'Day 1: Visit the Louvre, then walk through the Tuileries.\n',
  'Day 2: Explore Montmartre and stop at a cafe.\n\n',
  'Walk between nearby stops and leave time to enjoy each neighborhood.',
];

/** Author-time only: runs the real example application and SDK against loopback. */
export async function captureWorkbench(
  options: { maxFrames?: number; maxBytes?: number } = {}
): Promise<WorkbenchRecording> {
  const maxFrames = Math.min(options.maxFrames ?? 120, 120);
  const maxBytes = Math.min(options.maxBytes ?? 200_000, 200_000);
  const started = performance.now();
  const requests: RequestObservation[] = [];
  const recording: WorkbenchRecording = {
    version: 1,
    provenance: {
      kind: 'sdk-fixture',
      description:
        'Real streaming application and LangGraph SDK observations with a deterministic local HTTP/SSE fixture response. State is an allowlisted application state projection (creation, busy, canSubmit, outcome), not itinerary or provider state. Requests are observed application HTTP at the fixture server, with status when its response headers are sent. elapsedMs is measured capture time; playback pacing is separate.',
      source: 'examples/chat/native/tooling/capture-workbench.ts',
    },
    frames: [],
  };
  let application: ReturnType<typeof createStreamingApplication> | undefined;
  let failure: Error | undefined;
  const ids = new Map<string, string>();
  const messageId = (id: string) => {
    if (!ids.has(id)) ids.set(id, `message-${ids.size + 1}`);
    return ids.get(id)!;
  };
  function observe(
    type: string,
    label: string,
    payload: Json = null,
    observeState = true
  ) {
    if (failure) return;
    const snapshot = application?.getSnapshot();
    const frame: WorkbenchRecording['frames'][number] = {
      id: `frame-${recording.frames.length + 1}`,
      label,
      elapsedMs: Math.round((performance.now() - started) * 1000) / 1000,
      messages:
        snapshot?.rows.map((row) => ({
          id: messageId(row.id),
          role: row.role,
          text: row.markdown.document.content,
        })) ?? [],
      state:
        observeState && snapshot
          ? {
              creation: snapshot.creation,
              busy: snapshot.busy,
              canSubmit: snapshot.canSubmit,
              outcome: snapshot.outcome,
            }
          : null,
      requests: structuredClone(requests),
      event: { type, payload: structuredClone(payload) },
    };
    if (
      recording.frames.length >= maxFrames ||
      Buffer.byteLength(
        JSON.stringify({ ...recording, frames: [...recording.frames, frame] })
      ) > maxBytes
    ) {
      failure = new Error('Workbench capture limit exceeded');
      return;
    }
    recording.frames.push(frame);
  }
  const server = createServer(async (incoming, outgoing) => {
    try {
      const path = incoming.url;
      assert.equal(incoming.method, 'POST');
      assert.ok(
        path === '/threads' || path === '/threads/trip-thread/runs/stream',
        `Unexpected fixture path: ${path}`
      );
      const bytes: Buffer[] = [];
      let size = 0;
      for await (const chunk of incoming) {
        size += chunk.length;
        assert.ok(size <= 16_384, 'Fixture request limit exceeded');
        bytes.push(Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(bytes).toString());
      assert.ok(requests.length < 2, 'Unexpected fixture request');
      // Allowlist only this lesson's request fields. Never copy headers, config,
      // connection URLs, metadata or arbitrary JSON from a runtime response.
      const safeBody: Json =
        path === '/threads'
          ? {}
          : {
              assistant_id: String(body.assistant_id),
              input: {
                messages: body.input.messages.map(
                  (message: { id: string; type: string; content: string }) => ({
                    id: messageId(message.id),
                    type: String(message.type),
                    content: String(message.content),
                  })
                ),
              },
              stream_mode: body.stream_mode.map(String),
            };
      const request: RequestObservation = {
        id: `request-${requests.length + 1}`,
        method: 'POST',
        path,
        body: safeBody,
        status: null,
      };
      requests.push(request);
      observe('http.request', 'Application HTTP request received', {
        requestId: request.id,
      });
      outgoing.writeHead(200, {
        'content-type':
          path === '/threads' ? 'application/json' : 'text/event-stream',
      });
      outgoing.flushHeaders();
      request.status = 200;
      observe('http.response', 'Fixture response headers sent', {
        requestId: request.id,
        status: 200,
      });
      if (path === '/threads') {
        outgoing.end(JSON.stringify({ thread_id: 'trip-thread' }));
        return;
      }
      for (const content of chunks) {
        if (outgoing.destroyed) return;
        outgoing.write(
          `event: messages\ndata: ${JSON.stringify([
            { type: 'AIMessageChunk', id: 'fixture-answer', content },
            {},
          ])}\n\n`
        );
        // Separate network chunks, not replay pacing. elapsedMs is measured.
        await delay(20);
      }
      outgoing.write(
        `event: values\ndata: ${JSON.stringify({
          messages: [
            ...body.input.messages,
            { type: 'ai', id: 'fixture-answer', content: chunks.join('') },
          ],
        })}\n\n`
      );
      outgoing.end();
    } catch (error) {
      failure ??= new Error('Unexpected local fixture request', {
        cause: error,
      });
      outgoing.destroy();
    }
  });
  let release = () => {};
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((yes, no) => {
      server.once('error', no);
      server.listen(0, '127.0.0.1', yes);
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const apiUrl = `http://127.0.0.1:${address.port}`;
    const client = new Client({
      apiUrl,
      apiKey: null,
      callerOptions: { maxRetries: 0 },
    });
    application = createStreamingApplication({
      createThread: async (signal) =>
        (await client.threads.create({ signal })).thread_id,
      sessionFactory: (threadId) =>
        createSession({
          assistantId: 'streaming',
          threadId,
          apiUrl,
          clientOptions: { maxRetries: 0 },
        }),
    });
    observe(
      'capture.start',
      'Capture started; state not yet observed',
      null,
      false
    );
    observe('application.snapshot', 'Initial application snapshot');
    release = application.subscribe(() =>
      observe('application.snapshot', 'Application snapshot changed')
    );
    await Promise.race([
      application.submit(prompt),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Workbench capture timed out')),
          5000
        );
      }),
    ]);
    if (failure) throw failure;
    assert.equal(application.getSnapshot().outcome, 'success');
    observe('capture.complete', 'Response complete');
    if (failure) throw failure;
    return recording;
  } finally {
    clearTimeout(timeout);
    release();
    await application?.dispose();
    server.closeAllConnections();
    await new Promise<void>((yes) => server.close(() => yes()));
  }
}
