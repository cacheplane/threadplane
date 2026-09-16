// @vitest-environment jsdom
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Client } from '@langchain/langgraph-sdk';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  injectAgent as injectAgUiAgent,
  provideAgent as provideAgUiAgent,
} from '@threadplane/ag-ui';
import {
  LANGGRAPH_CLIENT,
  LANGGRAPH_CLIENT_OPTIONS,
  LANGGRAPH_THREADS_CONFIG,
  LangGraphThreadsAdapter,
  injectAgent,
  provideAgent,
} from '@threadplane/langgraph';
import {
  COCKPIT_RUNTIME_CONNECTION,
  injectCockpitRuntimeConnection,
  type CockpitRuntimeConnection,
} from './runtime-connection';

let agentConnection: CockpitRuntimeConnection | undefined;
let threadsConnection: CockpitRuntimeConnection | undefined;

const threadsClient = {
  threads: {
    search: async () => [],
  },
} as unknown as Client;

@Component({
  standalone: true,
  template: '',
  providers: [
    provideAgent(() => {
      const connection = injectCockpitRuntimeConnection();
      agentConnection = connection;
      if (connection.adapter !== 'langgraph')
        throw new Error('incompatible runtime');
      return {
        apiUrl: connection.apiUrl,
        assistantId: connection.assistantId,
        clientOptions: connection.clientOptions,
      };
    }),
    LangGraphThreadsAdapter,
    {
      provide: LANGGRAPH_THREADS_CONFIG,
      useFactory: () => {
        const connection = injectCockpitRuntimeConnection();
        threadsConnection = connection;
        if (connection.adapter !== 'langgraph')
          throw new Error('incompatible runtime');
        return { apiUrl: connection.apiUrl };
      },
    },
    {
      provide: LANGGRAPH_CLIENT_OPTIONS,
      useFactory: () => {
        const connection = injectCockpitRuntimeConnection();
        if (connection.adapter !== 'langgraph')
          throw new Error('incompatible runtime');
        return connection.clientOptions;
      },
    },
    { provide: LANGGRAPH_CLIENT, useValue: threadsClient },
  ],
})
class ScopedLangGraphComponent {
  readonly agent = injectAgent();
  readonly threads = inject(LangGraphThreadsAdapter);
}

@Component({
  standalone: true,
  template: '',
  providers: [
    provideAgUiAgent(() => {
      const connection = injectCockpitRuntimeConnection();
      agentConnection = connection;
      if (connection.adapter !== 'ag-ui')
        throw new Error('incompatible runtime');
      return { url: connection.url };
    }),
  ],
})
class ScopedAgUiComponent {
  readonly agent = injectAgUiAgent();
}

describe('Cockpit runtime connection DI seam', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    agentConnection = undefined;
    threadsConnection = undefined;
  });

  it('preserves component-scoped LangGraph Agent and threads provider factories', () => {
    const connection = {
      adapter: 'langgraph',
      apiUrl: 'https://runtime.example/api',
      assistantId: 'streaming',
      clientOptions: { defaultHeaders: { 'x-api-key': 'test-key-redact-me' } },
    } as const;
    TestBed.configureTestingModule({
      imports: [ScopedLangGraphComponent],
      providers: [
        { provide: COCKPIT_RUNTIME_CONNECTION, useValue: connection },
      ],
    });

    const fixture = TestBed.createComponent(ScopedLangGraphComponent);

    expect(fixture.componentInstance.agent).toBeDefined();
    expect(fixture.componentInstance.threads).toBeDefined();
    expect(agentConnection).toBe(connection);
    expect(threadsConnection).toBe(connection);
  });

  it('preserves a component-scoped AG-UI Agent provider factory', () => {
    const connection = {
      adapter: 'ag-ui',
      url: 'https://agent.example/run',
    } as const;
    TestBed.configureTestingModule({
      imports: [ScopedAgUiComponent],
      providers: [
        { provide: COCKPIT_RUNTIME_CONNECTION, useValue: connection },
      ],
    });

    TestBed.createComponent(ScopedAgUiComponent);

    expect(agentConnection).toBe(connection);
  });
});
