import { test } from 'node:test';
import assert from 'node:assert/strict';

const api = await import('./scenarios.mjs').catch(() => ({}));
test('recoverable read scenario exposes the exact explicit retry prompt for consumers', () => {
  assert.equal(
    api.getScenario('partial-failure').retryPrompt,
    'Retry the failed read explicitly.'
  );
});
function implementation() {
  assert.equal(
    typeof api.getScenario,
    'function',
    'scenario implementation is required'
  );
  assert.equal(
    typeof api.executeTool,
    'function',
    'tool implementation is required'
  );
  return api;
}

test('the reference conversation executes four named calls against the same two authored records', async () => {
  const { getScenario, executeTool } = implementation();
  const scenario = getScenario('references');
  assert.match(scenario.prompt, /official Angular signals documentation/);
  assert.deepEqual(
    scenario.calls.map((call) => call.name),
    ['search_reference', 'search_reference', 'read_reference', 'read_reference']
  );
  assert.equal(new Set(scenario.calls.map((call) => call.id)).size, 4);
  const results = await Promise.all(
    scenario.calls.map((call) => executeTool(call.name, call.args))
  );
  assert.equal(results[0][0].id, 'angular-signals');
  assert.equal(results[1][0].id, 'array-to-sorted');
  assert.equal(results[2].url, 'https://angular.dev/guide/signals');
  assert.equal(
    results[3].url,
    'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/toSorted'
  );
  assert.notEqual(results[2].summary, results[3].summary);
});

test('repeated names retain different invocation identities and real argument-dependent results', async () => {
  const { getScenario, executeTool } = implementation();
  const scenario = getScenario('repeated');
  assert.equal(scenario.calls.length, 3);
  assert.equal(new Set(scenario.calls.map((call) => call.id)).size, 3);
  assert.equal(new Set(scenario.calls.map((call) => call.name)).size, 1);
  const results = await Promise.all(
    scenario.calls.map((call) => executeTool(call.name, call.args))
  );
  assert.equal(results[0][0].id, 'angular-signals');
  assert.equal(results[1][0].id, 'array-to-sorted');
  assert.equal(results[2][0].id, 'angular-signals');
});

test('empty, zero, false and null results are successful data rather than an error or missing completion', async () => {
  const { executeTool } = implementation();
  for (const [kind, expected] of [
    ['zero', 0],
    ['false', false],
    ['empty', ''],
    ['array', []],
    ['null', null],
  ]) {
    assert.deepEqual(await executeTool('inspect_value', { kind }), expected);
  }
});

test('missing references and unknown tool names reject with bounded explicit errors', async () => {
  const { executeTool } = implementation();
  await assert.rejects(
    executeTool('read_reference', { id: 'not-a-reference' }),
    /Reference unavailable/
  );
  await assert.rejects(
    executeTool('eval', { code: 'PRIVATE payload' }),
    /Unsupported benchmark tool/
  );
  await assert.rejects(
    executeTool('search_reference', { query: 123 }),
    /Invalid reference query/
  );
});

test('argument fragments reconstruct the exact JSON payload without treating partial input as finalized', () => {
  const { argumentFragments } = implementation();
  assert.equal(typeof argumentFragments, 'function');
  const args = {
    query: 'Angular "signals"',
    nested: { count: 0, enabled: false },
  };
  const fragments = argumentFragments(args, 3);
  assert.ok(fragments.length > 1);
  assert.throws(() => JSON.parse(fragments[0]));
  assert.deepEqual(JSON.parse(fragments.join('')), args);
});

test('canonical result hashes ignore JSON object key order and preserve empty/false/zero distinctions', () => {
  const { hashValue } = implementation();
  assert.equal(typeof hashValue, 'function');
  assert.equal(
    hashValue({ b: 2, a: [false, 0, null] }),
    hashValue({ a: [false, 0, null], b: 2 })
  );
  assert.equal(new Set([false, 0, '', null, []].map(hashValue)).size, 5);
});

test('scenario selection is allowlisted and authored fixtures cannot be mutated by a renderer', () => {
  const { getScenario } = implementation();
  assert.throws(
    () => getScenario('../../arbitrary'),
    /Unknown benchmark scenario/
  );
  const scenario = getScenario('references');
  assert.ok(Object.isFrozen(scenario));
  assert.ok(Object.isFrozen(scenario.calls[0].args));
  assert.throws(() => {
    scenario.calls[0].args.query = 'changed';
  }, TypeError);
});
