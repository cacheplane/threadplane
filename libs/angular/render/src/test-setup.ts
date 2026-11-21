import { getTestBed } from '@angular/core/testing';
// Tests must never submit automatic collector traffic. Specific collector tests use controlled sinks.
if (typeof window !== 'undefined')
  (window as Window & { __THREADPLANE_TELEMETRY_DISABLED__?: boolean }).__THREADPLANE_TELEMETRY_DISABLED__ = true;
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';

getTestBed().initTestEnvironment(
  BrowserTestingModule,
  platformBrowserTesting(),
  { teardown: { destroyAfterEach: true } },
);
