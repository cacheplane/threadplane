import { createRoot } from 'react-dom/client';
import { createRenderState } from '@threadplane/content/render-state';
// eslint-disable-next-line @nx/enforce-module-boundaries -- The isolated build copies this internal parent health bridge.
import { installRuntimeBridge } from '../../../../../libs/cockpit-runtime-bridge/src/index';
import { StateDemo } from './app';
import { createPlayback } from './playback';
import { STATE_SAMPLES } from './specs';
import {
  createInitialState,
  createStateEditor,
  type DemoObserver,
} from './state';
import './styles.css';

const element = document.getElementById('root');
if (!element) throw new Error('Application root is missing');
const bridge = installRuntimeBridge();
const playback = createPlayback(STATE_SAMPLES);
const renderState = createRenderState(createInitialState());
// This owner starts with DemoState and this application only issues the three
// validated scalar commands. Narrow the existing getter; never clone snapshots.
const renderStateObserver: DemoObserver = {
  getSnapshot: renderState.getSnapshot as DemoObserver['getSnapshot'],
  subscribe: renderState.subscribe,
};
const onStateEdit = createStateEditor(renderState);
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
  <StateDemo
    playback={playback}
    renderState={renderStateObserver}
    onStateEdit={onStateEdit}
    samples={STATE_SAMPLES.map((sample) => sample.label)}
    onReady={() => bridge.markReady()}
  />
);
