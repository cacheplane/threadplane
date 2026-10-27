/** Local-only raw HTTP tap. All positive AG-UI bytes originate in the generated service. */
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import {
  createNativeStrandsServer,
  token,
} from '../../fixtures/react-parity/native-strands-react/server.mjs';
export function transformFrame(frame, scenario) {
  const match = frame.match(/^data: (.+)$/m);
  if (!match) return frame;
  let event;
  try {
    event = JSON.parse(match[1]);
  } catch {
    return frame;
  }
  if (event.type !== 'RUN_FINISHED') return frame;
  if (scenario === 'missing-terminal') return '';
  if (scenario === 'wrong-terminal') event.runId = 'negative-wrong-run';
  else if (scenario === 'child-only-terminal') {
    // Negative corruption: downgrade the actual root terminal to child-only
    // observation. The original root bytes remain in the upstream tap.
    event.type = 'SUBAGENT_FINISHED';
    event.subagentRunId = 'negative-child';
    event.outcome = { type: 'suspended' };
    delete event.runId;
    delete event.threadId;
  } else return frame;
  return frame.replace(match[0], 'data: ' + JSON.stringify(event));
}
export function createNativeStrandsFixture({ operationMs = 25000 } = {}) {
  assert.ok(Number.isFinite(operationMs) && operationMs > 0);
  let owner,
    closed = false,
    operations = Promise.resolve();
  const receipts = [];
  // Reset callers can exist before any native backend owner is acquired.
  const controlCallers = new Set();
  const controlRequests = [];
  const serialize = (operation) => {
    const result = operations.then(operation);
    operations = result.catch(() => undefined);
    return result;
  };
  const currentStats = () =>
    owner
      ? {
          ...owner.server.stats(),
          requests: structuredClone(owner.requests),
          scenario: owner.scenario,
          active: owner.active.size,
        }
      : null;
  const stats = () =>
    structuredClone({
      current: currentStats(),
      closed: receipts,
      activeControls: controlCallers.size,
      controlRequests,
    });
  async function closeOwner() {
    const previous = owner;
    owner = undefined;
    if (!previous) return;
    // Close physical streams before service shutdown; closure is independently observed.
    for (const { upstream, request, response } of previous.active) {
      upstream?.destroy();
      request.destroy();
      response.destroy();
    }
    try {
      await previous.server.observe();
    } catch {}
    await previous.server.close();
    receipts.push({
      ...previous.server.stats(),
      requests: previous.requests,
      scenario: previous.scenario,
      active: previous.active.size,
    });
  }
  const reset = (options = {}) =>
    serialize(async () => {
      assert.ok(!closed, 'Fixture closed');
      assert.ok(
        [
          'approval',
          'batch',
          'cancel',
          'missing-terminal',
          'wrong-terminal',
          'child-only-terminal',
        ].includes(options.scenario ?? 'approval')
      );
      await closeOwner();
      // createNativeStrandsServer owns failed acquisition cleanup before returning.
      const server = await createNativeStrandsServer({
        mode: ['cancel', 'batch'].includes(options.scenario)
          ? options.scenario
          : 'approval',
      });
      owner = {
        server,
        scenario: options.scenario ?? 'approval',
        requests: [],
        active: new Set(),
      };
    });
  const close = () => {
    closed = true;
    const pendingControls = [...controlCallers];
    for (const { request, response } of pendingControls) {
      request.destroy();
      response.destroy();
    }
    return serialize(async () => {
      await closeOwner();
      await Promise.all(pendingControls.map((caller) => caller.settled));
    });
  };
  const json = (response, value, status = 200) =>
    response
      .writeHead(status, { 'content-type': 'application/json' })
      .end(JSON.stringify(value));
  async function handle(request, response, path) {
    if (
      ![
        '/__reset',
        '/__stats',
        '/__requests',
        '/__finish',
        '/runtimes/aws-strands/agent',
      ].includes(path)
    )
      return false;
    if (
      request.method !==
      (['/__stats', '/__requests'].includes(path) ? 'GET' : 'POST')
    ) {
      json(response, {}, 405);
      return true;
    }
    let admitted, active, control;
    try {
      if (path === '/__stats' || path === '/__requests') {
        if (owner) await owner.server.observe();
        json(response, path === '/__stats' ? stats() : owner?.requests ?? []);
        return true;
      }
      if (path === '/__finish') {
        await serialize(closeOwner);
        json(response, stats());
        return true;
      }
      if (path === '/__reset') {
        assert.ok(!closed, 'Fixture closed');
        const receipt = {
          path,
          method: request.method,
          requestBase64: '',
          deadlineExceeded: false,
          downstreamClosed: false,
        };
        controlRequests.push(receipt);
        let settle;
        control = {
          request,
          response,
          receipt,
          settled: new Promise((resolve) => {
            settle = resolve;
          }),
          settle: () => settle(),
        };
        control.onClose = () => {
          receipt.downstreamClosed = true;
          request.destroy();
        };
        control.timer = setTimeout(() => {
          receipt.deadlineExceeded = true;
          request.destroy();
          response.destroy();
        }, operationMs);
        response.once('close', control.onClose);
        controlCallers.add(control);
      }
      const current = owner;
      if (path !== '/__reset') {
        assert.ok(current && !closed, 'Explicit fixture reset required');
        admitted = {
          sequence: current.requests.length + 1,
          path,
          method: request.method,
          requestBase64: '',
          body: null,
          parseFailed: false,
          upstreamBase64: '',
          sentBase64: '',
          upstreamEnd: false,
          downstreamClosed: false,
        };
        current.requests.push(admitted);
        active = { request, response, upstream: undefined };
        active.timer = setTimeout(() => {
          admitted.deadlineExceeded = true;
          active.upstream?.destroy();
          request.destroy();
          response.destroy();
        }, operationMs);
        current.active.add(active);
        response.once('close', () => {
          clearTimeout(active.timer);
          admitted.downstreamClosed = true;
          current.active.delete(active);
          active.upstream?.destroy();
        });
      }
      let raw = Buffer.alloc(0);
      for await (const chunk of request) {
        raw = Buffer.concat([raw, chunk]);
        if (admitted) admitted.requestBase64 = raw.toString('base64');
        if (control) control.receipt.requestBase64 = raw.toString('base64');
        assert.ok(raw.length <= 2000000);
      }
      if (path === '/__reset') {
        assert.ok(!closed && !response.destroyed, 'Reset caller closed');
        await reset(raw.length ? JSON.parse(raw) : {});
        json(response, stats());
        return true;
      }
      assert.ok(
        owner === current && !closed,
        'Fixture replaced during caller body'
      );
      const entry = admitted;
      try {
        entry.body = JSON.parse(raw);
      } catch (error) {
        entry.parseFailed = true;
        throw error;
      }
      const input = [],
        output = [];
      let pending = '';
      const record = () => {
        entry.upstreamBase64 = Buffer.concat(input).toString('base64');
        entry.sentBase64 = Buffer.concat(output).toString('base64');
      };
      const send = (bytes) => {
        if (bytes && !response.destroyed) {
          const data = Buffer.from(bytes);
          output.push(data);
          response.write(data);
          record();
        }
      };
      const resumed = Boolean(entry.body.resume?.length);
      const negative = resumed;
      const scenario = negative ? current.scenario : 'approval';
      const decoder = new TextDecoder();
      const upstream = httpRequest(
        current.server.url + '/agent',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-internal-token': token,
            'content-length': raw.length,
          },
        },
        (incoming) => {
          if (owner !== current || closed || response.destroyed) {
            incoming.destroy();
            return;
          }
          response.writeHead(incoming.statusCode, {
            'content-type':
              incoming.headers['content-type'] ?? 'application/json',
            'cache-control': 'no-store',
          });
          incoming.on('data', (chunk) => {
            input.push(Buffer.from(chunk));
            record();
            if (['approval', 'batch', 'cancel'].includes(scenario)) {
              send(chunk);
              return;
            }
            pending += decoder.decode(chunk, { stream: true });
            let match;
            while ((match = /\r?\n\r?\n/.exec(pending))) {
              const end = match.index + match[0].length;
              send(transformFrame(pending.slice(0, end), scenario));
              pending = pending.slice(end);
            }
          });
          incoming.once('end', () => {
            entry.upstreamEnd = true;
            pending += decoder.decode();
            if (pending) send(transformFrame(pending, scenario));
            record();
            response.end();
          });
          incoming.once('error', () => response.destroy());
        }
      );
      active.upstream = upstream;
      response.once('close', () => {
        record();
      });
      upstream.once('error', () => {
        if (!response.headersSent && !response.destroyed)
          json(response, { error: 'Native fixture unavailable' }, 502);
        else response.destroy();
      });
      upstream.end(raw);
      return true;
    } catch {
      if (admitted) admitted.downstreamClosed = true;
      if (response.destroyed) return true;
      if (!response.headersSent)
        json(response, { error: 'Native fixture request failed' }, 500);
      else response.destroy();
      return true;
    } finally {
      if (control) {
        clearTimeout(control.timer);
        response.removeListener('close', control.onClose);
        control.receipt.downstreamClosed = response.destroyed;
        controlCallers.delete(control);
        control.settle();
      }
    }
  }
  return Object.assign(handle, { reset, stats, close });
}
