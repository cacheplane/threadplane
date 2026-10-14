import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { validateContext, observe, createRequest, serializeOutcome, writeOutcome, SCOPE_QUERY, OBSERVATION_QUERY } from './observe-maf.mjs';

const PROJECT = '5d9f70b9-895c-4319-b1e2-9a433d68b57c';
const SERVICE = 'ef1e4dff-35a7-40f0-ba7f-6e1a260171f0';
const DEPLOYMENT = '11111111-1111-4111-8111-111111111111';
const ENVIRONMENT = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const HEAD = 'a'.repeat(40);
const env = () => ({
  OBSERVER_MODE: 'observe', EXPECTED_MAIN: HEAD,
  EXPECTED_DEPLOYMENT_ID: DEPLOYMENT, PRODUCER_PROJECT_ID: PROJECT,
  PRODUCER_SERVICE_ID: SERVICE, PRODUCER_RUN: '123', PRODUCER_ATTEMPT: '1',
  PRODUCER_JOB: '456', GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF: 'refs/heads/main', GITHUB_SHA: HEAD,
  GITHUB_RUN_ID: '789', GITHUB_RUN_ATTEMPT: '1',
});
test('context rejects unsafe declarations and untrusted execution before token access', () => {
  const invalid = {
    OBSERVER_MODE: ['deploy', '', 'observe '], GITHUB_EVENT_NAME: ['pull_request'],
    GITHUB_REF: ['refs/heads/feature'], GITHUB_SHA: ['b'.repeat(40)],
    EXPECTED_MAIN: [HEAD.toUpperCase(), `${HEAD}\n`, ''],
    EXPECTED_DEPLOYMENT_ID: ['bad', `${DEPLOYMENT} `, PROJECT.toUpperCase()],
    PRODUCER_PROJECT_ID: [OTHER], PRODUCER_SERVICE_ID: [OTHER],
    PRODUCER_RUN: ['0', '01', '-1', '1.0', '9007199254740992', '1\n'],
    PRODUCER_ATTEMPT: [''], PRODUCER_JOB: [' 1'], GITHUB_RUN_ID: ['0'],
    GITHUB_RUN_ATTEMPT: ['1e2'],
  };
  for (const [key, values] of Object.entries(invalid)) for (const value of values) {
    const input = { ...env(), [key]: value };
    Object.defineProperty(input, 'RAILWAY_TOKEN', { get() { assert.fail('token accessed'); } });
    assert.throws(() => validateContext(input, HEAD), { code: 'CONTEXT_INVALID' }, key);
  }
  assert.throws(() => validateContext(env(), 'b'.repeat(40)), { code: 'CONTEXT_INVALID' });
});
test('context preserves valid declarations and actual observer provenance separately', () => {
  const context = validateContext(env(), HEAD);
  assert.equal(context.declared.expectedMain, HEAD);
  assert.equal(context.declared.expectedDeploymentId, DEPLOYMENT);
  assert.equal(context.observer.head, HEAD);
  assert.equal(context.observer.event, 'workflow_dispatch');
});

