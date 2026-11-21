import { ɵAGENT_OPERATION_FAILURE_REPORTER } from '@threadplane/angular';
import { bootstrapWithCockpitHarness } from '@threadplane/cockpit-telemetry';
import { appConfig } from './app/app.config';
import { SubagentsComponent } from './app/subagents.component';

void bootstrapWithCockpitHarness(SubagentsComponent, appConfig, {
  runtime: {
    adapter: 'ag-ui',
    sharedUrl: new URL('agent', document.baseURI).pathname,
    operationReporterToken: ɵAGENT_OPERATION_FAILURE_REPORTER,
  },
}).catch(() => undefined);
