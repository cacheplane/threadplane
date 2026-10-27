import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request as httpRequest } from 'node:http';
import { SubagentFinishedEventSchema } from '@ag-ui/core/schemas';
import { prepareNativeMafFixture } from './prepare-native-maf-fixture.mjs';
import {
  createNativeMafFixture,
  transformFrame,
} from './native-maf-fixture.mjs';
test('negative wire transformations preserve positive frames and remove/corrupt only terminal authority', () => {
  const start = 'data: {"type":"RUN_STARTED","runId":"r"}\n\n';
  const terminal =
    'data: {"type":"RUN_FINISHED","runId":"r","threadId":"t"}\n\n';
  assert.equal(transformFrame(start, 'missing-terminal'), start);
  assert.equal(transformFrame(terminal, 'missing-terminal'), '');
  assert.match(
    transformFrame(terminal, 'wrong-terminal'),
    /negative-wrong-run/
  );
  assert.equal(transformFrame(terminal, 'approval'), terminal);
  assert.equal(transformFrame(terminal, 'batch'), terminal);
  const child = transformFrame(terminal, 'child-pause');
  const parsed = JSON.parse(child.match(/^data: (.+)$/m)[1]);
  assert.equal(SubagentFinishedEventSchema.safeParse(parsed).success, true);
  assert.equal(parsed.type, 'SUBAGENT_FINISHED');
  assert.equal(parsed.outcome.type, 'suspended');
});
test(
  'serialized resets, unknown-route guard, method guard and exact installed owner closure',
  { timeout: 30000 },
  async (t) => {
    const fixture = createNativeMafFixture();
    const server = createServer(async (req, res) => {
      if (!(await fixture(req, res, new URL(req.url, 'http://local').pathname)))
        res.writeHead(404).end();
    });
    t.after(async () => {
      await fixture.close();
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(url + '/other')).status, 404);
    assert.equal((await fetch(url + '/__reset')).status, 405);
    await fixture.reset();
    assert.throws(() => prepareNativeMafFixture({ run: () => {} }), /EEXIST/);
    assert.equal(fixture.stats().current.requests.length, 0);
    assert.equal(
      (
        await fetch(url + '/runtimes/microsoft-agent-framework/agent', {
          method: 'POST',
          body: '{broken',
        })
      ).status,
      500
    );
    assert.equal(fixture.stats().current.requests.length, 1);
    assert.equal(
      Buffer.from(
        fixture.stats().current.requests[0].requestBase64,
        'base64'
      ).toString(),
      '{broken'
    );
    assert.equal(fixture.stats().current.requests[0].parseFailed, true);
    const partial = httpRequest(
      url + '/runtimes/microsoft-agent-framework/agent',
      { method: 'POST' }
    );
    partial.on('error', () => undefined);
    partial.write('{partial');
    const deadline = Date.now() + 1000;
    while (fixture.stats().current.requests.length < 2 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(fixture.stats().current.requests.length, 2);
    assert.equal(fixture.stats().current.active, 1);
    await Promise.all([fixture.close(), fixture.close()]);
    partial.destroy();
    assert.equal(fixture.stats().closed[0].active, 0);
    assert.equal(fixture.stats().closed[0].requests[1].downstreamClosed, true);
    assert.ok(Object.values(fixture.stats().closed[0].closure).every(Boolean));
    assert.equal(
      (await fetch(url + '/__reset', { method: 'POST' })).status,
      500
    );
  }
);
