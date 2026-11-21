import { ɵAGENT_OPERATION_FAILURE_REPORTER } from '@threadplane/angular';
import { bootstrapWithCockpitHarness } from '@threadplane/cockpit-telemetry';
import { appConfig } from './app/app.config';
import { JsonRenderComponent } from './app/json-render.component';

void bootstrapWithCockpitHarness(JsonRenderComponent, appConfig, {
  runtime: {
    adapter: 'ag-ui',
    sharedUrl: new URL('agent', document.baseURI).pathname,
    operationReporterToken: ɵAGENT_OPERATION_FAILURE_REPORTER,
  },
}).catch(() => undefined);
