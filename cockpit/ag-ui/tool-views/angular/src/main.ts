import { ɵAGENT_OPERATION_FAILURE_REPORTER } from '@threadplane/angular';
import { bootstrapWithCockpitHarness } from '@threadplane/cockpit-telemetry';
import { appConfig } from './app/app.config';
import { ToolViewsComponent } from './app/tool-views.component';

void bootstrapWithCockpitHarness(ToolViewsComponent, appConfig, {
  runtime: {
    adapter: 'ag-ui',
    sharedUrl: new URL('agent', document.baseURI).pathname,
    operationReporterToken: ɵAGENT_OPERATION_FAILURE_REPORTER,
  },
}).catch(() => undefined);
