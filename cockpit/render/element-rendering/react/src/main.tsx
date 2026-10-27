import { createRoot } from 'react-dom/client';
import { createRenderState } from '@threadplane/content/render-state';
// eslint-disable-next-line @nx/enforce-module-boundaries -- The isolated build copies this internal parent health bridge.
import { installRuntimeBridge } from '../../../../../libs/cockpit-runtime-bridge/src/index';
import { ElementRenderingDemo } from './app';
import { createPlayback } from './playback';
import { ELEMENT_RENDERING_SAMPLES } from './specs';
import './styles.css';

const element = document.getElementById('root');
if (!element) throw new Error('Application root is missing');
const bridge = installRuntimeBridge();
const playback = createPlayback(ELEMENT_RENDERING_SAMPLES);
const renderState = createRenderState({ showDetail: true });
const renderStateObserver = {
  getSnapshot: renderState.getSnapshot,
  subscribe: renderState.subscribe,
};
const root = createRoot(element);
window.addEventListener(
  'pagehide',
  () => {
    playback.dispose();
    root.unmount();
    renderState.dispose();
    bridge.dispose();
  },
  { once: true }
);
root.render(
  <ElementRenderingDemo
    playback={playback}
    renderState={renderStateObserver}
    onShowDetailChange={(value) => renderState.set('/showDetail', value)}
    samples={ELEMENT_RENDERING_SAMPLES.map((sample) => sample.label)}
    onReady={() => bridge.markReady()}
  />
);
