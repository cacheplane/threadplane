import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCommitInput, createCommitOnBranch, parseStagedChanges } from './commit-staged-via-api.mjs';

test('splits staged name-status records into additions and deletions', () => {
  const output = 'M\0a/api-docs.json\0A\0b/api-docs.json\0D\0c/api-docs.json\0';
  assert.deepEqual(parseStagedChanges(output), {
    additions: ['a/api-docs.json', 'b/api-docs.json'],
    deletions: ['c/api-docs.json'],
  });
  assert.deepEqual(parseStagedChanges(''), { additions: [], deletions: [] });
});

test('refuses staged changes it cannot express as additions or deletions', () => {
  assert.throws(() => parseStagedChanges('U\0conflicted.json\0'), /Unsupported staged change U/);
});

test('builds a createCommitOnBranch input pinned to the checked-out head', () => {
  const input = buildCommitInput({
    repo: 'cacheplane/threadplane',
    branch: 'feature',
    headOid: 'abc123',
    message: 'chore(docs): regenerate api docs',
    additions: [{ path: 'docs/api-docs.json', contents: Buffer.from('{"a":1}\n') }],
    deletions: ['old/api-docs.json'],
  });
  assert.deepEqual(input, {
    branch: { repositoryNameWithOwner: 'cacheplane/threadplane', branchName: 'feature' },
    message: { headline: 'chore(docs): regenerate api docs' },
    expectedHeadOid: 'abc123',
    fileChanges: {
      additions: [{ path: 'docs/api-docs.json', contents: Buffer.from('{"a":1}\n').toString('base64') }],
      deletions: [{ path: 'old/api-docs.json' }],
    },
  });
});

test('posts the mutation and returns the new commit oid', async () => {
  let request;
  const fetchImpl = async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({ data: { createCommitOnBranch: { commit: { oid: 'def456' } } } }));
  };
  const oid = await createCommitOnBranch({ token: 't0k', input: { expectedHeadOid: 'abc123' }, fetchImpl });
  assert.equal(oid, 'def456');
  assert.equal(request.url, 'https://api.github.com/graphql');
  assert.equal(request.init.headers.authorization, 'bearer t0k');
  const body = JSON.parse(request.init.body);
  assert.match(body.query, /createCommitOnBranch\(input: \$input\)/);
  assert.deepEqual(body.variables, { input: { expectedHeadOid: 'abc123' } });
});

test('fails loudly when GitHub rejects the commit, e.g. a moved head', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    data: { createCommitOnBranch: null },
    errors: [{ message: 'Expected branch to point to "abc123" but it did not.' }],
  }));
  await assert.rejects(
    createCommitOnBranch({ token: 't', input: {}, fetchImpl }),
    /createCommitOnBranch failed \(200\).*Expected branch to point/,
  );
  const unauthorized = async () => new Response('{"message":"Bad credentials"}', { status: 401 });
  await assert.rejects(createCommitOnBranch({ token: 't', input: {}, fetchImpl: unauthorized }), /\(401\)/);
});
