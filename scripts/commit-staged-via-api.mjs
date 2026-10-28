// Commits the staged changes to a branch through GitHub's createCommitOnBranch
// mutation instead of `git push`. GitHub signs API-created commits, so they
// satisfy main's required_signatures rule; a bot `git commit` lands unsigned
// and blocks the PR from merging even with every check green.
//
// Usage: node scripts/commit-staged-via-api.mjs --repo owner/name --branch <branch> --message <headline>
// Reads GITHUB_TOKEN, commits on top of the local HEAD, and prints the new oid.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const mutation = `mutation($input: CreateCommitOnBranchInput!) {
  createCommitOnBranch(input: $input) { commit { oid } }
}`;

function git(args, encoding = 'utf8') {
  const result = spawnSync('git', args, { encoding, maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

// `git diff --cached --name-status -z` output → additions and deletions. Renames
// and copies are disabled by the caller, so every record is a status + one path.
export function parseStagedChanges(nameStatus) {
  const fields = nameStatus.split('\0').filter(Boolean);
  const additions = [];
  const deletions = [];
  for (let index = 0; index < fields.length; index += 2) {
    const [status, path] = [fields[index], fields[index + 1]];
    if (status === 'D') deletions.push(path);
    else if (status === 'A' || status === 'M' || status === 'T') additions.push(path);
    else throw new Error(`Unsupported staged change ${status} for ${path}`);
  }
  return { additions, deletions };
}

export function buildCommitInput({ repo, branch, headOid, message, additions, deletions }) {
  return {
    branch: { repositoryNameWithOwner: repo, branchName: branch },
    message: { headline: message },
    // A push that raced in after checkout makes the mutation fail rather than
    // silently overwrite it, the same guarantee a non-fast-forward push gives.
    expectedHeadOid: headOid,
    fileChanges: {
      additions: additions.map(({ path, contents }) => ({ path, contents: Buffer.from(contents).toString('base64') })),
      deletions: deletions.map((path) => ({ path })),
    },
  };
}

export async function createCommitOnBranch({ token, input, fetchImpl = fetch, apiUrl = 'https://api.github.com/graphql' }) {
  const response = await fetchImpl(apiUrl, {
    method: 'POST',
    headers: { authorization: `bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: mutation, variables: { input } }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.errors?.length || !body.data?.createCommitOnBranch?.commit?.oid) {
    throw new Error(`createCommitOnBranch failed (${response.status}): ${JSON.stringify(body.errors ?? body)}`);
  }
  return body.data.createCommitOnBranch.commit.oid;
}

async function main() {
  const { values } = parseArgs({
    options: { repo: { type: 'string' }, branch: { type: 'string' }, message: { type: 'string' } },
  });
  const token = process.env.GITHUB_TOKEN;
  if (!values.repo || !values.branch || !values.message || !token) {
    throw new Error('--repo, --branch, --message and GITHUB_TOKEN are required');
  }
  const staged = parseStagedChanges(git(['diff', '--cached', '--no-renames', '--name-status', '-z']));
  if (staged.additions.length === 0 && staged.deletions.length === 0) throw new Error('Nothing is staged');
  const input = buildCommitInput({
    repo: values.repo,
    branch: values.branch,
    headOid: git(['rev-parse', 'HEAD']).trim(),
    message: values.message,
    // Read the staged blob, not the working tree, so only what was added is committed.
    additions: staged.additions.map((path) => ({ path, contents: git(['show', `:${path}`], 'buffer') })),
    deletions: staged.deletions,
  });
  console.log(await createCommitOnBranch({ token, input }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
