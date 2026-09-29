import { provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app.component';
import configuration from '../../shared/browser-config.json';
import {
  bindBrowserLifetime,
  getBrowserConfiguration,
} from '../../shared/browser';
import { createApplication } from '../../shared/application';
import { createThreadDirectory } from '../../shared/directory';
import { browserHistory } from '../../shared/route';
import { APPLICATION } from './application.token';

const browser = getBrowserConfiguration(configuration);
const application = browser.configured
  ? createApplication({
      assistantId: browser.assistantId,
      apiUrl: browser.apiUrl,
      directory: createThreadDirectory({
        apiBase: browser.apiUrl,
        browserOrigin: window.location.origin,
      }),
      history: browserHistory(window),
    })
  : null;
if (application) {
  bindBrowserLifetime(application, window);
  application.start();
}

bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    { provide: APPLICATION, useValue: application },
  ],
}).catch((error: unknown) => console.error(error));
