import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureWorkbench } from './capture-workbench.js';

test('captures real partial and final application observations from the fixture', async () => {
  const recording = await captureWorkbench();
  assert.equal(recording.version, 1);
  assert.equal(recording.provenance.kind, 'sdk-fixture');
  assert.match(recording.provenance.description, /application state/i);
  const frames = recording.frames;
  assert.equal(frames[0].state, null);
  assert.equal(frames[0].messages.length, 0);
  assert.equal(frames[0].requests.length, 0);
  const answers = frames.flatMap((frame) =>
    frame.messages
      .filter((message) => message.role === 'assistant')
      .map((message) => message.text)
  );
  const final = answers.at(-1)!;
  assert.match(final, /Paris/);
  assert.match(final, /Louvre/);
  assert.ok(
    answers.some((text) => text.length > 0 && text.length < final.length)
  );
  assert.equal(frames.at(-1)!.event.type, 'capture.complete');
  assert.deepEqual(frames.at(-1)!.state, {
    creation: 'confirmed',
    busy: false,
    canSubmit: true,
    outcome: 'success',
  });
  assert.equal(frames.at(-1)!.messages.length, 2);
});

test('keeps detached, ordered frames and request status as observed at that instant', async () => {
  const { frames } = await captureWorkbench();
  assert.equal(new Set(frames.map((frame) => frame.id)).size, frames.length);
  for (let index = 1; index < frames.length; index++) {
    assert.ok(frames[index].elapsedMs >= frames[index - 1].elapsedMs);
  }
  const finalRequests = frames.at(-1)!.requests;
  assert.deepEqual(
    finalRequests.map(({ method, path, status }) => ({ method, path, status })),
    [
      { method: 'POST', path: '/threads', status: 200 },
      { method: 'POST', path: '/threads/trip-thread/runs/stream', status: 200 },
    ]
  );
  for (const request of finalRequests) {
    const first = frames.find((frame) =>
      frame.requests.some((entry) => entry.id === request.id)
    )!;
    assert.equal(
      first.requests.find((entry) => entry.id === request.id)!.status,
      null
    );
  }
  const earlier = frames.find((frame) => frame.messages.length === 2)!;
  const before = JSON.stringify(earlier);
  frames.at(-1)!.messages[1].text = 'changed';
  finalRequests[0].status = 500;
  assert.equal(JSON.stringify(earlier), before);
  assert.doesNotMatch(before, /authorization|apiKey|localhost|127\.0\.0\.1/i);
});

test('enforces capture bounds and releases resources after a failed capture', async () => {
  await assert.rejects(captureWorkbench({ maxFrames: 2 }), /capture limit/i);
  await assert.rejects(captureWorkbench({ maxBytes: 200 }), /capture limit/i);
  // A subsequent capture must still finish normally after both failure paths.
  assert.equal(
    (await captureWorkbench()).frames.at(-1)!.event.type,
    'capture.complete'
  );
});
