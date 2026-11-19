import assert from 'node:assert/strict';
import test from 'node:test';
import { runNativeProbe } from '../../../../../scripts/react-cockpit/chat-a2ui-native-probe.mjs';

test(
  'installed actual application helpers admit four canonical native graph turns',
  { timeout: 180000 },
  async () => {
    // The installed consumer runs against aimock + a real `langgraph dev`, behind the recording proxy.
    const report = await runNativeProbe({ mode: 'application-admission' });
    assert.equal(report.mode, 'application-admission');
    assert.equal(report.compiler.claim, 'actual application admission helpers');
    assert.deepEqual(report.compiler.files, [
      'contract.ts',
      'libs/cockpit-a2ui-react/src/data.ts',
      'cockpit/chat/a2ui/react/src/terminal.ts',
    ]);
    assert.equal(report.compiler.exit, 0);
    assert.deepEqual(
      report.receipt.turns.map((t) => t.admission.messages.length),
      [2, 4, 6, 8]
    );
    assert.ok(
      report.receipt.turns.every(
        (t) =>
          t.admissionNegatives.length === 13 &&
          t.admissionNegatives.every((n) => n.rejected)
      )
    );
    assert.deepEqual(Object.keys(report.application.sources), [
      'libs/cockpit-a2ui-react/src/data.ts',
      'cockpit/chat/a2ui/react/src/terminal.ts',
    ]);
    assert.deepEqual(Object.keys(report.application.modules), [
      'libs/cockpit-a2ui-react/src/data.js',
      'cockpit/chat/a2ui/react/src/terminal.js',
    ]);
    assert.ok(report.receipt.cleanup.every((row) => row.closed));
    assert.equal(report.closure.processAbsent, true);
    assert.equal(report.closure.groupAbsent, true);
    // The real backend (aimock + `langgraph dev`) was the one the consumer
    // drove, and its process tree was gone when the consumer closed it.
    assert.equal(report.receipt.backend.kind, 'aimock-langgraph');
    assert.equal(report.receipt.backend.python, 'cockpit/chat/a2ui/python');
    assert.ok(report.receipt.cleanup.some((row) => row.name === 'backend' && row.closed));
  }
);
