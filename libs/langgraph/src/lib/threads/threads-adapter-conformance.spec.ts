import { TestBed } from '@angular/core/testing';
import type { Client } from '@langchain/langgraph-sdk';
import { describeThreadDirectoryConformance } from '../../runtime/testing/thread-directory-conformance';
import {
  LANGGRAPH_CLIENT,
  LANGGRAPH_THREADS_CONFIG,
  LangGraphThreadsAdapter,
} from './threads-adapter';

type CoreDirectory = ReturnType<
  Parameters<typeof describeThreadDirectoryConformance>[1]
>['directory'];

// The adapter's directory view must behave like the runtime directory. The
// fake client goes in through the existing LANGGRAPH_CLIENT token.
describeThreadDirectoryConformance(
  'angular adapter',
  (client) => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: LANGGRAPH_THREADS_CONFIG,
          useValue: { apiUrl: 'http://x', titleFallback: 'New chat' },
        },
        { provide: LANGGRAPH_CLIENT, useValue: client as unknown as Client },
      ],
    });
    const adapter = TestBed.inject(LangGraphThreadsAdapter);
    return {
      // The Angular contract differs from core only in create's metadata
      // value type; the conformance suite passes plain values.
      directory: adapter.directory as unknown as CoreDirectory,
      teardown: () => TestBed.resetTestingModule(),
    };
  },
  { projects: true }
);
