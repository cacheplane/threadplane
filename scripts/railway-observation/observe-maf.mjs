import https from 'node:https';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PROJECT = '5d9f70b9-895c-4319-b1e2-9a433d68b57c';
export const SERVICE = 'ef1e4dff-35a7-40f0-ba7f-6e1a260171f0';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{40}$/;
const integer = value => typeof value === 'string' && /^[1-9][0-9]*$/.test(value)
  && Number.isSafeInteger(Number(value));
const matches = (pattern, value) => typeof value === 'string' && pattern.test(value);
function failure(code) { return Object.assign(new Error(code), { code }); }
function requireFact(condition, code = 'PROVIDER_INVALID') { if (!condition) throw failure(code); }

export function validateContext(env, actualHead) {
  const declared = {
    expectedMain: env.EXPECTED_MAIN, expectedDeploymentId: env.EXPECTED_DEPLOYMENT_ID,
    producerProjectId: env.PRODUCER_PROJECT_ID, producerServiceId: env.PRODUCER_SERVICE_ID,
    producerRun: env.PRODUCER_RUN, producerAttempt: env.PRODUCER_ATTEMPT, producerJob: env.PRODUCER_JOB,
  };
  requireFact(env.OBSERVER_MODE === 'observe' && env.GITHUB_EVENT_NAME === 'workflow_dispatch'
    && env.GITHUB_REF === 'refs/heads/main' && matches(SHA, declared.expectedMain)
    && declared.expectedMain === env.GITHUB_SHA && env.GITHUB_SHA === actualHead
    && matches(UUID, declared.expectedDeploymentId) && declared.producerProjectId === PROJECT
    && declared.producerServiceId === SERVICE
    && [declared.producerRun, declared.producerAttempt, declared.producerJob,
      env.GITHUB_RUN_ID, env.GITHUB_RUN_ATTEMPT].every(integer), 'CONTEXT_INVALID');
  return { declared, observer: { run: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT,
    event: env.GITHUB_EVENT_NAME, ref: env.GITHUB_REF, head: actualHead,
    workflowPath: '.github/workflows/observe-maf-railway.yml', independentlyVerified: false } };
}

