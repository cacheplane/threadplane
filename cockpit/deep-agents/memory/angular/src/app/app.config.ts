import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';
import { ApplicationConfig, inject, signal } from '@angular/core';
import { MemoryScope } from './memory-scope';
import { MemoryTransport } from './memory-transport';
import {
  provideAgent,
  ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER,
} from '@threadplane/langgraph';

export const appConfig: ApplicationConfig = {
  providers: [
    provideAgent(() => {
      const connection = injectCockpitRuntimeConnection();
      if (connection.adapter !== 'langgraph') {
        throw new Error('incompatible runtime');
      }
      const scope = inject(MemoryScope);
      const threadId = signal<string | null>(null);
      const onThreadId = (id: string) => threadId.set(id);
      const clientOptions = { ...connection.clientOptions, maxRetries: 0 };
      const transport = new MemoryTransport(
        connection.apiUrl,
        scope,
        onThreadId,
        clientOptions,
        inject(ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER, { optional: true }) ??
          undefined
      );
      return {
        apiUrl: connection.apiUrl,
        assistantId: connection.assistantId,
        clientOptions,
        threadId,
        onThreadId,
        transport,
      };
    }),
  ],
};
