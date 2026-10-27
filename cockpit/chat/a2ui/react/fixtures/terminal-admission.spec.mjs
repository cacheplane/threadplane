import assert from 'node:assert/strict';
import test from 'node:test';
import { runNativeProbe } from '../../../../../scripts/react-cockpit/chat-a2ui-native-probe.mjs';

test(
  'installed actual application helpers admit four canonical native graph turns',
  { timeout: 180000 },
  async () => {
    // runNativeProbe explicitly prepares the existing frozen Python fixture configuration.
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
    assert.equal(report.receipt.fixture.worker.pythonAbsent, true);
  }
);
