import { getTestBed } from '@angular/core/testing';
// Unit tests never send automatic development collection to a live destination.
(
  window as Window & { __THREADPLANE_TELEMETRY_DISABLED__?: boolean }
).__THREADPLANE_TELEMETRY_DISABLED__ = true;
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';

getTestBed().initTestEnvironment(
  BrowserTestingModule,
  platformBrowserTesting(),
  { teardown: { destroyAfterEach: true } }
);
