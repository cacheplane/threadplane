import { getTestBed } from '@angular/core/testing';
import { ReadableStream, TransformStream } from 'node:stream/web';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';

getTestBed().initTestEnvironment(
  BrowserTestingModule,
  platformBrowserTesting(),
  {
    teardown: { destroyAfterEach: true },
  }
);
Object.assign(globalThis, { ReadableStream, TransformStream });
(
  window as Window & { __THREADPLANE_TELEMETRY_DISABLED__?: boolean }
).__THREADPLANE_TELEMETRY_DISABLED__ = true;
