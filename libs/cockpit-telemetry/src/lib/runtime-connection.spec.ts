// @vitest-environment jsdom
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_CLIENT_OPTIONS,
  injectAgent,
  injectThreadDirectory,
  provideAgent,
  provideThreadDirectory,
} from '@threadplane/angular';
import { createSession as createAgUiSession } from '@threadplane/ag-ui';
import {
  createLangGraphThreadDirectory,
  createSession,
  type LangGraphThreadsClient,
} from '@threadplane/langgraph';
import {
  COCKPIT_RUNTIME_CONNECTION,
  injectCockpitRuntimeConnection,
  type CockpitRuntimeConnection,
} from './runtime-connection';

let agentConnection: CockpitRuntimeConnection | undefined;
let threadsConnection: CockpitRuntimeConnection | undefined;
let directoryClientOptions: object | undefined;

const threadsClient = {
  threads: {
    search: async () => [],
  },
} as unknown as LangGraphThreadsClient;

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
        createSession: (context) =>
          createSession({
            apiUrl: connection.apiUrl,
            assistantId: connection.assistantId,
            clientOptions: connection.clientOptions,
            threadId: context.threadId,
            onThreadId: context.onThreadId,
          }),
      };
    }),
    provideThreadDirectory(() => {
      const connection = injectCockpitRuntimeConnection();
      threadsConnection = connection;
      if (connection.adapter !== 'langgraph')
        throw new Error('incompatible runtime');
      return {
        createDirectory: (context) => {
          directoryClientOptions = context.clientOptions;
          return createLangGraphThreadDirectory({
            apiUrl: connection.apiUrl,
            client: threadsClient,
            projects: false,
          });
        },
      };
    }),
    {
      provide: AGENT_CLIENT_OPTIONS,
      useFactory: () => {
        const connection = injectCockpitRuntimeConnection();
        if (connection.adapter !== 'langgraph')
          throw new Error('incompatible runtime');
        return connection.clientOptions;
      },
    },
  ],
})
class ScopedLangGraphComponent {
  readonly agent = injectAgent();
  readonly threads = injectThreadDirectory();
}

@Component({
  standalone: true,
  template: '',
  providers: [
    provideAgent(() => {
      const connection = injectCockpitRuntimeConnection();
      agentConnection = connection;
      if (connection.adapter !== 'ag-ui')
        throw new Error('incompatible runtime');
      return {
        createSession: (context) =>
          createAgUiSession({
            url: connection.url,
            threadId: context.threadId ?? undefined,
          }),
      };
    }),
  ],
})
class ScopedAgUiComponent {
  readonly agent = injectAgent();
}

describe('Cockpit runtime connection DI seam', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    agentConnection = undefined;
    threadsConnection = undefined;
    directoryClientOptions = undefined;
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
    // The component-scoped client options reach the thread directory factory.
    expect(directoryClientOptions).toBe(connection.clientOptions);
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

    const fixture = TestBed.createComponent(ScopedAgUiComponent);

    expect(fixture.componentInstance.agent).toBeDefined();
    expect(agentConnection).toBe(connection);
  });
});
