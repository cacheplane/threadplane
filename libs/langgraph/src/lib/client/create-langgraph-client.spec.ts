import { beforeEach, describe, expect, it, vi } from 'vitest';

const clientConstructor = vi.hoisted(() =>
  vi.fn(function Client() {
    return Object.create(null);
  })
);

vi.mock('@langchain/langgraph-sdk', () => ({ Client: clientConstructor }));

import { createLangGraphClient } from './create-langgraph-client';
import type { LangGraphClientOptions } from '../agent.types';

describe('createLangGraphClient', () => {
  beforeEach(() => clientConstructor.mockClear());

  it('passes apiUrl, defaultHeaders, and callerOptions to the SDK Client', () => {
    createLangGraphClient('https://runtime.example/api', {
      defaultHeaders: { Authorization: 'Bearer session-token' },
      maxRetries: 0,
    });

    expect(clientConstructor).toHaveBeenCalledWith({
      apiUrl: 'https://runtime.example/api',
      apiKey: null,
      defaultHeaders: { Authorization: 'Bearer session-token' },
      callerOptions: { maxRetries: 0 },
    });
  });

  it('always passes apiKey null so the SDK never attaches a key from the environment', () => {
    createLangGraphClient('https://runtime.example/api');

    expect(clientConstructor).toHaveBeenCalledWith({
      apiUrl: 'https://runtime.example/api',
      apiKey: null,
    });
  });

  it('forwards only the retry budget when no headers are configured', () => {
    // The absence of an `apiKey` member is pinned at compile time in
    // client-options.type-spec.ts, which the type-tests target checks.
    const options: LangGraphClientOptions = { maxRetries: 2 };
    createLangGraphClient('https://runtime.example/api', options);

    expect(clientConstructor).toHaveBeenCalledWith({
      apiUrl: 'https://runtime.example/api',
      apiKey: null,
      callerOptions: { maxRetries: 2 },
    });
  });
});