export const ENDPOINT = 'https://backboard.railway.com/graphql/v2';
export const SCOPE_QUERY = 'query { projectToken { projectId environmentId } }';
export const OBSERVATION_QUERY = `query ObserveMaf($deploymentId: String!, $serviceId: String!, $environmentId: String!) {
  deployment(id: $deploymentId) {
    id status createdAt updatedAt projectId serviceId environmentId
  }
  serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
    serviceId environmentId serviceName
    latestDeployment { id status }
    activeDeployments { id status }
  }
}`;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function decode(response) {
  requireFact(response && Number.isInteger(response.statusCode), 'RESPONSE_INVALID');
  if (response.statusCode === 429 || (response.statusCode >= 500 && response.statusCode <= 599)) {
    const error = failure('RETRYABLE_HTTP');
    const header = response.headers?.['retry-after'];
    if (typeof header === 'string' && header.length <= 128) error.retryAfter = header;
    throw error;
  }
  requireFact(response.statusCode === 200, 'HTTP_REJECTED');
  requireFact(typeof response.body === 'string', 'RESPONSE_INVALID');
  requireFact(Buffer.byteLength(response.body) <= 65536, 'RESPONSE_TOO_LARGE');
  let parsed;
  try { parsed = JSON.parse(response.body); } catch { throw failure('RESPONSE_INVALID'); }
  requireFact(object(parsed), 'RESPONSE_INVALID');
  requireFact(!Object.hasOwn(parsed, 'errors'), 'GRAPHQL_ERROR');
  requireFact(object(parsed.data), 'RESPONSE_INVALID');
  return parsed.data;
}
const PENDING = new Set(['INITIALIZING', 'QUEUED', 'BUILDING', 'DEPLOYING', 'WAITING', 'SLEEPING']);
const STATUSES = new Set([...PENDING, 'SUCCESS', 'FAILED', 'CRASHED', 'REMOVED', 'REMOVING', 'SKIPPED']);
function deploymentRef(value) {
  requireFact(object(value) && matches(UUID, value.id) && STATUSES.has(value.status));
  return { id: value.id, status: value.status };
}
function observation(data, options, scope, observedAt) {
  const d = data.deployment, s = data.serviceInstance;
  requireFact(object(d) && object(s));
  for (const key of ['id', 'projectId', 'serviceId', 'environmentId']) requireFact(matches(UUID, d[key]));
  requireFact(d.id === options.declared.expectedDeploymentId && d.projectId === PROJECT
    && d.serviceId === SERVICE && d.environmentId === scope.environmentId, 'IDENTITY_MISMATCH');
  requireFact(s.serviceId === SERVICE && s.environmentId === scope.environmentId && s.serviceName === 'ag-ui-maf', 'IDENTITY_MISMATCH');
  const timestamp = value => typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
  requireFact(timestamp(d.createdAt) && timestamp(d.updatedAt)
    && Date.parse(d.createdAt) <= Date.parse(d.updatedAt) && Date.parse(d.updatedAt) <= observedAt);
  requireFact(STATUSES.has(d.status));
  const latestDeployment = deploymentRef(s.latestDeployment);
  requireFact(Array.isArray(s.activeDeployments) && s.activeDeployments.length <= 1, 'ACTIVE_MISMATCH');
  const activeDeployments = s.activeDeployments.map(deploymentRef);
  requireFact(latestDeployment.id === d.id, 'LATEST_MISMATCH');
  const pending = PENDING.has(d.status);
  requireFact(pending || d.status === 'SUCCESS', 'DEPLOYMENT_TERMINAL');
  if (!pending) requireFact(latestDeployment.status === 'SUCCESS' && activeDeployments.length === 1
    && activeDeployments[0].id === d.id && activeDeployments[0].status === 'SUCCESS', 'ACTIVE_MISMATCH');
  return {
    observedAt, pending,
    projection: { id: d.id, activeDeploymentId: activeDeployments[0]?.id ?? null,
      projectId: d.projectId, serviceId: d.serviceId, environmentId: d.environmentId,
      status: d.status, createdAt: d.createdAt, updatedAt: d.updatedAt, repositorySha: null, imageDigest: null },
    serviceInstance: { serviceId: s.serviceId, environmentId: s.environmentId,
      serviceName: 'ag-ui-maf', latestDeployment, activeDeployments },
  };
}
const ERROR_CODES = new Set(['AUTH_UNAVAILABLE', 'CONTEXT_INVALID', 'RESPONSE_INVALID',
  'RESPONSE_TOO_LARGE', 'GRAPHQL_ERROR', 'HTTP_REJECTED', 'RETRYABLE_HTTP', 'REQUEST_TIMEOUT',
  'TRANSPORT_ERROR', 'PROVIDER_INVALID', 'SCOPE_MISMATCH', 'IDENTITY_MISMATCH', 'ACTIVE_MISMATCH',
  'LATEST_MISMATCH', 'DEPLOYMENT_TERMINAL', 'DEADLINE', 'REQUEST_BUDGET', 'SOURCE_UNAVAILABLE']);
const errorCode = error => ERROR_CODES.has(error?.code) ? error.code : 'TRANSPORT_ERROR';

