import { getTestBed } from '@angular/core/testing';
// Default tests never submit automatic collector traffic; dedicated integration tests use controlled sinks.
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
