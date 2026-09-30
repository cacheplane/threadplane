//
// Wire-level resume tests against the REAL @ag-ui/client HttpAgent (0.0.59).
//
// The stub-based specs in to-agent.resume.spec.ts assert what the adapter
// hands to runAgent(); these specs assert what actually leaves over HTTP —
// prepareRunAgentInput assembly included. That distinction is the whole
// story of this upgrade: on 0.0.52 prepareRunAgentInput dropped a top-level
// `resume` at assembly, so the parameter-level shape never reached the wire.
//
// Each test replays a REAL captured interrupt transcript (fixtures/
// runtime-transcripts/, 2026-08-31 runtime-portability spikes) through the
// real client, submits a resume, and compares the serialized request body
// against the request MEASURED to work for that runtime. Fixture payloads
// are verbatim from the wire — do not edit them.
//
// Byte-equality caveats (each documented at the assertion):
// - `runId` is minted per run by the client (uuid v4); the spike drivers
//   used fixed ids. Excluded from equality, asserted to be a string.
// - `messages` are the client's accumulated thread (set by the interrupt
//   run's MESSAGES_SNAPSHOT), so the resume request legitimately resends the
//   assistant tool-call message too; the spike drivers resent only the user
//   message. The user message is asserted byte-equal (its id is
//   deterministic — the snapshot assigned it); the array as a whole is not.
// Every other top-level field is compared byte-for-byte.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpAgent } from '@ag-ui/client';
import { PROTOCOL_VERSION } from '@ag-ui/core';
import { toAgent } from './to-agent';

const FIXTURES_DIR = join(__dirname, '../../fixtures/runtime-transcripts');

/** Build a text/event-stream Response from a fixture's `data:` lines
 *  (non-data lines, such as maf-hitl-resume.sse's `__request__` header line,
 *  are capture metadata and not part of the SSE stream).
 *
 *  The events' TOP-LEVEL `threadId`/`runId` are re-stamped with the ids of
 *  the request being answered — exactly what the real servers do (they echo
 *  the ids the client sent; the spike drivers picked their own run ids,
 *  while the 0.0.59 client mints a uuid per run). Payloads are otherwise
 *  verbatim from the capture. */
function sseResponseFromFixture(name: string, request: Record<string, unknown>): Response {
  const raw = readFileSync(join(FIXTURES_DIR, name), 'utf8');
  const body = raw
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => {
      const event = JSON.parse(line.slice('data:'.length)) as Record<string, unknown>;
      if ('threadId' in event) event['threadId'] = request['threadId'];
      if ('runId' in event) event['runId'] = request['runId'];
      return `data: ${JSON.stringify(event)}`;
    })
    .join('\n\n') + '\n\n';
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** SYNTHETIC minimal success run for the resume response — these tests are
 *  about the outgoing resume REQUEST; the response just has to be a valid
 *  stream so the run settles. */
function syntheticSuccessResponse(request: Record<string, unknown>): Response {
  const { threadId, runId } = request;
  const body = [
    `data: ${JSON.stringify({ type: 'RUN_STARTED', threadId, runId })}`,
    `data: ${JSON.stringify({ type: 'RUN_FINISHED', threadId, runId })}`,
  ].join('\n\n') + '\n\n';
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function readCapturedRequest(name: string): Record<string, unknown> {
  const raw = readFileSync(join(FIXTURES_DIR, name), 'utf8');
  if (name.endsWith('.request.json')) return JSON.parse(raw) as Record<string, unknown>;
  const firstLine = raw.split('\n', 1)[0];
  return (JSON.parse(firstLine) as { __request__: Record<string, unknown> }).__request__;
}

interface WireHarness {
  agent: ReturnType<typeof toAgent>;
  source: HttpAgent;
  bodies: () => Array<Record<string, unknown>>;
}

/** Real HttpAgent whose fetch is fed queued fixture responses; every request
 *  body is recorded for wire-shape assertions. */
function wireHarness(
  threadId: string,
  responses: Array<(request: Record<string, unknown>) => Response>,
  options: Parameters<typeof toAgent>[1] = {},
): WireHarness {
  const bodies: Array<Record<string, unknown>> = [];
  let call = 0;
  const fetchMock = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(request);
    const next = responses[call] ?? responses[responses.length - 1];
    call += 1;
    return next(request);
  });
  const source = new HttpAgent({
    url: 'http://spike.invalid/agent',
    threadId,
    fetch: fetchMock as unknown as ConstructorParameters<typeof HttpAgent>[0]['fetch'],
  });
  return { agent: toAgent(source, options), source, bodies: () => bodies };
}

