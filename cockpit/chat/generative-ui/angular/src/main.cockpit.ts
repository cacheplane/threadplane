import { ɵAGENT_OPERATION_FAILURE_REPORTER } from '@threadplane/angular';
import { bootstrapWithCockpitHarness } from '@threadplane/cockpit-telemetry';
import { appConfig } from './app/app.config';
import { GenerativeUiComponent } from './app/generative-ui.component';
import { environment } from './environments/environment';

void bootstrapWithCockpitHarness(GenerativeUiComponent, appConfig, {
  runtime: {
    adapter: 'langgraph',
    sharedApiUrl: environment.langGraphApiUrl,
    assistantId: environment.generativeUiAssistantId,
    operationReporterToken: ɵAGENT_OPERATION_FAILURE_REPORTER,
  },
}).catch(() => undefined);
