import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectApproval } from './approval.js';

const id = '0123456789abcdef0123456789abcdef';
const reason = '  <script>alert("approve")</script>\nReview & decide.  ';
const supported = {
  id,
  value: { type: 'approval_request', reason, extra: ['opaque'] },
};

test('approval projection preserves the literal canonical reason and owns its immutable result', () => {
  const projected = projectApproval([supported]);
  assert.deepEqual(projected, { id, reason });
  assert.ok(Object.isFrozen(projected));
  assert.notStrictEqual(projected, supported.value);
});

for (const [name, interrupts] of Object.entries({
  absent: [],
  multiple: [supported, supported],
  'supported plus unknown': [
    supported,
    { id: 'f'.repeat(32), value: 'unknown' },
  ],
  anonymous: [{ value: supported.value }],
  uppercase: [{ ...supported, id: id.toUpperCase() }],
  nonhex: [{ ...supported, id: 'pause-1' }],
  'wrong length': [{ ...supported, id: 'f'.repeat(31) }],
  'nonstring ID': [{ ...supported, id: 12 }],
  static: [{}],
  unknown: [{ id, value: { type: 'unknown', reason } }],
  refund: [{ id, value: { kind: 'refund_approval', reason } }],
  array: [{ id, value: ['approval_request', reason] }],
  null: [{ id, value: null }],
  string: [{ id, value: 'approval_request' }],
  'missing reason': [{ id, value: { type: 'approval_request' } }],
  'empty reason': [{ id, value: { type: 'approval_request', reason: '' } }],
  'nonstring reason': [{ id, value: { type: 'approval_request', reason: 1 } }],
})) {
  test(`approval projection leaves ${name} unsupported`, () => {
    assert.equal(projectApproval(interrupts), null);
  });
}
