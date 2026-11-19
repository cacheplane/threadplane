#!/usr/bin/env node
// Decides whether a push to main may reuse the merge queue's verification.
//
// The merge queue runs CI on a candidate commit and then fast-forwards main to
// that same commit, so the push run would repeat the candidate's verification
// on an identical tree with an identical workflow file. This script looks for
// that candidate run and reports `queue_verified=true` only when every check
// below holds. Anything else, including an API error, reports `false`, and the
// push run verifies the commit itself.
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const WORKFLOW_PATH = '.github/workflows/ci.yml';
export const REQUIRED_JOB = 'CI — required';
export const QUEUE_BRANCH_PREFIX = 'gh-readonly-queue/main/';

/** A run counts only if it is this workflow's merge-queue run of this commit. */
export function isQueueRunFor(run, { repo, sha }) {
  return (
    run?.event === 'merge_group' &&
    run.head_sha === sha &&
    run.path === WORKFLOW_PATH &&
    run.status === 'completed' &&
    run.conclusion === 'success' &&
    typeof run.head_branch === 'string' &&
    run.head_branch.startsWith(QUEUE_BRANCH_PREFIX) &&
    run.repository?.full_name === repo &&
    run.head_repository?.full_name === repo
  );
}

/** The gate must have run and passed in the latest attempt, exactly once. */
export function gatePassed(jobs) {
  const gates = jobs.filter((job) => job?.name === REQUIRED_JOB);
  return (
    gates.length === 1 &&
    gates[0].status === 'completed' &&
    gates[0].conclusion === 'success'
  );
}

export async function findQueueEvidence({ repo, sha, request }) {
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) return { verified: false, reason: 'no commit SHA' };
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) return { verified: false, reason: 'no repository' };
  const listing = await request(
    `/repos/${repo}/actions/runs?head_sha=${sha}&event=merge_group&per_page=100`
  );
  const runs = (listing?.workflow_runs ?? []).filter((run) => isQueueRunFor(run, { repo, sha }));
  if (runs.length === 0) return { verified: false, reason: 'no successful merge-queue run for this commit' };
  for (const run of runs) {
    const jobs = [];
    for (let page = 1; page <= 10; page++) {
      const body = await request(
        `/repos/${repo}/actions/runs/${run.id}/jobs?filter=latest&per_page=100&page=${page}`
      );
      const batch = body?.jobs ?? [];
      jobs.push(...batch);
      if (batch.length < 100) break;
    }
    if (gatePassed(jobs)) return { verified: true, runId: run.id, runUrl: run.html_url };
  }
  return { verified: false, reason: `merge-queue run found, but ${REQUIRED_JOB} did not pass in it` };
}

function githubRequest(token) {
  return async (path) => {
    const response = await fetch(`https://api.github.com${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`GitHub API ${response.status} for ${path}`);
    return response.json();
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i]?.startsWith('--')) args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let result;
  try {
    const token = process.env.GH_TOKEN;
    if (!token) throw new Error('GH_TOKEN is not set');
    result = await findQueueEvidence({ repo: args.repo, sha: args.sha, request: githubRequest(token) });
  } catch (error) {
    result = { verified: false, reason: error instanceof Error ? error.message : String(error) };
  }
  if (result.verified) {
    console.log(`Merge-queue run ${result.runId} verified this exact commit: ${result.runUrl}`);
    console.log('This run reuses that verification and goes straight to deployment.');
  } else {
    console.log(`No reusable merge-queue verification (${result.reason}); this run verifies the commit itself.`);
  }
  if (args.output) appendFileSync(args.output, `queue_verified=${result.verified}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