const START = Date.parse('2026-10-14T08:00:00Z');
const response = data => ({ statusCode: 200, headers: {}, body: JSON.stringify({ data }) });
const scope = () => response({ projectToken: { projectId: PROJECT, environmentId: ENVIRONMENT } });
const sample = (change = () => {}) => {
  const data = {
    deployment: { id: DEPLOYMENT, status: 'SUCCESS', createdAt: '2026-10-14T07:00:00Z',
      updatedAt: '2026-10-14T07:01:00Z', projectId: PROJECT, serviceId: SERVICE, environmentId: ENVIRONMENT },
    serviceInstance: { serviceId: SERVICE, environmentId: ENVIRONMENT, serviceName: 'ag-ui-maf',
      latestDeployment: { id: DEPLOYMENT, status: 'SUCCESS' },
      activeDeployments: [{ id: DEPLOYMENT, status: 'SUCCESS' }] },
  };
  change(data);
  return response(data);
};
async function run(replies, options = {}) {
  let elapsed = 0;
  const calls = [], sleeps = [];
  const deps = {
    now: () => START + elapsed, monotonicNow: () => elapsed,
    sleep: async ms => { sleeps.push(ms); elapsed += ms; },
    request: async input => {
      calls.push({ ...input, at: elapsed });
      const next = replies[Math.min(calls.length - 1, replies.length - 1)];
      if (next instanceof Error) throw next;
      if (typeof next === 'function') return next(input, ms => { elapsed += ms; });
      return next;
    },
  };
  const outcome = await observe({ ...validateContext(env(), HEAD), token: 'SENTINEL_SECRET', ...options }, deps);
  return { outcome, calls, sleeps };
}
test('auth absent fails without requests', async () => {
  const { outcome, calls } = await run([scope()], { token: '' });
  assert.equal(outcome.observationPassed, false);
  assert.equal(outcome.failureCode, 'AUTH_UNAVAILABLE');
  assert.equal(calls.length, 0);
});
test('transport and scope reject malformed, unauthorized and mismatched provider responses', async () => {
  const bad = [
    [{ statusCode: 302, headers: { location: 'https://evil.test/SENTINEL_SECRET' }, body: '' }, 'HTTP_REJECTED'],
    ...[401, 403, 400].map(statusCode => [{ statusCode, body: 'SENTINEL_SECRET' }, 'HTTP_REJECTED']),
    [{ statusCode: 200, body: '{"errors":[{"message":"SENTINEL_SECRET"}],"data":{}}' }, 'GRAPHQL_ERROR'],
    [{ statusCode: 200, body: '{' }, 'RESPONSE_INVALID'],
    [{ statusCode: 200, body: ' '.repeat(65537) }, 'RESPONSE_TOO_LARGE'],
    [response({ projectToken: null }), 'PROVIDER_INVALID'],
    [response({ projectToken: { projectId: OTHER, environmentId: ENVIRONMENT } }), 'SCOPE_MISMATCH'],
    [response({ projectToken: { projectId: PROJECT, environmentId: 'SENTINEL_SECRET' } }), 'PROVIDER_INVALID'],
    [{ statusCode: 200, body: '[]' }, 'RESPONSE_INVALID'],
  ];
  for (const [reply, code] of bad) {
    const { outcome, calls } = await run([reply]);
    assert.equal(outcome.observationPassed, false, code);
    assert.equal(outcome.failureCode, code);
    assert.equal(calls.length, 1);
    assert.ok(!JSON.stringify(outcome).includes('SENTINEL_SECRET'));
  }
});
test('identity, active and latest mismatches fail closed without substituting deployment', async () => {
  const changes = [
    d => { d.deployment.id = OTHER; }, d => { d.deployment.projectId = OTHER; },
    d => { d.deployment.serviceId = null; }, d => { d.deployment.environmentId = OTHER; },
    d => { d.serviceInstance.serviceId = OTHER; }, d => { d.serviceInstance.environmentId = OTHER; },
    d => { d.serviceInstance.serviceName = 'SENTINEL_SECRET'; },
    d => { d.deployment.createdAt = 'not-time'; },
    d => { d.deployment.createdAt = '2026-10-15T07:00:00Z'; },
    d => { d.deployment.updatedAt = '2026-10-15T07:00:00Z'; },
    d => { d.serviceInstance.activeDeployments.push({ id: OTHER, status: 'SUCCESS' }); },
    d => { d.serviceInstance.activeDeployments = []; },
    d => { d.serviceInstance.activeDeployments[0].id = OTHER; },
    d => { d.serviceInstance.activeDeployments[0].status = 'FAILED'; },
    d => { d.serviceInstance.latestDeployment.id = OTHER; },
    d => { d.serviceInstance.latestDeployment.status = 'DEPLOYING'; },
    d => { d.serviceInstance.latestDeployment = null; },
    d => { d.deployment.status = 'CRASHED'; }, d => { d.deployment.status = 'UNKNOWN'; },
  ];
  for (const change of changes) {
    const { outcome, calls } = await run([scope(), sample(change)]);
    assert.equal(outcome.observationPassed, false);
    assert.equal(calls.length, 2);
    assert.equal(outcome.provider.observations.length, 0);
  }
});
test('stable success requires two equal actual projections at least fifteen seconds apart', async () => {
  const { outcome, calls, sleeps } = await run([scope(), sample(), sample()]);
  assert.equal(outcome.observationPassed, true);
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [15000]);
  const [before, after] = outcome.provider.observations;
  assert.equal(after.observedAt - before.observedAt, 15000);
  assert.deepEqual(before.projection, after.projection);
  assert.equal(before.projection.repositorySha, null);
  assert.equal(before.projection.imageDigest, null);
  assert.equal(Object.keys(before.projection).length, 10);
  assert.equal(before.serviceInstance.latestDeployment.id, DEPLOYMENT);
});
test('pending expected deployment with an old active remains pending and resets stability', async () => {
  const pending = sample(d => {
    d.deployment.status = 'DEPLOYING';
    d.serviceInstance.latestDeployment.status = 'DEPLOYING';
    d.serviceInstance.activeDeployments[0].id = OTHER;
  });
  const { outcome, calls } = await run([scope(), sample(), pending, sample(), sample()]);
  assert.equal(outcome.observationPassed, true);
  assert.equal(calls.length, 5);
  assert.equal(outcome.provider.observations[1].pending, true);
  assert.deepEqual(outcome.stablePair, [2, 3]);
});
test('stable candidate changes require another equal observation', async () => {
  const changed = sample(d => { d.deployment.updatedAt = '2026-10-14T07:02:00Z'; });
  const { outcome, calls } = await run([scope(), sample(), changed, changed]);
  assert.equal(outcome.observationPassed, true);
  assert.equal(calls.length, 4);
  assert.deepEqual(outcome.stablePair, [1, 2]);
});
test('budget includes scope retries and caps total requests at twenty-four', async () => {
  const { outcome, calls } = await run([{ statusCode: 503, body: 'SENTINEL_SECRET' }]);
  assert.equal(outcome.observationPassed, false);
  assert.equal(outcome.failureCode, 'REQUEST_BUDGET');
  assert.equal(calls.length, 24);
  assert.equal(outcome.requestCount, 24);
  assert.equal(outcome.collectionStartedAt, START);
  assert.ok(outcome.collectedAt - START <= 300000);
});
test('timeout budget caps each whole request and every sleep by original deadline', async () => {
  const timeout = (input, advance) => {
    advance(input.timeoutMs);
    throw Object.assign(new Error('SENTINEL_SECRET'), { code: 'REQUEST_TIMEOUT' });
  };
  const { outcome, calls } = await run([timeout]);
  assert.equal(outcome.observationPassed, false);
  assert.equal(outcome.failureCode, 'DEADLINE');
  assert.equal(outcome.collectionStartedAt, START);
  assert.ok(outcome.collectedAt <= START + 300000);
  assert.ok(calls.every(c => c.timeoutMs > 0 && c.timeoutMs <= 20000 && c.at + c.timeoutMs <= 300000));
});
test('retry honors bounded Retry-After and resets stable candidate across error', async () => {
  const retry = { statusCode: 429, headers: { 'retry-after': '20', secret: 'SENTINEL_SECRET' }, body: 'SENTINEL_SECRET' };
  const { outcome, calls, sleeps } = await run([scope(), sample(), retry, sample(), sample()]);
  assert.equal(outcome.observationPassed, true);
  assert.equal(calls.length, 5);
  assert.ok(sleeps.includes(20000));
  assert.deepEqual(outcome.stablePair, [1, 2]);
  assert.equal(outcome.errors[0].code, 'RETRYABLE_HTTP');
  assert.ok(calls[3].at - calls[2].at >= 20000);
});
test('retry scope shares original interval and cannot use a Retry-After beyond deadline', async () => {
  const retry = { statusCode: 503, headers: { 'retry-after': '301' }, body: '' };
  const { outcome, calls } = await run([retry, scope(), sample(), sample()]);
  assert.equal(outcome.observationPassed, false);
  assert.equal(outcome.failureCode, 'DEADLINE');
  assert.equal(calls.length, 1);
  assert.equal(outcome.collectionStartedAt, START);
});
test('pending cannot cross full deadline or become accepted at exhaustion', async () => {
  const pending = sample(d => { d.deployment.status = 'BUILDING'; });
  const { outcome, calls } = await run([scope(), pending]);
  assert.equal(outcome.observationPassed, false);
  assert.equal(outcome.failureCode, 'DEADLINE');
  assert.ok(calls.length <= 24);
  assert.ok(outcome.collectedAt <= START + 300000);
});
test('freshness envelope preserves start before scope even when end is relabeled', async () => {
  const delayedScope = (input, advance) => { advance(20000); return scope(); };
  const { outcome } = await run([delayedScope, sample(), sample()]);
  assert.equal(outcome.collectionStartedAt, START);
  assert.equal(outcome.provider.scope.observedAt, START + 20000);
  const fresh = (value, now) => Number.isInteger(value.collectionStartedAt)
    && value.collectionStartedAt <= value.collectedAt && value.collectedAt <= now
    && now - value.collectionStartedAt <= 900000;
  assert.equal(fresh(outcome, START + 900000), true);
  assert.equal(fresh(outcome, START + 900001), false);
  assert.equal(fresh({ ...outcome, collectedAt: START + 900001 }, START + 900001), false);
  assert.equal(fresh(outcome, outcome.collectedAt - 1), false);
});
function fakeHttps(behavior) {
  const state = { calls: [], timers: [], cleared: [] };
  state.httpsRequest = (url, options, callback) => {
    state.calls.push({ url: String(url), options });
    const req = new EventEmitter();
    req.destroy = () => { state.destroyed = true; };
    req.end = body => {
      state.body = body;
      queueMicrotask(() => {
        const res = new EventEmitter();
        res.statusCode = 200; res.headers = {};
        res.destroy = () => { state.responseDestroyed = true; };
        behavior({ callback, req, res, state });
      });
    };
    return req;
  };
  state.setTimer = (callback, ms) => { state.timers.push({ callback, ms }); return state.timers.length; };
  state.clearTimer = id => { state.cleared.push(id); };
  return state;
}
test('transport sends fixed HTTPS POST query and secret header only in memory', async () => {
  const fake = fakeHttps(({ callback, res }) => {
    callback(res); res.emit('data', Buffer.from('{"data":{}}')); res.emit('end');
  });
  const result = await createRequest(fake)({ token: 'SENTINEL_SECRET', query: SCOPE_QUERY, variables: {}, timeoutMs: 1234 });
  assert.equal(result.body, '{"data":{}}');
  assert.equal(fake.calls[0].url, 'https://backboard.railway.com/graphql/v2');
  assert.equal(fake.calls[0].options.method, 'POST');
  assert.equal(fake.calls[0].options.headers['Project-Access-Token'], 'SENTINEL_SECRET');
  assert.equal(fake.timers[0].ms, 1234);
  assert.deepEqual(JSON.parse(fake.body), { query: SCOPE_QUERY, variables: {} });
  assert.ok(!fake.body.includes('SENTINEL_SECRET'));
  assert.deepEqual(fake.cleared, [1]);
});
test('transport whole body timeout, oversized stream and stream errors are controlled', async () => {
  const cases = [
    [({ callback, res, state }) => { callback(res); res.emit('data', Buffer.from('partial')); state.timers[0].callback(); }, 'REQUEST_TIMEOUT'],
    [({ callback, res }) => { callback(res); res.emit('data', Buffer.alloc(65537)); }, 'RESPONSE_TOO_LARGE'],
    [({ callback, res }) => { callback(res); res.emit('error', new Error('SENTINEL_SECRET')); }, 'TRANSPORT_ERROR'],
    [({ req }) => { req.emit('error', new Error('SENTINEL_SECRET')); }, 'TRANSPORT_ERROR'],
    [({ callback, res }) => { callback(res); res.emit('aborted'); }, 'TRANSPORT_ERROR'],
  ];
  for (const [behavior, code] of cases) {
    const fake = fakeHttps(behavior);
    await assert.rejects(createRequest(fake)({ token: 'SENTINEL_SECRET', query: SCOPE_QUERY, variables: {}, timeoutMs: 50 }),
      error => error.code === code && !String(error).includes('SENTINEL_SECRET'));
    assert.equal(fake.destroyed, true);
  }
});
test('artifact serialization drops extras and never claims release acceptance', async () => {
  const { outcome } = await run([scope(), sample(), sample()]);
  outcome.token = 'SENTINEL_SECRET'; outcome.rawBody = 'SENTINEL_SECRET';
  outcome.releaseAccepted = true; outcome.publicProofAccepted = true;
  const text = serializeOutcome(outcome, 'SENTINEL_SECRET');
  assert.ok(!text.includes('SENTINEL_SECRET'));
  const artifact = JSON.parse(text);
  assert.equal(artifact.schema, 'threadplane-maf-railway-observation-v1');
  assert.equal(artifact.evidenceMode, 'provider-observed');
  assert.equal(artifact.releaseAccepted, false);
  assert.equal(artifact.publicProofAccepted, false);
  assert.equal(artifact.observationPassed, true);
  assert.equal(artifact.repositorySha, null);
  assert.equal(artifact.imageDigest, null);
  assert.equal(artifact.unavailableReasons.repositorySha, 'SELECTED_PROVIDER_FIELDS_UNAVAILABLE');
  assert.ok(Buffer.byteLength(text) <= 65536);
});
test('partial failure preserves only validated observations and controlled errors', async () => {
  const error = new Error('SENTINEL_SECRET'); error.code = 'SENTINEL_SECRET';
  const { outcome } = await run([scope(), sample(), error, { statusCode: 403, body: 'SENTINEL_SECRET' }]);
  assert.equal(outcome.observationPassed, false);
  assert.equal(outcome.provider.observations.length, 1);
  assert.equal(outcome.stablePair, undefined);
  const artifact = JSON.parse(serializeOutcome(outcome, 'SENTINEL_SECRET'));
  assert.equal(artifact.failureCode, 'HTTP_REJECTED');
  assert.equal(artifact.stablePair, null);
  assert.ok(!JSON.stringify(artifact).includes('SENTINEL_SECRET'));
});
test('artifact files contain only actual stable pair and clear stale projections on partial failure', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'maf-observer-files-'));
  const { outcome } = await run([scope(), sample(), sample()]);
  assert.equal(writeOutcome(outcome, directory, 'SENTINEL_SECRET'), true);
  const before = JSON.parse(readFileSync(join(directory, 'maf-observation-before.json')));
  const after = JSON.parse(readFileSync(join(directory, 'maf-observation-after.json')));
  assert.deepEqual(before, outcome.provider.observations[0].projection);
  assert.deepEqual(after, before);
  const failed = await run([scope(), sample(), { statusCode: 401, body: 'SENTINEL_SECRET' }]);
  assert.equal(writeOutcome(failed.outcome, directory, 'SENTINEL_SECRET'), false);
  assert.deepEqual(readdirSync(directory), ['maf-observation.json']);
  assert.equal(JSON.parse(readFileSync(join(directory, 'maf-observation.json'))).observationPassed, false);
});
test('redaction drops a secret even inside a syntactically valid provider identity', async () => {
  const { outcome } = await run([scope(), sample(), sample()]);
  const directory = mkdtempSync(join(tmpdir(), 'maf-observer-redact-'));
  assert.equal(writeOutcome(outcome, directory, DEPLOYMENT), false);
  for (const name of readdirSync(directory)) assert.ok(!readFileSync(join(directory, name), 'utf8').includes(DEPLOYMENT));
  assert.deepEqual(readdirSync(directory), ['maf-observation.json']);
});
test('CLI guard failures are nonzero with sanitized partial envelope and import has no side effects', () => {
  const directory = mkdtempSync(join(tmpdir(), 'maf-observer-cli-'));
  const result = spawnSync(process.execPath, ['scripts/railway-observation/observe-maf.mjs', '--guard'], {
    encoding: 'utf8', env: { ...env(), PATH: process.env.PATH, RUNNER_TEMP: directory,
      GITHUB_EVENT_NAME: 'pull_request', RAILWAY_TOKEN: 'SENTINEL_SECRET' },
  });
  assert.equal(result.status, 1);
  const output = result.stdout + result.stderr + readdirSync(directory).map(name => readFileSync(join(directory, name), 'utf8')).join('');
  assert.ok(!output.includes('SENTINEL_SECRET'));
  assert.equal(JSON.parse(readFileSync(join(directory, 'maf-observation.json'))).failureCode, 'CONTEXT_INVALID');
  const imported = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./scripts/railway-observation/observe-maf.mjs');"], { encoding: 'utf8' });
  assert.equal(imported.status, 0);
  assert.equal(imported.stdout + imported.stderr, '');
});
test('CLI guard succeeds on actual checked out main declaration without token or transport', () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const result = spawnSync(process.execPath, ['scripts/railway-observation/observe-maf.mjs', '--guard'], {
    encoding: 'utf8', env: { ...env(), PATH: process.env.PATH, EXPECTED_MAIN: head, GITHUB_SHA: head,
      RUNNER_TEMP: mkdtempSync(join(tmpdir(), 'maf-observer-guard-')) },
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout + result.stderr, '');
});
test('subprocess injected provider errors and headers cannot leak to stdout stderr or artifacts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'maf-observer-subprocess-'));
  const script = `
    import {observe,validateContext,writeOutcome} from './scripts/railway-observation/observe-maf.mjs';
    const outcome = await observe({...validateContext(process.env, process.env.EXPECTED_MAIN), token: process.env.RAILWAY_TOKEN}, {
      now:()=>${START}, monotonicNow:()=>0, sleep:async()=>{},
      request:async()=>({statusCode:200, headers:{evil:process.env.RAILWAY_TOKEN},body:JSON.stringify({errors:[{message:process.env.RAILWAY_TOKEN}]})})
    });
    process.exitCode = writeOutcome(outcome, process.env.RUNNER_TEMP, process.env.RAILWAY_TOKEN) ? 0 : 1;
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8',
    env: { ...env(), PATH: process.env.PATH, RUNNER_TEMP: directory, RAILWAY_TOKEN: 'SENTINEL_SECRET' } });
  assert.equal(result.status, 1);
  const files = readdirSync(directory).map(name => readFileSync(join(directory, name), 'utf8')).join('');
  assert.ok(!`${result.stdout}${result.stderr}${files}`.includes('SENTINEL_SECRET'));
  assert.equal(JSON.parse(files).failureCode, 'GRAPHQL_ERROR');
});
test('subprocess malicious scope and deployment fields leave only sanitized partial files', () => {
  for (const badScope of [true, false]) {
    const directory = mkdtempSync(join(tmpdir(), 'maf-observer-provider-'));
    const script = `
      import {observe,validateContext,writeOutcome} from './scripts/railway-observation/observe-maf.mjs';
      let calls=0, elapsed=0;
      const scope=${JSON.stringify(JSON.parse(scope().body).data)};
      const sample=${JSON.stringify(JSON.parse(sample().body).data)};
      const outcome=await observe({...validateContext(process.env,process.env.EXPECTED_MAIN),token:process.env.RAILWAY_TOKEN},{
        now:()=>${START}+elapsed,monotonicNow:()=>elapsed,sleep:async ms=>{elapsed+=ms},
        request:async()=>{
          calls++;
          if (${badScope}) scope.projectToken.environmentId=process.env.RAILWAY_TOKEN;
          if(calls===3) sample.serviceInstance.serviceName=process.env.RAILWAY_TOKEN;
          return {statusCode:200,headers:{evil:process.env.RAILWAY_TOKEN},body:JSON.stringify({data:calls===1?scope:sample})};
        }
      });
      process.exitCode=writeOutcome(outcome,process.env.RUNNER_TEMP,process.env.RAILWAY_TOKEN)?0:1;
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8',
      env: { ...env(), PATH: process.env.PATH, RUNNER_TEMP: directory, RAILWAY_TOKEN: 'SENTINEL_SECRET' } });
    assert.equal(result.status, 1);
    assert.deepEqual(readdirSync(directory), ['maf-observation.json']);
    const bytes = readFileSync(join(directory, 'maf-observation.json'), 'utf8');
    assert.ok(!`${result.stdout}${result.stderr}${bytes}`.includes('SENTINEL_SECRET'));
    assert.equal(JSON.parse(bytes).provider.observations.length, badScope ? 0 : 1);
  }
});
test('retry scope discovery preserves its original start and all four requests', async () => {
  const { outcome, calls } = await run([{ statusCode: 503, body: '' }, scope(), sample(), sample()]);
  assert.equal(outcome.observationPassed, true);
  assert.equal(outcome.collectionStartedAt, START);
  assert.equal(outcome.provider.scope.observedAt, START + 1000);
  assert.equal(outcome.collectedAt, START + 16000);
  assert.equal(calls.length, 4);
});
function checkWorkflow(text) {
  assert.match(text, /name: Railway MAF observer\n/);
  assert.match(text, /  pull_request:\n    paths:\n/);
  assert.match(text, /  workflow_dispatch:\n/);
  for (const file of ['.github/workflows/observe-maf-railway.yml', 'scripts/railway-observation/observe-maf.mjs', 'scripts/railway-observation/observe-maf.spec.mjs']) {
    assert.ok(text.includes(`      - '${file}'`));
  }
  assert.equal((text.match(/^      - '/gm) ?? []).length, 3);
  assert.match(text, /permissions:\n  contents: read\n/);
  assert.doesNotMatch(text, /pull_request_target|workflow_run|schedule:|\bpush:|npm |npx |cache:|continue-on-error|railway up|curl |wget /);
  const unit = text.split('  unit:\n')[1]?.split('\n  observe:\n')[0];
  const observer = text.split('\n  observe:\n')[1];
  assert.ok(unit && observer);
  assert.match(unit, /name: Railway MAF observer — unit/);
  assert.match(unit, /if: github.event_name == 'pull_request'/);
  assert.match(unit, /run: node --test scripts\/railway-observation\/observe-maf.spec.mjs/);
  assert.doesNotMatch(unit, /secrets\.|RAILWAY_TOKEN/);
  assert.match(observer, /name: Railway MAF observer — observe/);
  assert.match(observer, /if: github.event_name == 'workflow_dispatch' && github.ref == 'refs\/heads\/main' && github.sha == inputs.expectedMain && inputs.mode == 'observe'/);
  assert.match(observer, /ref: \$\{\{ github.sha \}\}/);
  assert.match(observer, /timeout-minutes: 8/);
  assert.match(observer, /group: railway-maf-observer-/);
  assert.match(observer, /cancel-in-progress: false/);
  for (const pin of ['de0fac2e4500dabe0009e67214ff5f5447ce83dd', '53b83947a5a98c8d113130e565377fae1a50d02f', 'ea165f8d65b6e75b540449e92b4886f43607fa02']) assert.ok(text.includes(pin));
  assert.equal((text.match(/persist-credentials: false/g) ?? []).length, 2);
  assert.equal((text.match(/node-version: 22/g) ?? []).length, 2);
  const steps = observer.split(/\n      - /).slice(1);
  const guard = steps.findIndex(step => step.includes('id: guard\n'));
  const query = steps.findIndex(step => step.includes('id: observe\n'));
  assert.ok(guard >= 0 && query > guard);
  assert.match(steps[guard], /run: node scripts\/railway-observation\/observe-maf.mjs --guard/);
  assert.doesNotMatch(steps[guard], /secrets\.|RAILWAY_TOKEN/);
  assert.match(steps[query], /RAILWAY_TOKEN: \$\{\{ secrets.RAILWAY_TOKEN \}\}/);
  assert.match(steps[query], /run: node scripts\/railway-observation\/observe-maf.mjs$/);
  assert.equal((text.match(/secrets\./g) ?? []).length, 1);
  for (const [index, step] of steps.entries()) if (index !== query) assert.doesNotMatch(step, /RAILWAY_TOKEN|secrets\./);
  for (const run of text.matchAll(/run: (.*)/g)) assert.doesNotMatch(run[1], /\$\{\{|RAILWAY_TOKEN/);
  const upload = steps.at(-1);
  assert.match(upload, /if: always\(\)/);
  assert.match(upload, /retention-days: 1/);
  assert.doesNotMatch(upload, /\*/);
  for (const file of ['maf-observation.json', 'maf-observation-before.json', 'maf-observation-after.json']) assert.ok(upload.includes(`\${{ runner.temp }}/${file}`));
}
test('workflow contract rejects unsafe in-memory guard and secret fixtures', () => {
  const unsafe = 'jobs:\n  unit:\n    env:\n      RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}\n    steps:\n      - run: node scripts/railway-observation/observe-maf.mjs\n';
  assert.throws(() => checkWorkflow(unsafe));
});
test('workflow actual source satisfies trusted-main and isolated secret contract', () => {
  const text = readFileSync(new URL('../../.github/workflows/observe-maf-railway.yml', import.meta.url), 'utf8');
  checkWorkflow(text);
  for (const unsafe of [
    text.replace("github.ref == 'refs/heads/main'", 'true'),
    text.replace('github.sha == inputs.expectedMain', 'true'),
    text.replace('node scripts/railway-observation/observe-maf.mjs --guard', 'echo skip'),
    text.replace("if: github.event_name == 'pull_request'", 'env:\n      RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}'),
    text.replace('persist-credentials: false', 'persist-credentials: true'),
    text.replace('ref: ${{ github.sha }}', 'ref: ${{ inputs.expectedMain }}'),
  ]) assert.throws(() => checkWorkflow(unsafe));
});
test('CLI absent auth emits actual reviewed file and sealed query hashes without network', () => {
  const directory = mkdtempSync(join(tmpdir(), 'maf-observer-hashes-'));
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const result = spawnSync(process.execPath, ['scripts/railway-observation/observe-maf.mjs'], {
    encoding: 'utf8', env: { ...env(), PATH: process.env.PATH, EXPECTED_MAIN: head, GITHUB_SHA: head, RUNNER_TEMP: directory },
  });
  assert.equal(result.status, 1);
  const artifact = JSON.parse(readFileSync(join(directory, 'maf-observation.json')));
  assert.equal(artifact.failureCode, 'AUTH_UNAVAILABLE');
  assert.equal(artifact.requestCount, 0);
  const hash = value => createHash('sha256').update(value).digest('hex');
  for (const [key, file] of Object.entries({ collector: 'scripts/railway-observation/observe-maf.mjs', workflow: '.github/workflows/observe-maf-railway.yml', tests: 'scripts/railway-observation/observe-maf.spec.mjs' })) {
    assert.equal(artifact.observer.sourceHashes[key], hash(readFileSync(resolve(file))));
  }
  assert.equal(hash(SCOPE_QUERY), 'e1da551f349646262f9837820dad4e30f40787c049ed42fa965075bfe84fab63');
  assert.equal(hash(OBSERVATION_QUERY), '1a31a6b734c5c8c79a6fe4da12c34c794662df12d1dd4c20d545b9a445cadf7e');
  assert.equal(artifact.observer.sourceHashes.scopeQuery, hash(SCOPE_QUERY));
  assert.equal(artifact.observer.sourceHashes.observationQuery, hash(OBSERVATION_QUERY));
});
test('identity rejects impossible calendar dates that Date.parse silently normalizes', async () => {
  const malformed = sample(d => { d.deployment.createdAt = '2026-02-30T07:00:00Z'; });
  const { outcome } = await run([scope(), malformed, malformed]);
  assert.equal(outcome.observationPassed, false);
  assert.equal(outcome.failureCode, 'PROVIDER_INVALID');
});
test('budget cannot accept a pair after response validation crosses deadline', async () => {
  const slowValidation = (_input, advance) => {
    advance(284999);
    const value = sample();
    return { ...value, get body() { advance(1); return value.body; } };
  };
  const { outcome } = await run([scope(), sample(), slowValidation]);
  assert.equal(outcome.observationPassed, false);
  assert.equal(outcome.failureCode, 'DEADLINE');
});
test('artifact serialization drops unexpected nested types rather than emitting opaque fields', async () => {
  const { outcome } = await run([scope(), sample(), sample()]);
  outcome.provider.observations[0].projection.id = { meta: 'OPAQUE_PROVIDER_VALUE' };
  const text = serializeOutcome(outcome);
  assert.ok(!text.includes('OPAQUE_PROVIDER_VALUE'));
  assert.equal(JSON.parse(text).observationPassed, false);
});
