import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  findQueueEvidence,
  gatePassed,
  isQueueRunFor,
  REQUIRED_JOB,
} from './ci-queue-evidence.mjs';

const repo = 'cacheplane/threadplane';
const sha = 'a'.repeat(40);
const run = (overrides = {}) => ({
  id: 7,
  html_url: 'https://github.com/cacheplane/threadplane/actions/runs/7',
  event: 'merge_group',
  head_sha: sha,
  path: '.github/workflows/ci.yml',
  status: 'completed',
  conclusion: 'success',
  head_branch: `gh-readonly-queue/main/pr-1-${'b'.repeat(40)}`,
  repository: { full_name: repo },
  head_repository: { full_name: repo },
  ...overrides,
});
const gate = (overrides = {}) => ({ name: REQUIRED_JOB, status: 'completed', conclusion: 'success', ...overrides });
const api = (runs, jobs) => async (path) =>
  path.includes('/jobs?') ? { jobs: typeof jobs === 'function' ? jobs(path) : jobs } : { workflow_runs: runs };

test('accepts only a successful merge-queue run of this workflow for this exact commit', () => {
  assert.equal(isQueueRunFor(run(), { repo, sha }), true);
  for (const overrides of [
    { event: 'pull_request' },
    { event: 'push' },
    { head_sha: 'c'.repeat(40) },
    { path: '.github/workflows/other.yml' },
    { status: 'in_progress', conclusion: null },
    { conclusion: 'failure' },
    { conclusion: 'cancelled' },
    { conclusion: 'skipped' },
    { head_branch: 'main' },
    { head_branch: 'gh-readonly-queue/release/pr-1-x' },
    { head_branch: undefined },
    { repository: { full_name: 'someone/fork' } },
    { head_repository: { full_name: 'someone/fork' } },
    { head_repository: null },
  ]) assert.equal(isQueueRunFor(run(overrides), { repo, sha }), false, JSON.stringify(overrides));
  assert.equal(isQueueRunFor(undefined, { repo, sha }), false);
});

test('requires the gate job to have passed exactly once', () => {
  assert.equal(gatePassed([{ name: 'Other', conclusion: 'success' }, gate()]), true);
  assert.equal(gatePassed([]), false);
  assert.equal(gatePassed([{ name: 'Other', status: 'completed', conclusion: 'success' }]), false);
  assert.equal(gatePassed([gate(), gate()]), false);
  for (const conclusion of ['failure', 'cancelled', 'skipped', null]) assert.equal(gatePassed([gate({ conclusion })]), false, String(conclusion));
  assert.equal(gatePassed([gate({ status: 'in_progress' })]), false);
});

test('reports evidence for a verified commit and reads every page of jobs', async () => {
  const pages = [];
  const filler = Array.from({ length: 100 }, (_, index) => ({ name: `job ${index}`, status: 'completed', conclusion: 'success' }));
  const result = await findQueueEvidence({
    repo, sha,
    request: api([run()], (path) => { pages.push(path); return path.endsWith('page=1') ? filler : [gate()]; }),
  });
  assert.deepEqual(result, { verified: true, runId: 7, runUrl: 'https://github.com/cacheplane/threadplane/actions/runs/7' });
  assert.equal(pages.length, 2);
  assert.ok(pages.every((path) => path.includes('filter=latest')));
});

test('reports no evidence when the run, the gate, or the inputs are missing', async () => {
  assert.equal((await findQueueEvidence({ repo, sha, request: api([], []) })).verified, false);
  assert.equal((await findQueueEvidence({ repo, sha, request: api([run({ conclusion: 'failure' })], [gate()]) })).verified, false);
  assert.equal((await findQueueEvidence({ repo, sha, request: api([run()], [gate({ conclusion: 'failure' })]) })).verified, false);
  assert.equal((await findQueueEvidence({ repo, sha, request: api([run()], []) })).verified, false);
  assert.equal((await findQueueEvidence({ repo, sha, request: async () => ({}) })).verified, false);
  for (const bad of ['', 'abc', sha.toUpperCase(), undefined]) {
    assert.equal((await findQueueEvidence({ repo, sha: bad, request: api([run({ head_sha: bad })], [gate()]) })).verified, false, String(bad));
  }
  assert.equal((await findQueueEvidence({ repo: 'not a repo', sha, request: api([run()], [gate()]) })).verified, false);
});

test('a request failure propagates so the caller can fail closed', async () => {
  await assert.rejects(findQueueEvidence({ repo, sha, request: async () => { throw new Error('GitHub API 502'); } }), /502/);
});
