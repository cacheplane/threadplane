// Default builds pay no packaging-module startup cost for this optional edge.
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const profile = process.argv[2];
assert.ok(
  [
    'react-langgraph',
    'react-ag-ui',
    'react-render',
    'react-native-a2ui-langgraph',
    'react-native-a2ui-ag-ui',
  ].includes(profile),
  'Unknown consumer preparation profile'
);
const store = process.env.WEBSITE_RUNTIME_PREPARATION;
if (store) {
  const { prepareProfile } = await import('./consumer-preparation.mjs');
  await prepareProfile({
    root: resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
    store,
    profile,
  });
}
