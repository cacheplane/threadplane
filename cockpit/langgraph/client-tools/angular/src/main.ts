import { ɵAGENT_OPERATION_FAILURE_REPORTER } from '@threadplane/angular';
import { bootstrapWithCockpitHarness } from '@threadplane/cockpit-telemetry';
import { appConfig } from './app/app.config';
import { ClientToolsComponent } from './app/client-tools.component';
import { environment } from './environments/environment';

void bootstrapWithCockpitHarness(ClientToolsComponent, appConfig, {
  runtime: {
    adapter: 'langgraph',
    sharedApiUrl: environment.langGraphApiUrl,
    assistantId: environment.clientToolsAssistantId,
    operationReporterToken: ɵAGENT_OPERATION_FAILURE_REPORTER,
  },
}).catch(() => undefined);