// A single timer covers connection, headers and the complete response body.
export function createRequest({ httpsRequest = https.request, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  return ({ token, query, variables, timeoutMs }) => new Promise((resolve, reject) => {
    let req, res, timer, settled = false;
    function finish(error, result) {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimer(timer);
      if (error) {
        req?.destroy(); res?.destroy();
        reject(failure(errorCode(error)));
      } else resolve(result);
    }
    try {
      requireFact(query === SCOPE_QUERY || query === OBSERVATION_QUERY, 'CONTEXT_INVALID');
      requireFact(Number.isFinite(timeoutMs) && timeoutMs > 0 && timeoutMs <= 20000, 'CONTEXT_INVALID');
      const body = JSON.stringify({ query, variables });
      req = httpsRequest(ENDPOINT, { method: 'POST', headers: {
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
        'Project-Access-Token': token,
      } }, response => {
        res = response;
        let bytes = 0;
        const chunks = [];
        res.on('error', () => finish(failure('TRANSPORT_ERROR')));
        res.on('aborted', () => finish(failure('TRANSPORT_ERROR')));
        res.on('data', chunk => {
          if (settled) return;
          bytes += chunk.length;
          if (bytes > 65536) finish(failure('RESPONSE_TOO_LARGE'));
          else chunks.push(Buffer.from(chunk));
        });
        res.on('end', () => finish(null, { statusCode: res.statusCode,
          headers: { 'retry-after': res.headers['retry-after'] }, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', () => finish(failure('TRANSPORT_ERROR')));
      timer = setTimer(() => finish(failure('REQUEST_TIMEOUT')), timeoutMs);
      req.end(body);
    } catch { finish(failure('TRANSPORT_ERROR')); }
  });
}

const pick = (value, keys) => Object.fromEntries(keys.map(key => {
  const item = value?.[key];
  return [key, ['string', 'number', 'boolean'].includes(typeof item) ? item : null];
}));
const PROJECTION_KEYS = ['id', 'activeDeploymentId', 'projectId', 'serviceId', 'environmentId',
  'status', 'createdAt', 'updatedAt', 'repositorySha', 'imageDigest'];
export function serializeOutcome(outcome, secret = '') {
  let invalid = false;
  const observations = (outcome.provider?.observations ?? []).slice(0, 24).flatMap(value => {
    try {
      requireFact(Number.isSafeInteger(value.observedAt));
      const current = observation({ deployment: pick(value.projection, PROJECTION_KEYS),
        serviceInstance: value.serviceInstance }, outcome, outcome.provider.scope, value.observedAt);
      requireFact(JSON.stringify(current.projection) === JSON.stringify(pick(value.projection, PROJECTION_KEYS)));
      return [current];
    } catch { invalid = true; return []; }
  });
  const pair = outcome.stablePair;
  const passed = !invalid && outcome.observationPassed === true && Array.isArray(pair) && pair.length === 2
    && pair.every(index => Number.isInteger(index) && observations[index] && !observations[index].pending)
    && pair[0] < pair[1]
    && observations[pair[1]].observedAt - observations[pair[0]].observedAt >= 15000
    && JSON.stringify(observations[pair[0]].projection) === JSON.stringify(observations[pair[1]].projection);
  const envelope = {
    schema: 'threadplane-maf-railway-observation-v1', evidenceMode: 'provider-observed',
    observationPassed: Boolean(passed), releaseAccepted: false, publicProofAccepted: false,
    declared: pick(outcome.declared, ['expectedMain', 'expectedDeploymentId', 'producerProjectId',
      'producerServiceId', 'producerRun', 'producerAttempt', 'producerJob']),
    observer: { ...pick(outcome.observer, ['run', 'attempt', 'event', 'ref', 'head', 'workflowPath']),
      independentlyVerified: false,
      sourceHashes: pick(outcome.observer?.sourceHashes, ['collector', 'workflow', 'tests', 'scopeQuery', 'observationQuery']) },
    provider: { scope: outcome.provider?.scope ? pick(outcome.provider.scope, ['projectId', 'environmentId', 'observedAt']) : null,
      observations },
    collectionStartedAt: outcome.collectionStartedAt, collectedAt: outcome.collectedAt,
    requestCount: outcome.requestCount, attemptCount: outcome.requestCount,
    stablePair: passed ? pair : null,
    failureCode: passed ? null : errorCode({ code: outcome.failureCode }),
    errors: (outcome.errors ?? []).slice(0, 24).map(value => ({ code: errorCode(value),
      observedAt: value.observedAt, requestCount: value.requestCount })),
    bounds: { collectionDeadlineMs: 300000, requestTimeoutMs: 20000, pollIntervalMs: 15000,
      maxAllRequests: 24, maxResponseBytes: 65536, stableSamples: 2 },
    repositorySha: null, imageDigest: null,
    unavailableReasons: { repositorySha: 'SELECTED_PROVIDER_FIELDS_UNAVAILABLE', imageDigest: 'SELECTED_PROVIDER_FIELDS_UNAVAILABLE' },
  };
  // Every nested value above is selected explicitly. Redact even a secret that
  // happens to match an otherwise valid provider identity or timestamp.
  let redacted = false;
  let encoded = JSON.stringify(envelope, (_key, value) => {
    if (typeof value === 'string' && secret && value.includes(secret)) { redacted = true; return null; }
    return value;
  });
  if (redacted) {
    const safe = JSON.parse(encoded);
    safe.observationPassed = false; safe.stablePair = null; safe.failureCode = 'PROVIDER_INVALID';
    encoded = JSON.stringify(safe);
  }
  // Extremely short pathological secrets may also coincide with JSON keys.
  return (secret && encoded.includes(secret)) || Buffer.byteLength(encoded) > 65536 ? '{}' : encoded;
}
export async function observe(options, deps) {
  const collectionStartedAt = deps.now(), started = deps.monotonicNow();
  const outcome = { declared: options.declared, observer: options.observer,
    collectionStartedAt, observationPassed: false, requestCount: 0, errors: [],
    provider: { scope: null, observations: [] } };
  const remaining = () => 300000 - (deps.monotonicNow() - started);
  const budget = () => {
    requireFact(remaining() > 0, 'DEADLINE');
    requireFact(outcome.requestCount < 24, 'REQUEST_BUDGET');
  };
  async function read(query, variables) {
    budget();
    outcome.requestCount++;
    const response = await deps.request({ query, variables, token: options.token,
      timeoutMs: Math.min(20000, remaining()) });
    requireFact(remaining() > 0, 'DEADLINE');
    const data = decode(response);
    requireFact(remaining() > 0, 'DEADLINE');
    return data;
  }
  async function pause(ms) {
    requireFact(ms <= remaining(), 'DEADLINE');
    await deps.sleep(ms);
  }
  let retryCount = 0;
  async function retry(error, observing) {
    const code = errorCode(error);
    if (!['REQUEST_TIMEOUT', 'TRANSPORT_ERROR', 'RETRYABLE_HTTP'].includes(code)) throw failure(code);
    outcome.errors.push({ code, observedAt: deps.now(), requestCount: outcome.requestCount });
    budget();
    let delay = Math.min(1000 * 2 ** Math.min(retryCount++, 4), 10000);
    if (observing) delay = Math.max(15000, delay);
    const after = error?.retryAfter;
    if (typeof after === 'string') {
      const value = /^[0-9]+$/.test(after) ? Number(after) * 1000 : Date.parse(after) - deps.now();
      if (Number.isFinite(value) && value > 0) delay = Math.max(delay, value);
    }
    await pause(delay);
  }
  try {
    requireFact(typeof options.token === 'string' && options.token.length > 0, 'AUTH_UNAVAILABLE');
    let data;
    while (!data) {
      try { data = await read(SCOPE_QUERY, {}); } catch (error) { await retry(error, false); }
    }
    const scope = data.projectToken;
    requireFact(object(scope) && matches(UUID, scope.projectId) && matches(UUID, scope.environmentId));
    requireFact(scope.projectId === PROJECT && scope.projectId === options.declared.producerProjectId, 'SCOPE_MISMATCH');
    outcome.provider.scope = { projectId: scope.projectId, environmentId: scope.environmentId, observedAt: deps.now() };
    let candidate;
    while (true) {
      let data;
      try {
        data = await read(OBSERVATION_QUERY, { deploymentId: options.declared.expectedDeploymentId,
          serviceId: SERVICE, environmentId: scope.environmentId });
      } catch (error) { candidate = undefined; await retry(error, true); continue; }
      const current = observation(data, options, scope, deps.now());
      requireFact(remaining() > 0, 'DEADLINE');
      outcome.provider.observations.push(current);
      if (current.pending) candidate = undefined;
      else if (candidate && current.observedAt - candidate.value.observedAt >= 15000
        && JSON.stringify(candidate.value.projection) === JSON.stringify(current.projection)) {
        outcome.observationPassed = true;
        outcome.stablePair = [candidate.index, outcome.provider.observations.length - 1];
        break;
      } else candidate = { value: current, index: outcome.provider.observations.length - 1 };
      budget();
      await pause(15000);
    }
  } catch (error) { outcome.failureCode = errorCode(error); }
  outcome.collectedAt = deps.now();
  return outcome;
}

export function writeOutcome(outcome, directory, secret = '') {
  requireFact(typeof directory === 'string' && isAbsolute(directory), 'CONTEXT_INVALID');
  for (const name of ['maf-observation-before.json', 'maf-observation-after.json']) rmSync(join(directory, name), { force: true });
  const encoded = serializeOutcome(outcome, secret);
  const envelope = JSON.parse(encoded);
  if (envelope.observationPassed === true) {
    const [before, after] = envelope.stablePair.map(index => envelope.provider.observations[index].projection);
    writeFileSync(join(directory, 'maf-observation-before.json'), `${JSON.stringify(before)}\n`, { mode: 0o600 });
    writeFileSync(join(directory, 'maf-observation-after.json'), `${JSON.stringify(after)}\n`, { mode: 0o600 });
  }
  writeFileSync(join(directory, 'maf-observation.json'), `${encoded}\n`, { mode: 0o600 });
  return envelope.observationPassed === true;
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function sourceHashes() {
  try {
    return { collector: sha256(readFileSync(new URL('./observe-maf.mjs', import.meta.url))),
      workflow: sha256(readFileSync(new URL('../../.github/workflows/observe-maf-railway.yml', import.meta.url))),
      tests: sha256(readFileSync(new URL('./observe-maf.spec.mjs', import.meta.url))),
      scopeQuery: sha256(SCOPE_QUERY), observationQuery: sha256(OBSERVATION_QUERY) };
  } catch { throw failure('SOURCE_UNAVAILABLE'); }
}

export async function runCli(env = process.env, args = process.argv.slice(2)) {
  const started = Date.now();
  let context;
  let secret = '';
  try {
    requireFact(args.length === 0 || (args.length === 1 && args[0] === '--guard'), 'CONTEXT_INVALID');
    let actualHead;
    try {
      actualHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8',
        env: { PATH: env.PATH }, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch { throw failure('CONTEXT_INVALID'); }
    context = validateContext(env, actualHead);
    if (args[0] === '--guard') return 0;
    context.observer.sourceHashes = sourceHashes();
    // This is the first token access, after the same guard used by --guard.
    secret = env.RAILWAY_TOKEN ?? '';
    const outcome = await observe({ ...context, token: secret }, { request: createRequest(),
      now: Date.now, monotonicNow: () => performance.now(), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) });
    const passed = writeOutcome(outcome, env.RUNNER_TEMP, secret);
    if (!passed) process.stderr.write(`${errorCode({ code: outcome.failureCode })}\n`);
    return passed ? 0 : 1;
  } catch (error) {
    const code = errorCode(error);
    try { writeOutcome({ ...context, collectionStartedAt: started, collectedAt: Date.now(),
      observationPassed: false, failureCode: code, requestCount: 0, errors: [],
      provider: { scope: null, observations: [] } }, env.RUNNER_TEMP, secret); } catch { /* Best-effort partial receipt only. */ }
    process.stderr.write(`${code}\n`);
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runCli();
}
