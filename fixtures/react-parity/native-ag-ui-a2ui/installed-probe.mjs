import assert from 'node:assert/strict';
import { createSession } from '@threadplane/ag-ui';
import { randomUUID } from 'node:crypto';
import { writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProofCoordinator } from './ag-ui-a2ui-proof-policy.mjs';

const save = (directory, name, value) => {
  const bytes = JSON.stringify(value, null, 2) + '\n';
  assert.ok(
    Buffer.byteLength(bytes) <= 48 * 1024 * 1024,
    'Complete probe artifact byte bound'
  );
  writeFileSync(join(directory, name), bytes, { flag: 'wx' });
};
function acknowledgement(turn, threadId, runId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      process.off('message', receive);
      reject(new Error('Parent oracle deadline'));
    }, 10000);
    function receive(message) {
      clearTimeout(timer);
      process.off('message', receive);
      try {
        assert.equal(message.turn, turn);
        assert.equal(message.threadId, threadId);
        assert.equal(message.runId, runId);
        assert.equal(
          message.accepted,
          true,
          message.error ?? 'Independent oracle rejected'
        );
        resolve();
      } catch (error) {
        reject(error);
      }
    }
    process.on('message', receive);
    process.send({ type: 'settled', turn, threadId, runId });
  });
}
async function negativeControls(directory) {
  const evidence = {
    label:
      'Separate native owners/fake transports; never positive adapter evidence',
    requests: [],
    owners: [],
    actions: [],
    cleanup: [],
  };
  const resources = [];
  const journal = join(directory, 'negative-native-journal.jsonl');
  writeFileSync(journal, '', { flag: 'wx' });
  const record = (action) => {
    assert.ok(evidence.actions.length < 32, 'Negative action bound');
    evidence.actions.push(action);
    appendFileSync(journal, JSON.stringify(action) + '\n');
  };
  const acquire = (kind, transport) => {
    const entry = { kind, snapshots: [] };
    evidence.owners.push(entry);
    const coordinator = createProofCoordinator((threadId) => {
      entry.threadId = threadId;
      const owner = createSession({
        threadId,
        url: 'http://127.0.0.1:1/' + kind,
        fetch: async (input, init) => {
          assert.ok(
            evidence.requests.length < 8,
            'Negative fake request count bound'
          );
          evidence.requests.push({
            kind,
            url: String(input),
            body: JSON.parse(init.body),
          });
          return transport(input, init);
        },
      });
      const off = owner.subscribe(() => {
        if (entry.snapshots.length >= 128) {
          evidence.overflow = true;
          return;
        }
        entry.snapshots.push(structuredClone(owner.getSnapshot()));
      });
      resources.push({ owner, off });
      return owner;
    });
    resources.push({ coordinator, entry });
    record({
      phase: 'acquired',
      kind,
      threadId: coordinator.receipt().threadId,
    });
    return coordinator;
  };
  let failure;
  try {
    const fault = acquire('fake-fault', async () => {
      throw new Error('labelled fake transport failure');
    });
    record({ phase: 'before-submit', kind: 'fake-fault' });
    const outcome = await fault.submit('fake fault control');
    record({
      phase: 'after-submit',
      kind: 'fake-fault',
      outcome,
      receipt: fault.receipt(),
    });
    assert.equal(outcome, 'error');
    await assert.rejects(fault.submit('no replay'), /quarantined/);
    let started;
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    const held = acquire('fake-stop', async (_input, init) => {
      started();
      return new Promise((_, reject) =>
        init.signal.addEventListener(
          'abort',
          () => reject(new DOMException('Stopped', 'AbortError')),
          { once: true }
        )
      );
    });
    record({ phase: 'before-submit', kind: 'fake-stop' });
    const pending = held.submit('fake held control');
    await ready;
    record({
      phase: 'before-stop',
      kind: 'fake-stop',
      receipt: held.receipt(),
    });
    await held.stop();
    const stopped = await pending;
    record({
      phase: 'after-stop',
      kind: 'fake-stop',
      outcome: stopped,
      receipt: held.receipt(),
    });
    assert.ok(
      stopped === 'aborted' || stopped === 'error',
      'Actual native Stop outcome retained'
    );
    await assert.rejects(held.submit('no replay'), /quarantined/);
    // A distinct New control changes only its deliberately fake transport.
    const next = acquire('fake-new', async (_input, init) => {
      const body = JSON.parse(init.body);
      const events = [
        { type: 'RUN_STARTED', threadId: body.threadId, runId: body.runId },
        { type: 'RUN_FINISHED', threadId: body.threadId, runId: body.runId },
      ];
      return new Response(
        events
          .map((event) => 'data: ' + JSON.stringify(event) + '\n\n')
          .join(''),
        { headers: { 'content-type': 'text/event-stream' } }
      );
    });
    const old = next.receipt();
    record({ phase: 'before-new', receipt: old });
    await next.newThread();
    assert.notEqual(next.receipt().threadId, old.threadId);
    record({ phase: 'after-new', receipt: next.receipt() });
    const fresh = await next.submit('fake new control');
    record({
      phase: 'after-submit',
      kind: 'fake-new',
      outcome: fresh,
      receipt: next.receipt(),
    });
    assert.equal(fresh, 'success');
    assert.equal(evidence.overflow, undefined);
  } catch (error) {
    failure = error;
    evidence.failure = String(error);
  } finally {
    for (const resource of resources.slice().reverse()) {
      try {
        if (resource.coordinator) {
          await resource.coordinator.dispose();
          resource.coordinator.assertResourcesClosed();
          resource.entry.receipt = resource.coordinator.receipt();
        } else {
          resource.off();
          await resource.owner.dispose();
        }
        evidence.cleanup.push({
          kind: resource.entry?.kind ?? 'native-owner',
          closed: true,
        });
      } catch (error) {
        evidence.cleanup.push({
          kind: resource.entry?.kind ?? 'native-owner',
          closed: false,
          error: String(error),
        });
        failure ??= error;
      }
    }
    save(directory, 'negative-native-controls.json', evidence);
  }
  if (failure) throw failure;
  return { requests: evidence.requests.length };
}

