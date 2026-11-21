import { describe, expect, it } from 'vitest';
import {
  agentStateUpdateFromEvent,
  contentBlocksText,
  projectAgentError,
  projectErrorDiagnostic,
} from '../index';

describe('projectErrorDiagnostic', () => {
  it('describes an error and its causes as frozen plain data', () => {
    class HttpError extends Error {
      override name = 'HttpError';
      status = 503;
      code = 'UPSTREAM';
      body = { retryAfter: 2, headers: new Headers(), run: () => 1 };
    }
    const root = new TypeError('socket closed');
    const error = new HttpError('Service unavailable', { cause: root });
    const diagnostic = projectErrorDiagnostic(error);
    expect(diagnostic).toEqual({
      name: 'HttpError',
      message: 'Service unavailable',
      stack: error.stack,
      code: 'UPSTREAM',
      status: 503,
      data: { body: { retryAfter: 2, headers: '[object Headers]' } },
      cause: { name: 'TypeError', message: 'socket closed', stack: root.stack },
    });
    expect(Object.getPrototypeOf(diagnostic)).toBe(Object.prototype);
    expect(Object.isFrozen(diagnostic)).toBe(true);
    expect(Object.isFrozen(diagnostic.cause)).toBe(true);
    expect(Object.isFrozen(diagnostic.data)).toBe(true);
    expect(() => structuredClone(diagnostic)).not.toThrow();
    expect(JSON.parse(JSON.stringify(diagnostic))).toEqual(diagnostic);
  });

  it('describes thrown values that are not errors', () => {
    expect(projectErrorDiagnostic('boom')).toEqual({ message: 'boom' });
    expect(projectErrorDiagnostic(undefined)).toEqual({ message: 'undefined' });
    expect(projectErrorDiagnostic({ reason: 'quota', left: 0 })).toEqual({
      message: 'A value that is not an error was thrown.',
      data: { reason: 'quota', left: 0 },
    });
    expect(projectErrorDiagnostic({ message: 'bad', data: [1, 2] })).toEqual({
      message: 'bad',
      data: [1, 2],
    });
  });

  it('survives cycles and unbounded nesting', () => {
    const cyclic = new Error('loop') as Error & { self?: unknown };
    cyclic.self = cyclic;
    cyclic.cause = cyclic;
    const described = projectErrorDiagnostic(cyclic);
    expect(described.cause).toEqual({ message: '[omitted]' });
    expect(described.data).toEqual({ self: '[omitted]' });

    let deep: Error = new Error('bottom');
    for (let depth = 0; depth < 50; depth++)
      deep = new Error(`level ${depth}`, { cause: deep });
    expect(() => JSON.stringify(projectErrorDiagnostic(deep))).not.toThrow();
  });
});

describe('projectAgentError and diagnostics', () => {
  it('keeps the error a display projection: a diagnostic never rides on it', () => {
    const source = Object.assign(
      new Error('Connection dropped', { cause: new Error('raw') }),
      {
        kind: 'connection' as const,
        retryable: true,
        diagnostic: projectErrorDiagnostic(new Error('raw')),
      }
    );
    const projected = projectAgentError(source);
    expect(projected).not.toHaveProperty('diagnostic');
    expect(projected).not.toHaveProperty('cause');
    expect(projected).not.toHaveProperty('stack');
  });
});

describe('contentBlocksText', () => {
  it('joins the text blocks in order and ignores the rest', () => {
    expect(
      contentBlocksText([
        { type: 'text', text: 'See ' },
        { type: 'image', url: 'https://example.test/a.png', alt: 'ignored' },
        { type: 'tool_use', id: 't', name: 'lookup', args: { q: 'x' } },
        { type: 'text', text: 'this.' },
        { type: 'tool_result', toolCallId: 't', result: 'ignored' },
      ])
    ).toBe('See this.');
    expect(contentBlocksText([])).toBe('');
  });
});

describe('agentStateUpdateFromEvent', () => {
  it('reads only state_update events that carry an object', () => {
    const data = { '/a': 1 };
    expect(agentStateUpdateFromEvent({ name: 'state_update', data })).toBe(
      data
    );
    for (const other of [null, undefined, 'text', 3, [1]])
      expect(
        agentStateUpdateFromEvent({ name: 'state_update', data: other })
      ).toBeUndefined();
    expect(
      agentStateUpdateFromEvent({ name: 'progress', data })
    ).toBeUndefined();
  });
});
