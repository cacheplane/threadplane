import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import configuration from '../../shared/browser-config.json';
import {
  bindBrowserLifetime,
  getBrowserConfiguration,
} from '../../shared/browser';
import { createApplication } from '../../shared/application';
import { createThreadDirectory } from '../../shared/directory';
import { browserHistory } from '../../shared/route';
import '../../shared/tokens.css';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing');
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
createRoot(root).render(
  <StrictMode>
    <App application={application} />
  </StrictMode>
);