/** Actual installed owner, no catalog. Every callback observation is retained. */
export async function runInstalledProbe({ url, directory, importFetches }) {
  assert.equal(importFetches, 0, 'Actual module import is fetch-inert');
  const originalFetch = globalThis.fetch;
  const denied = [];
  globalThis.fetch = (input) => {
    denied.push(String(input));
    throw new Error('Unowned global fetch');
  };
  let coordinator,
    owner,
    unsubscribe,
    inertOwner,
    observationBytes = 0,
    observationCount = 0;
  const observations = [],
    turns = [],
    requests = [];
  const result = {
    url,
    importFetches,
    denied,
    observations,
    turns: [],
    requests,
  };
  let failure;
  try {
    const inert = (inertOwner = createSession({
      threadId: randomUUID(),
      url,
      fetch: async () => {
        throw new Error('Inert owner attempted fetch');
      },
    }));
    const off = inert.subscribe(() => {});
    inert.getSnapshot();
    off();
    await inert.dispose();
    inertOwner = undefined;
    result.inert = true;
    result.negative = await negativeControls(directory);
    const threadId = randomUUID();
    result.threadId = threadId;
    coordinator = createProofCoordinator(
      (thread) => {
        owner = createSession({
          threadId: thread,
          url,
          fetch: async (input, init) => {
            assert.equal(
              String(input),
              url,
              'Only owned exact loopback endpoint'
            );
            assert.equal(init.method, 'POST');
            const rawBody = init.body;
            assert.equal(typeof rawBody, 'string');
            requests.push({ rawBody, body: JSON.parse(rawBody) });
            assert.ok(requests.length <= 4, 'No positive retry/replay');
            return originalFetch(input, { ...init, redirect: 'error' });
          },
        });
        unsubscribe = owner.subscribe(() => {
          observationCount++;
          const snapshot = structuredClone(owner.getSnapshot());
          observationBytes += Buffer.byteLength(JSON.stringify(snapshot));
          if (observationCount > 4096 || observationBytes > 24 * 1024 * 1024) {
            result.observationOverflow = true;
            return;
          }
          observations.push(snapshot);
        });
        return owner;
      },
      () => threadId
    );
    const action = (name, surfaceId, context) =>
      JSON.stringify({
        version: 'v0.9',
        action: {
          name,
          surfaceId,
          sourceComponentId:
            name === 'bookingSubmit'
              ? 'submit'
              : name === 'flightSelect'
              ? 'btn_0'
              : 'modify',
          timestamp: '2026-10-17T00:00:00Z',
          context,
        },
      });
    const messages = [
      'I want to fly LAX to JFK',
      action('bookingSubmit', 'booking', {
        formId: 'booking',
        origin: ['SFO'],
        dest: ['SEA'],
        date: '2027-02-17',
        passengers: 3,
        fare_class: ['Business'],
      }),
      action('flightSelect', 'results', { flightId: 'UA204' }),
      action('modifySearch', 'confirmation', { formId: 'booking' }),
    ];
    const runIds = new Set(),
      humanIds = new Set();
    for (let index = 0; index < messages.length; index++) {
      const start = observations.length;
      const outcome = await coordinator.submit(messages[index]);
      const snapshot = structuredClone(owner.getSnapshot());
      const runId = snapshot.run?.id;
      const authored = observations
        .slice(start)
        .find(
          (s) => s.run?.id === runId && s.transcript.at(-1)?.role === 'user'
        )
        ?.transcript.at(-1);
      const turn = {
        turn: index + 1,
        threadId,
        runId,
        message: messages[index],
        outcome,
        snapshot,
        observations: observations.slice(start),
        human: authored,
        requests: requests.slice(index),
      };
      turns.push(turn);
      save(directory, `native-turn-${index + 1}.json`, turn);
      result.turns.push({
        turn: index + 1,
        artifact: `native-turn-${index + 1}.json`,
        outcome,
        runId,
      });
      assert.equal(
        result.observationOverflow,
        undefined,
        'Complete callback evidence required'
      );
      assert.ok(typeof runId === 'string' && !runIds.has(runId));
      runIds.add(runId);
      assert.ok(authored?.id && !humanIds.has(authored.id));
      humanIds.add(authored.id);
      assert.equal(authored.content, messages[index]);
      await acknowledgement(index + 1, threadId, runId);
    }
    assert.equal(requests.length, 4);
    assert.deepEqual(denied, []);
  } catch (error) {
    failure = String(error);
    result.failure = failure;
  } finally {
    if (inertOwner)
      try {
        await inertOwner.dispose();
      } catch (error) {
        result.inertCleanupFailure = String(error);
      }
    unsubscribe?.();
    if (coordinator) {
      try {
        await coordinator.dispose();
        coordinator.assertResourcesClosed();
      } catch (error) {
        result.cleanupFailure = String(error);
      }
      result.coordinator = coordinator.receipt();
    }
    globalThis.fetch = originalFetch;
    result.observationBytes = observationBytes;
    result.observationCount = observationCount;
    save(directory, 'native-result.json', result);
  }
  if (failure || result.cleanupFailure)
    throw new Error(failure ?? result.cleanupFailure);
  return {
    turns: turns.length,
    positiveRequests: requests.length,
    negativeRequests: result.negative.requests,
  };
}
