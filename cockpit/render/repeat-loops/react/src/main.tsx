import { createRoot } from 'react-dom/client';
import { createRenderState } from '@threadplane/content/render-state';
// eslint-disable-next-line @nx/enforce-module-boundaries -- The isolated build copies this internal parent health bridge.
import { installRuntimeBridge } from '../../../../../libs/cockpit-runtime-bridge/src/index';
import { RepeatDemo } from './app';
import { createPlayback } from './playback';
import { REPEAT_SAMPLES } from './specs';
import { createItems, createItemCommands, type ItemsObserver } from './items';
import './styles.css';

const element = document.getElementById('root');
if (!element) throw new Error('Application root is missing');
const bridge = installRuntimeBridge();
const playback = createPlayback(REPEAT_SAMPLES);
const renderState = createRenderState(createItems());
// This application maintains the closed ItemState shape. Forward the actual
// stable getter and subscription without cloning owner snapshots.
const renderStateObserver: ItemsObserver = {
  getSnapshot: renderState.getSnapshot as ItemsObserver['getSnapshot'],
  subscribe: renderState.subscribe,
};
const commands = createItemCommands(renderState);
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
  <RepeatDemo
    playback={playback}
    renderState={renderStateObserver}
    commands={commands}
    samples={REPEAT_SAMPLES.map((sample) => sample.label)}
    onReady={() => bridge.markReady()}
  />
);
