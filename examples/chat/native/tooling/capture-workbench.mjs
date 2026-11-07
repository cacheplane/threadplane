import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import capture from './capture-workbench.ts';

const destination = resolve(
  'apps/website/src/components/workbench/trip-recording.json'
);
const recording = await capture.captureWorkbench();
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, JSON.stringify(recording, null, 2) + '\n');
console.log(
  `Captured ${recording.frames.length} observations to ${destination}`
);
