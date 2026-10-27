import assert from 'node:assert/strict';
import { createSession, projectTextTranscript } from '@threadplane/ag-ui';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/** Actual installed consumer: one human submit owns both physical requests. */
export async function runInstalledProbe({ url, scenario = 'positive' }) {
  const originalFetch = globalThis.fetch;
  const requests = [],
    snapshots = [],
    handlerCalls = [];
  let session;
  const catalog = {
    get_weather: {
      description: 'Scripted local weather',
      parameters: {
        type: 'object',
        properties: { location: { type: 'string' } },
        required: ['location'],
      },
      /** @param {{ location: string }} args */
      handler: (args) => {
        handlerCalls.push(structuredClone(args));
        if (scenario === 'handler-cancel') {
          queueMicrotask(() => session.stop());
          return new Promise(() => {});
        }
        return { location: args.location, temperatureF: 68 };
      },
    },
  };
  globalThis.fetch = (input, init) => {
    assert.equal(
      String(input),
      url + '/agent',
      'native owner uses its exact owned transport'
    );
    requests.push(JSON.parse(init.body));
    return originalFetch(input, init);
  };
  try {
    const inert = createSession(
      { threadId: randomUUID(), url: url + '/agent' },
      catalog
    );
    const unsubscribe = inert.subscribe(() => {});
    unsubscribe();
    inert.dispose();
    assert.deepEqual(
      requests,
      [],
      'construction, observation and disposal are inert'
    );
    const threadId = randomUUID();
    session = createSession({ threadId, url: url + '/agent' }, catalog);
    session.subscribe(() =>
      snapshots.push(structuredClone(session.getSnapshot()))
    );
    const done = session.submit('Scripted weather request');
    if (scenario === 'held-cancel') {
      const deadline = Date.now() + 15000;
      for (;;) {
        const stats = await (await originalFetch(url + '/stats')).json();
        if (stats.requests[0]?.held) break;
        assert.ok(Date.now() < deadline, 'bounded terminal hold');
        await new Promise((yes) => setTimeout(yes, 20));
      }
      session.stop();
    }
    const outcome = await done;
    const snapshot = structuredClone(session.getSnapshot());
    if (scenario === 'positive') {
      assert.equal(
        requests.length,
        2,
        'automatic continuation, no second human submit'
      );
      assert.equal(handlerCalls.length, 1);
      assert.deepEqual(handlerCalls[0], { location: 'KASE' });
      for (const request of requests) {
        assert.equal(request.threadId, threadId);
        assert.match(request.runId, /^[0-9a-f-]{36}$/);
        assert.equal(
          request.messages.filter((row) => row.role === 'user').length,
          1
        );
        assert.deepEqual(request.tools, [
          {
            name: 'get_weather',
            description: catalog.get_weather.description,
            parameters: catalog.get_weather.parameters,
          },
        ]);
      }
      assert.notEqual(requests[0].runId, requests[1].runId);
      assert.deepEqual(requests[0].messages[0], requests[1].messages[0]);
      const result = requests[1].messages.find((row) => row.role === 'tool');
      assert.ok(
        result,
        'locally authored tool result is carried by the actual next request'
      );
      assert.equal(result.toolCallId, 'scripted-weather-call-id');
      assert.equal(
        result.content,
        JSON.stringify({ location: 'KASE', temperatureF: 68 })
      );
      const local = snapshot.clientTools.calls[0];
      assert.equal(local.name, 'get_weather');
      assert.equal(local.status, 'complete');
      assert.equal(local.sourceRunId, requests[0].runId);
      assert.equal(local.provenance, 'local');
      assert.deepEqual(local.args, { location: 'KASE' });
      assert.deepEqual(local.result, { location: 'KASE', temperatureF: 68 });
      assert.ok(['observed', 'sent-unconfirmed'].includes(local.delivery));
      assert.equal(snapshot.clientTools.blocker, undefined);
      assert.ok(
        projectTextTranscript(snapshot.transcript).some(
          (row) => row.content === 'Scripted weather receipt received.'
        )
      );
    } else {
      assert.equal(requests.length, 1);
      assert.equal(handlerCalls.length, scenario === 'handler-cancel' ? 1 : 0);
      assert.equal(
        snapshot.clientTools.blocker?.reason,
        scenario === 'unknown'
          ? 'unsupported'
          : scenario === 'handler-cancel'
          ? 'cancelled'
          : 'uncertain'
      );
    }
    session.dispose();
    return {
      scenario,
      requests,
      handlerCalls,
      snapshots,
      snapshot,
      outcome,
      installedEntry: fileURLToPath(import.meta.resolve('@threadplane/ag-ui')),
      inertFetches: 0,
    };
  } finally {
    session?.dispose();
    globalThis.fetch = originalFetch;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runInstalledProbe(JSON.parse(process.argv[2]));
  process.stdout.write(JSON.stringify(result) + '\n');
}