describe('AWS Strands resume over the wire (0.0.59 top-level resume array)', () => {
  it('serializes the measured working request', async () => {
    const { agent, source, bodies } = wireHarness('th-int-555800', [
      (request) => sseResponseFromFixture('strands-interrupt.sse', request),
      (request) => syntheticSuccessResponse(request),
    ]);

    await agent.submit({ message: 'Schedule a meeting with Dana about the Q3 roadmap.' });
    expect(agent.interrupt!()).toBeDefined();
    // 0.0.59 client-side ledger recorded the RUN_FINISHED interrupt outcome.
    expect(source.pendingInterrupts).toHaveLength(1);

    await agent.submit({ resume: { chosen_label: 'Tuesday 10:00' } });
    expect(agent.error()).toBeUndefined();

    const measured = readCapturedRequest('strands-resume.request.json');
    expect(bodies()).toHaveLength(2);
    const body = bodies()[1];

    // Byte-equality on everything except the documented volatile fields.
    const { runId: measuredRunId, messages: measuredMessages, ...measuredRest } = measured;
    const { runId, messages, protocolVersion, ...rest } = body as {
      runId: unknown; messages: Array<Record<string, unknown>>; protocolVersion: unknown;
    } & Record<string, unknown>;
    expect(rest).toEqual(measuredRest);
    // protocolVersion: the 1.0 client declares itself in-band; the measured
    // 0.x capture has no version (a pre-1.0 peer).
    expect(protocolVersion).toBe(PROTOCOL_VERSION);
    // runId: client-minted uuid per run; the spike driver sent 'run-2'.
    expect(typeof runId).toBe('string');
    expect(runId).not.toBe(measuredRunId);
    // messages[0]: the user message, byte-equal — id included, because the
    // interrupt run's MESSAGES_SNAPSHOT assigned it deterministically. The
    // client also resends the snapshot's assistant tool-call message, which
    // the spike driver omitted; Strands keys resume on the top-level resume
    // array (measured), not on the resent messages.
    expect(messages[0]).toEqual((measuredMessages as unknown[])[0]);
  });

  it('rejects a plain submit while retaining the pending interrupt ledger', async () => {
    const { agent, source, bodies } = wireHarness('th-int-555800', [
      (request) => sseResponseFromFixture('strands-interrupt.sse', request),
      (request) => syntheticSuccessResponse(request),
    ]);

    await agent.submit({ message: 'Schedule a meeting with Dana about the Q3 roadmap.' });
    expect(source.pendingInterrupts).toHaveLength(1);

    const pendingInterrupts = [...source.pendingInterrupts];
    const messages = agent.messages();
    await expect(agent.submit({ message: 'Never mind, cancel that.' })).rejects.toThrow('Resolve the pending interrupt');
    expect(agent.error()).toBeUndefined();
    expect(bodies()).toHaveLength(1);
    expect(source.pendingInterrupts).toEqual(pendingInterrupts);
    expect(agent.messages()).toEqual(messages);
    expect(agent.interrupt!()).toBeDefined();
  });
});

describe('Microsoft Agent Framework resume over the wire', () => {
  it('serializes top-level resume entries addressing the measured pending interrupt', async () => {
    const { agent, source, bodies } = wireHarness('thread-06-hitl-interrupt', [
      (request) => sseResponseFromFixture('maf-hitl-interrupt.sse', request),
      (request) => syntheticSuccessResponse(request),
    ]);

    await agent.submit({ message: 'Plan the task: build a birdhouse.' });
    expect(agent.interrupt!()).toBeDefined();
    expect(source.pendingInterrupts).toHaveLength(1);

    await agent.submit({ resume: { approved: true } });
    expect(agent.error()).toBeUndefined();

    expect(bodies()).toHaveLength(2);
    const body = bodies()[1];
    const measured = readCapturedRequest('maf-hitl-resume.sse');

    // The measured working request carried the entries under the
    // pre-standard forwardedProps.command.resume location keyed `id`. The
    // bridge reads the protocol-standard top-level field FIRST
    // (_extract_resume_payload checks input.resume before
    // forwardedProps.command.resume) and accepts `interruptId`, so the wire
    // moves to the standard location; identity, status, and payload are
    // asserted against the measured entries.
    const measuredEntries = (
      measured['forwardedProps'] as { command: { resume: Array<Record<string, unknown>> } }
    ).command.resume;
    expect(body['resume']).toEqual(
      measuredEntries.map(({ id, ...restEntry }) => ({ interruptId: id, ...restEntry })),
    );
    expect(body['forwardedProps']).toEqual({});
    expect(body['threadId']).toBe(measured['threadId']);
    // The 1.0 client declares itself in-band; the measured 0.x capture has no
    // version, which the spec's versioning rules treat as a pre-1.0 peer.
    expect(body['protocolVersion']).toBe(PROTOCOL_VERSION);
  });
});

describe('Mastra resume over the wire (forwardedProps shape preserved)', () => {
  // Mastra emits BOTH the CUSTOM on_interrupt convention (first) and the
  // RUN_FINISHED interrupt outcome — so on 0.0.59 the client ledger records
  // a pending interrupt even though the measured working resume rides
  // forwardedProps.command with NO top-level resume. The adapter must clear
  // the ledger and reproduce the 0.0.52-measured request byte-for-byte.
  it('reproduces the measured forwardedProps request with no top-level resume', async () => {
    const { agent, source, bodies } = wireHarness('thread-hitl-1', [
      (request) => sseResponseFromFixture('mastra-reinterrupt.sse', request),
      (request) => syntheticSuccessResponse(request),
    ], { interruptTransport: 'mastra-command' });

    await agent.submit({ message: 'Schedule a meeting with Dana about the Q4 roadmap.' });
    expect(agent.interrupt!()).toBeDefined();
    expect(source.pendingInterrupts).toHaveLength(1);

    await agent.submit({ resume: { chosen_time: '2026-09-01T10:00' } });
    expect(agent.error()).toBeUndefined();

    expect(bodies()).toHaveLength(2);
    const body = bodies()[1];
    const measured = readCapturedRequest('mastra-resume-correct.request.json');
    expect(body['forwardedProps']).toEqual(measured['forwardedProps']);
    expect(body['resume']).toBeUndefined();
    expect(body['threadId']).toBe(measured['threadId']);
  });
});
