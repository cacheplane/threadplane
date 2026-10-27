/** Offline browser proof only. Every positive event comes from the canonical worker. */
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClientToolsServer } from '../../fixtures/react-parity/native-ag-ui-client-tools/server.mjs';
const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export function createAgUiClientToolsFixture({ root = defaultRoot } = {}) {
  const environment = resolve(root, 'cockpit/ag-ui/client-tools/python/.venv');
  let owner, closed = false, operations = Promise.resolve();
  const receipts = [];
  const serialize = (operation) => {
    const result = operations.then(operation);
    operations = result.catch(() => undefined);
    return result;
  };
  async function closeOwner() {
    const previous = owner;
    owner = undefined;
    if (!previous) return;
    await previous.close();
    const receipt = previous.stats();
    assert.ok(Object.values(receipt.closure).every(Boolean));
    receipts.push(receipt);
  }
  const reset = (options = {}) => serialize(async () => {
    assert.ok(!closed, 'Fixture closed');
    await closeOwner();
    assert.ok(['nonstream', 'stream', 'unknown'].includes(options.mode ?? 'nonstream'));
    assert.ok(options.holdTerminal === undefined || typeof options.holdTerminal === 'boolean');
    owner = await createClientToolsServer({ root, environment, scenario: 'cockpit', mode: options.mode ?? 'nonstream', holdTerminal: options.holdTerminal ?? false, holdAfterRequest: options.holdAfterRequest ?? 0, holdReceipt: options.holdReceipt ?? false });
  });
  const stats = () => structuredClone({ current: owner?.stats(), closed: receipts });
  const json = (response, value, status = 200) => response.writeHead(status, {'content-type':'application/json'}).end(JSON.stringify(value));
  async function handle(request, response, pathname) {
    if (!['/__reset', '/__stats', '/__requests', '/__release', '/__close', '/__finish', '/ag-ui/client-tools/agent'].includes(pathname)) return false;
    try {
      if (pathname === '/__stats') { json(response, stats()); return true; }
      if (pathname === '/__requests') { json(response, owner?.stats().requests ?? []); return true; }
      if (pathname === '/__finish') { await serialize(closeOwner); json(response, stats()); return true; }
      if (pathname === '/__close') { await close(); json(response, stats()); return true; }
      if (pathname === '/__reset') {
        assert.equal(request.method, 'POST');
        let body = '';
        for await (const chunk of request) { body += chunk; assert.ok(body.length <= 2000000); }
        await reset(body ? JSON.parse(body) : {});
        json(response, stats()); return true;
      }
      const current = owner;
      assert.ok(current && !closed, 'Explicit prepared fixture reset required');
      if (pathname === '/__release') {
        await fetch(current.url + '/release', {method:'POST'});
        json(response, {}); return true;
      }
      assert.equal(request.method, 'POST');
      // Preserve SSE timing and cancellation; never synthesize a positive event.
      const upstream = httpRequest(current.url + '/agent', {method: 'POST', headers: {'content-type': 'application/json'}}, incoming => {
        if (owner !== current || closed || response.destroyed) { incoming.destroy(); return; }
        response.writeHead(incoming.statusCode, {'content-type': incoming.headers['content-type'] ?? 'application/json', 'cache-control': 'no-store'});
        incoming.pipe(response);
        incoming.on('error', () => response.destroy());
      });
      upstream.on('error', () => { if (!response.headersSent && !response.destroyed) json(response, {error:'Canonical fixture unavailable'}, 502); else response.destroy(); });
      response.once('close', () => upstream.destroy());
      request.pipe(upstream);
      return true;
    } catch { if (!response.headersSent) json(response, {error:'Canonical fixture request failed'}, 500); else response.destroy(); return true; }
  }
  function close() { closed = true; return serialize(closeOwner); }
  return Object.assign(handle, { reset, stats, close });
}
