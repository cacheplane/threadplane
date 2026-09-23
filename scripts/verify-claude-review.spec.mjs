import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const script = new URL('./verify-claude-review.mjs', import.meta.url);
const success = { type: 'result', subtype: 'success', is_error: false };

function verify(content) {
  const directory = mkdtempSync(join(tmpdir(), 'claude-review-test-'));
  try {
    const executionFile = join(directory, 'execution.json');
    if (content !== undefined) writeFileSync(executionFile, content);
    return spawnSync(process.execPath, [script.pathname], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_EXECUTION_FILE: executionFile },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('accepts a successful terminal execution result', () => {
  const result = verify(JSON.stringify([{ type: 'system' }, success]));
  assert.equal(result.status, 0, result.stderr);
});

for (const [name, content] of [
  [
    'observed false success',
    JSON.stringify([{ ...success, is_error: true, num_turns: 1 }]),
  ],
  ['turn limit', JSON.stringify([{ ...success, subtype: 'error_max_turns' }])],
  [
    'missing error flag',
    JSON.stringify([{ type: 'result', subtype: 'success' }]),
  ],
  ['no result', JSON.stringify([{ type: 'system' }])],
  ['nonterminal result', JSON.stringify([success, { type: 'assistant' }])],
  ['empty transcript', '[]'],
  ['wrong shape', JSON.stringify(success)],
  ['null result', '[null]'],
  ['malformed JSON', '{private-transcript-do-not-print'],
  ['missing file', undefined],
]) {
  test(`rejects ${name} without exposing transcript contents`, () => {
    const result = verify(content);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /Claude review execution could not be verified|Claude review execution failed/
    );
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /private-transcript-do-not-print/
    );
  });
}

test('an errored execution states its reason, so the failure is diagnosable', () => {
  // Claude Code exits on an API error with is_error: true and puts the error in
  // the terminal result's `result` field. Without it, every failure reads the
  // same and nobody can tell a revoked key from an empty balance.
  const reason =
    'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}';
  const result = verify(JSON.stringify([{ ...success, is_error: true, result: reason }]));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Claude review execution failed/);
  assert.match(result.stderr, /Reason: API Error: 400 .*credit balance is too low/);
});

test('the reason is one bounded line with anything key-shaped redacted', () => {
  const secret = 'sk-ant-api03-SECRETSECRETSECRET_1234567890';
  const long = `Invalid API key ${secret}\n${'x'.repeat(2000)}`;
  const result = verify(JSON.stringify([{ ...success, is_error: true, result: long }]));
  assert.equal(result.status, 1);
  const line = result.stderr.split('\n').find((l) => l.startsWith('Reason: '));
  assert.ok(line, result.stderr);
  assert.ok(line.length <= 'Reason: '.length + 300, `reason is ${line.length} chars`);
  assert.doesNotMatch(result.stdout + result.stderr, /SECRETSECRETSECRET/);
  assert.match(line, /sk-ant-\[redacted\]/);
});

test('a result that is not an error never prints its text', () => {
  // A finished review's `result` is the review itself: transcript-grade
  // content. Only an execution that reports is_error: true gets a reason line.
  for (const content of [
    JSON.stringify([{ ...success, subtype: 'error_max_turns', result: 'private-transcript-do-not-print' }]),
    JSON.stringify([{ type: 'result', subtype: 'success', result: 'private-transcript-do-not-print' }]),
  ]) {
    const result = verify(content);
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout + result.stderr, /private-transcript-do-not-print/);
    assert.doesNotMatch(result.stderr, /Reason:/);
  }
});

test('rejects a missing action output', () => {
  const result = spawnSync(process.execPath, [script.pathname], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_EXECUTION_FILE: '' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Claude review execution could not be verified/);
});

test('the advisory workflow checks execution and does not swallow failures', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/claude-review.yml', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
  assert.match(workflow, /id: claude-review/);
  assert.match(
    workflow,
    /CLAUDE_EXECUTION_FILE:.*steps\['claude-review'\]\.outputs\.execution_file/
  );
  assert.match(workflow, /run: node scripts\/verify-claude-review\.mjs/);
  assert.match(workflow, /if:.*!cancelled\(\)/);
  assert.match(
    workflow,
    /if: github\.event\.pull_request\.head\.repo\.full_name == github\.repository/
  );
  const ci = readFileSync(
    new URL('../.github/workflows/ci.yml', import.meta.url),
    'utf8'
  );
  assert.match(ci, /run: node --test scripts\/ci-workflow\.spec\.mjs/);
  const suite = readFileSync(
    new URL('./ci-workflow.spec.mjs', import.meta.url),
    'utf8'
  );
  assert.match(suite, /import '\.\/verify-claude-review\.spec\.mjs'/);
});
