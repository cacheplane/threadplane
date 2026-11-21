import { ɵAGENT_OPERATION_FAILURE_REPORTER } from '@threadplane/angular';
import { bootstrapWithCockpitHarness } from '@threadplane/cockpit-telemetry';
import { appConfig } from './app/app.config';
import { StreamingComponent } from './app/streaming.component';
import { environment } from './environments/environment';

void bootstrapWithCockpitHarness(StreamingComponent, appConfig, {
  runtime: {
    adapter: 'langgraph',
    sharedApiUrl: environment.langGraphApiUrl,
    assistantId: environment.streamingAssistantId,
    operationReporterToken: ɵAGENT_OPERATION_FAILURE_REPORTER,
  },
}).catch(() => undefined);
