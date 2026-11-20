import { describe, expect, it, vi } from 'vitest';
import { createCanonicalDemoRuntimeTelemetrySink, oncePerAgent } from './runtime-telemetry';

describe('oncePerAgent', () => {
  it('forwards the first runtime_instance_created and drops the ones later sessions report', async () => {
    const sink = vi.fn().mockResolvedValue(undefined);
    const once = oncePerAgent(sink);
    const created = {
      event: 'tplane:runtime_instance_created',
      properties: { transport: 'langgraph', surface: 'agent' },
    } as const;
    const request = {
      event: 'tplane:runtime_request_created',
      properties: { transport: 'langgraph', surface: 'agent', requestType: 'submit' },
    } as const;

    await once(created);
    // A thread switch builds a new session, which reports itself again.
    await once(created);
    await once(request);
    await once(request);

    expect(sink.mock.calls.map(([payload]) => payload.event)).toEqual([
      'tplane:runtime_instance_created',
      'tplane:runtime_request_created',
      'tplane:runtime_request_created',
    ]);
  });
});

describe('createCanonicalDemoRuntimeTelemetrySink', () => {
  it('forwards runtime events through browser telemetry with canonical demo properties', async () => {
    const capture = vi.fn().mockResolvedValue(undefined);
    const sink = createCanonicalDemoRuntimeTelemetrySink(
      { capture },
      () => 'gpt-5-mini',
    );

    await sink({
      event: 'tplane:runtime_request_created',
      properties: {
        transport: 'langgraph',
        surface: 'agent',
        requestType: 'submit',
      },
    });

    expect(capture).toHaveBeenCalledWith('tplane:runtime_request_created', {
      transport: 'langgraph',
      surface: 'canonical_demo',
      requestType: 'submit',
      model: 'gpt-5-mini',
    });
  });

  it('does not forward request content fields from runtime telemetry payloads', async () => {
    const capture = vi.fn().mockResolvedValue(undefined);
    const sink = createCanonicalDemoRuntimeTelemetrySink(
      { capture },
      () => 'gpt-5-mini',
    );

    const propertiesWithUnexpectedContent = {
      transport: 'langgraph',
      surface: 'agent',
      requestType: 'submit',
      messages: [{ content: 'hello' }],
      threadId: 'thread-1',
      assistantId: 'chat',
      apiUrl: '/api',
    } as Parameters<typeof sink>[0]['properties'] & Record<string, unknown>;

    await sink({
      event: 'tplane:runtime_request_created',
      properties: propertiesWithUnexpectedContent,
    });

    const forwarded = capture.mock.calls[0]?.[1];
    expect(forwarded).not.toHaveProperty('messages');
    expect(forwarded).not.toHaveProperty('threadId');
    expect(forwarded).not.toHaveProperty('assistantId');
    expect(forwarded).not.toHaveProperty('apiUrl');
  });
});
