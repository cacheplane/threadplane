import { createRoot } from 'react-dom/client';
// eslint-disable-next-line @nx/enforce-module-boundaries -- The isolated build copies this internal parent health bridge.
import { installRuntimeBridge } from '../../../../../libs/cockpit-runtime-bridge/src/index';
import { StateDemo } from './app';
import { createPlayback } from './playback';
import { STATE_SAMPLES } from './specs';
import './styles.css';

const element = document.getElementById('root');
if (!element) throw new Error('Application root is missing');
const bridge = installRuntimeBridge();
const playback = createPlayback(STATE_SAMPLES);
const root = createRoot(element);
window.addEventListener(
  'pagehide',
  () => {
    playback.dispose();
    root.unmount();
    bridge.dispose();
  },
  { once: true }
);
root.render(
  <StateDemo
    playback={playback}
    samples={STATE_SAMPLES.map((sample) => sample.label)}
    onReady={() => bridge.markReady()}
  />
);
