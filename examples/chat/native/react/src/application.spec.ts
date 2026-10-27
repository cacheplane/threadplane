import assert from 'node:assert/strict';
import test from 'node:test';
import { createReactApplication } from './application.js';
import { applicationFixture } from './application-fixture.js';

async function until(predicate: () => boolean) {
  const end = Date.now() + 2000;
  while (!predicate()) {
    assert.ok(Date.now() < end, 'Expected React application admission');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
test('production React factory publishes enriched rows through the actual raw owner and owns each admission', async () => {
  const f = applicationFixture();
  const app = createReactApplication(f.options);
  try {
    app.start();
    await until(() => app.getSnapshot().selection.status === 'ready');
    assert.equal(f.counters.owners, 1);
    assert.ok(
      f.counters.markdown > 0,
      'Existing Markdown option reaches the decorator'
    );
    const row = app.getSnapshot().messages[0];
    assert.equal(
      row.a2uiTripSummaryRenders[0].spec.elements['root'].props['title'],
      '<b>City</b>'
    );
    const accepted = app.getSnapshot();
    const off = app.subscribe(() => {});
    off();
    assert.strictEqual(app.getSnapshot(), accepted);
    assert.equal(f.counters.owners, 1);
    app.select('b');
    assert.equal(f.counters.disposals, 1);
    await until(() => app.getSnapshot().selection.status === 'ready');
    assert.equal(f.counters.owners, 2);
  } finally {
    app.dispose();
    app.dispose();
  }
  assert.equal(f.counters.disposals, 2);
  assert.equal(f.counters.commands, 0);
});

test('initial React preparation failure uses selection error and cleans raw owners while retaining base until retirement', async () => {
  const f = applicationFixture();
  f.fail(true);
  const app = createReactApplication(f.options);
  app.start();
  await until(() => app.getSnapshot().selection.status === 'error');
  assert.equal(f.counters.owners, f.counters.disposals);
  assert.ok(f.counters.markdown > 0);
  assert.equal(f.counters.markdownDisposals, 0);
  assert.equal(
    f.counters.reads,
    0,
    'Failed initial preparation never starts provider loading'
  );
  assert.equal(f.counters.commands, 0);
  app.dispose();
  assert.equal(f.counters.markdownDisposals, f.counters.markdown);
});

test('runtime contains later preparation failure, retains accepted app rows and recovers on the next complete input without retry', async () => {
  const f = applicationFixture();
  const app = createReactApplication(f.options);
  try {
    app.start();
    await until(() => app.getSnapshot().selection.status === 'ready');
    const accepted = app.getSnapshot();
    f.fail(true);
    f.title('Changed');
    await f.sessions[0].load!();
    assert.strictEqual(app.getSnapshot(), accepted);
    assert.equal(f.counters.owners, f.counters.disposals);
    assert.equal(f.counters.reads, 2);
    f.fail(false);
    await f.sessions[0].load!();
    assert.equal(
      app.getSnapshot().messages[0].a2uiTripSummaryRenders[0].spec.elements[
        'root'
      ].props['title'],
      'Changed'
    );
    assert.equal(f.counters.owners, 2);
    assert.equal(f.counters.reads, 3);
    assert.equal(f.counters.commands, 0);
  } finally {
    app.dispose();
  }
});
