import assert from 'node:assert/strict';
import test from 'node:test';
import { reactCockpitConfiguration } from './configuration.mjs';
test('strict authored native client-tools entry is separate from LangGraph with owned unused port', () => {
  const entry = reactCockpitConfiguration('ag-ui-client-tools');
  assert.deepEqual(entry, {
    topic: 'client-tools',
    adapter: 'ag-ui',
    appPath: 'cockpit/ag-ui/client-tools/react',
    base: '/ag-ui/client-tools/react/',
    port: 4640,
    project: 'cockpit-ag-ui-client-tools-react',
  });
  assert.equal(
    reactCockpitConfiguration('client-tools').appPath,
    'cockpit/langgraph/client-tools/react'
  );
  assert.throws(
    () => reactCockpitConfiguration('ag-ui-client-tools/../other'),
    /Unsupported/
  );
  assert.ok(Object.isFrozen(entry));
});
