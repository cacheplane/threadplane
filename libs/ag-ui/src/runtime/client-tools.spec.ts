import type { RunAgentInput } from '@ag-ui/client';
import { describe, expect, it, vi } from 'vitest';
import { createSession } from './create-session';

const options = { threadId: 'catalog', url: 'http://unused.invalid' };
describe('private client tool catalog', () => {
  it('preserves omitted, null, and primitive opaque parameters without inventing a schema', async () => {
    const { captureClientTools, requestClientTools } = await import(
      './client-tools'
    );
    const handler = () => undefined;
    const captured = captureClientTools({
      omitted: { description: 'omitted', handler },
      nil: { description: 'null', parameters: null, handler },
      scalar: {
        description: 'scalar',
        parameters: 'opaque',
        followUp: false,
        handler,
      },
    });
    expect(requestClientTools(captured)).toEqual([
      { name: 'omitted', description: 'omitted' },
      { name: 'nil', description: 'null', parameters: null },
      { name: 'scalar', description: 'scalar', parameters: 'opaque' },
    ]);
    expect(captured.get('scalar')?.followUp).toBe(false);
  });
  it('enables an immutable empty projection only when a catalog is supplied, without fetching', async () => {
    const fetch = vi.fn();
    const plain = createSession({ ...options, fetch });
    const enabled = createSession({ ...options, fetch }, {});
    expect(plain.getSnapshot()).not.toHaveProperty('clientTools');
    const projection = enabled.getSnapshot().clientTools;
    expect(projection).toEqual({ calls: [] });
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.calls)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    await enabled.dispose();
    await plain.dispose();
  });
  it('captures only selected own definitions and fields once, retaining handlers and opaque metadata', async () => {
    const { captureClientTools, requestClientTools } = await import(
      './client-tools'
    );
    const reads: string[] = [];
    const handler = vi.fn((args: { city: string }) => args.city);
    const metadata = { unusual: ['opaque'], type: 'invented-schema' };
    const definition = {
      get description() {
        reads.push('description');
        return 'weather';
      },
      get parameters() {
        reads.push('parameters');
        return metadata;
      },
      get followUp() {
        reads.push('followUp');
        return undefined;
      },
      get handler() {
        reads.push('handler');
        return handler;
      },
      get idempotent() {
        throw new Error('unselected idempotent');
      },
      get unrelated() {
        throw new Error('unselected property');
      },
    };
    const catalog = Object.create({ inherited: definition });
    Object.defineProperty(catalog, 'weather', {
      enumerable: true,
      get() {
        reads.push('weather');
        return definition;
      },
    });
    const captured = captureClientTools(catalog);
    expect(reads).toEqual([
      'weather',
      'description',
      'parameters',
      'followUp',
      'handler',
    ]);
    expect(captured.size).toBe(1);
    expect(captured.get('weather')?.handler).toBe(handler);
    expect(captured.get('weather')?.followUp).toBe(true);
    metadata.unusual.push('caller mutation');
    const first = requestClientTools(captured);
    expect(first).toEqual([
      {
        name: 'weather',
        description: 'weather',
        parameters: { unusual: ['opaque'], type: 'invented-schema' },
      },
    ]);
    (first[0].parameters['unusual'] as string[]).push('request mutation');
    first[0].description = 'request mutation';
    expect(requestClientTools(captured)[0]).toEqual({
      name: 'weather',
      description: 'weather',
      parameters: { unusual: ['opaque'], type: 'invented-schema' },
    });
    expect(reads).toHaveLength(5);
    expect(handler).not.toHaveBeenCalled();
  });
  it('sends the constructor catalog on every actual submitted request without executing handlers', async () => {
    const bodies: RunAgentInput[] = [];
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const input = JSON.parse(String(init.body)) as RunAgentInput;
      bodies.push(input);
      return new Response(
        [
          { type: 'RUN_STARTED', threadId: input.threadId, runId: input.runId },
          {
            type: 'RUN_FINISHED',
            threadId: input.threadId,
            runId: input.runId,
          },
        ]
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(''),
        { headers: { 'content-type': 'text/event-stream' } }
      );
    });
    const handler = vi.fn((args: { city: string }) => args.city);
    const catalog = {
      weather: {
        description: 'original',
        parameters: { city: ['original'] },
        followUp: false,
        handler: handler as (args: { city: string }) => string,
      },
    };
    const owner = createSession({ ...options, fetch }, catalog);
    catalog.weather.description = 'changed';
    catalog.weather.parameters.city.push('changed');
    catalog.weather.handler = () => 'changed';
    expect(await owner.submit('first')).toBe('success');
    expect(bodies[0].tools).toHaveLength(1);
    bodies[0].tools[0].description = 'changed request';
    expect(await owner.submit('second')).toBe('success');
    expect(bodies[1].tools).toEqual([
      {
        name: 'weather',
        description: 'original',
        parameters: { city: ['original'] },
      },
    ]);
    expect(owner.getSnapshot().clientTools).toEqual({
      calls: [],
      commandOutcome: 'success',
    });
    expect(owner.getSnapshot().run?.terminal?.type).toBe('RUN_FINISHED');
    expect(handler).not.toHaveBeenCalled();
    await owner.dispose();
  });
  it.each([
    { description: 3, handler: () => 1 },
    { description: 'tool', handler: 3 },
    { description: 'tool', handler: () => 1, followUp: 'yes' },
    { description: 'tool', handler: () => 1, parameters: new Date() },
    {
      description: 'tool',
      handler: () => 1,
      parameters: { callback: () => 1 },
    },
  ])(
    'rejects incompatible selected catalog data before any fetch',
    (definition) => {
      const fetch = vi.fn();
      expect(() =>
        createSession({ ...options, fetch }, { invalid: definition } as never)
      ).toThrow(TypeError);
      expect(fetch).not.toHaveBeenCalled();
    }
  );
});
