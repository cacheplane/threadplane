import { ɵAGENT_OPERATION_FAILURE_REPORTER } from '@threadplane/angular';
import { bootstrapWithCockpitHarness } from '@threadplane/cockpit-telemetry';
import { appConfig } from './app/app.config';
import { A2uiComponent } from './app/a2ui.component';
import { environment } from './environments/environment';

void bootstrapWithCockpitHarness(A2uiComponent, appConfig, {
  runtime: {
    adapter: 'langgraph',
    sharedApiUrl: environment.langGraphApiUrl,
    assistantId: environment.a2uiAssistantId,
    operationReporterToken: ɵAGENT_OPERATION_FAILURE_REPORTER,
  },
}).catch(() => undefined);
