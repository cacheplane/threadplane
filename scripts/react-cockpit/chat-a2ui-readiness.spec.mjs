import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import test from 'node:test';
import { Client } from '@langchain/langgraph-sdk';
import {
  createChatA2uiFixture,
  fixtureConfiguration,
} from './chat-a2ui-fixture.mjs';

const hash = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

test(
  'shared explicit tooling preserves fresh actual graphs and reaps both Python children',
  { timeout: 120000 },
  async (t) => {
    const configuration = Object.freeze(fixtureConfiguration());
    const fixtures = [];
    const listeners = [];
    t.after(async () => {
      for (const server of listeners) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
      for (const fixture of fixtures) await fixture.close();
    });
    async function open() {
      const fixture = createChatA2uiFixture({ configuration });
      fixtures.push(fixture);
      await fixture.configure({});
      const receipt = fixture.receipt();
      assert.deepEqual(
        receipt.requests,
        [],
        'readiness creates no conversation or run'
      );
      assert.equal(receipt.proofs.length, 1);
      assert.deepEqual(receipt.proofs[0].models, []);
      assert.deepEqual(receipt.proofs[0].tools, []);
      assert.equal(receipt.proofs[0].threadId, null);
      const server = createServer(async (req, res) => {
        if (
          !(await fixture(
            req,
            res,
            new URL(req.url, 'http://localhost').pathname
          ))
        ) {
          res.writeHead(404);
          res.end();
        }
      });
      listeners.push(server);
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const apiUrl = `http://127.0.0.1:${server.address().port}/api`;
      return {
        fixture,
        apiUrl,
        client: new Client({
          apiUrl,
          apiKey: null,
          callerOptions: { maxRetries: 0 },
        }),
      };
    }
    const first = await open(),
      threadId = randomUUID();
    await first.client.threads.create({ threadId, ifExists: 'raise' });
    for await (const event of first.client.runs.stream(threadId, 'c-a2ui', {
      input: {
        messages: [
          {
            type: 'human',
            id: randomUUID(),
            content: 'I want to fly LAX to JFK',
          },
        ],
      },
      streamMode: ['messages-tuple', 'values', 'updates', 'checkpoints'],
      streamSubgraphs: true,
      streamResumable: true,
      onDisconnect: 'continue',
    }))
      assert.notEqual(event.event, 'error');
    assert.equal(
      (await first.client.threads.getState(threadId)).values.messages.length,
      2
    );
    await first.fixture.close();
    const second = await open();
    assert.equal(
      (await fetch(`${second.apiUrl}/threads/${threadId}/state`)).status,
      404
    );
    await second.client.threads.create({ threadId, ifExists: 'raise' });
    assert.deepEqual(
      (await second.client.threads.getState(threadId)).values,
      {}
    );
    await second.fixture.close();
    const receipts = fixtures.map((f) => f.receipt());
    assert.notEqual(receipts[0].worker.pid, receipts[1].worker.pid);
    assert.notEqual(receipts[0].worker.pythonPid, receipts[1].worker.pythonPid);
    assert.notEqual(receipts[0].worker.owned, receipts[1].worker.owned);
    for (const receipt of receipts) {
      assert.deepEqual(receipt.configuration, configuration);
      for (const proof of receipt.proofs) {
        assert.equal(proof.actualCompiledGraph, true);
        assert.equal(proof.networkConnectAttempts, 0);
        assert.equal(
          proof.sourceSha256,
          hash('cockpit/chat/a2ui/python/src/graph.py')
        );
        assert.equal(
          proof.lockSha256,
          hash('cockpit/chat/a2ui/python/uv.lock')
        );
      }
      assert.equal(receipt.worker.reaped, true);
      assert.equal(receipt.worker.pythonAbsent, true);
      for (const pid of [receipt.worker.pid, receipt.worker.pythonPid])
        assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    }
  }
);
