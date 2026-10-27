import { createRoot } from 'react-dom/client';
// eslint-disable-next-line @nx/enforce-module-boundaries -- The isolated build copies this internal parent health bridge.
import { installRuntimeBridge } from '../../../../../libs/cockpit-runtime-bridge/src/index';
import { RegistryDemo } from './app';
import { createPlayback } from './playback';
import { REGISTRY_SAMPLES } from './specs';
import './styles.css';

const element = document.getElementById('root');
if (!element) throw new Error('Application root is missing');
const bridge = installRuntimeBridge();
const playback = createPlayback(REGISTRY_SAMPLES);
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
  <RegistryDemo
    playback={playback}
    samples={REGISTRY_SAMPLES.map((sample) => sample.label)}
    onReady={() => bridge.markReady()}
  />
);
