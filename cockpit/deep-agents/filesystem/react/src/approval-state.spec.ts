import { describe, expect, it } from 'vitest';
import { approvalState, createDecision } from './approval-state';

export const action = (
  name = 'write_file',
  args: any = { file_path: '/report', content: 'new' }
) => ({ name, args, description: 'Review this mutation' });
export const interrupt = (
  actions = [action()],
  allowed = ['approve', 'edit', 'reject', 'respond']
) => ({
  id: 'pause-id',
  value: {
    action_requests: actions,
    review_configs: actions.map((a) => ({
      action_name: a.name,
      allowed_decisions: allowed,
    })),
  },
});
describe('whole current approval batch', () => {
  it('keeps every action ordered including duplicate targets and exact decision count', () => {
    const batch = approvalState(
      interrupt([
        action(),
        action('edit_file', {
          file_path: '/report',
          old_string: 'new',
          new_string: 'edited',
          replace_all: true,
        }),
        action('delete', { file_path: '/report' }),
      ])
    );
    expect(batch.kind).toBe('valid');
    if (batch.kind !== 'valid') throw new Error('Expected valid batch');
    expect(batch.actions.map((a: any) => a.name)).toEqual([
      'write_file',
      'edit_file',
      'delete',
    ]);
    expect(createDecision(batch, batch.signature, 'approve')).toEqual({
      decisions: [
        { type: 'approve' },
        { type: 'approve' },
        { type: 'approve' },
      ],
    });
    expect(createDecision(batch, batch.signature, 'reject')).toEqual({
      decisions: [{ type: 'reject' }, { type: 'reject' }, { type: 'reject' }],
    });
    expect(Object.isFrozen(batch.actions[0].args)).toBe(true);
  });
  it('permits only intersection choices and rejects stale signatures and edit/respond', () => {
    const raw = interrupt([action(), action()]);
    raw.value.review_configs[1].allowed_decisions = ['reject'];
    const batch = approvalState(raw);
    if (batch.kind !== 'valid') throw new Error('Expected valid batch');
    expect(batch.choices).toEqual(['reject']);
    for (const choice of ['approve', 'edit', 'respond', 'confirm', 'cancel'])
      expect(createDecision(batch, batch.signature, choice)).toBeUndefined();
    expect(createDecision(batch, 'old', 'reject')).toBeUndefined();
  });
  it.each([
    action('unknown'),
    action('write_file', { file_path: '/report', content: 'x', append: true }),
    action('edit_file', {
      file_path: '/report',
      old_string: 'x',
      new_string: 'y',
      replace_all: 'true',
    }),
    action('delete', { file_path: '/report', content: 'x' }),
    action('delete', { file_path: '../report' }),
    action('write_file', { file_path: '/report', content: 'x'.repeat(65537) }),
  ])('disables the entire batch for an unsupported action', (bad) => {
    const batch = approvalState(interrupt([action(), bad]));
    expect(batch.kind).toBe('unavailable');
    if (batch.kind !== 'unavailable')
      throw new Error('Expected unavailable batch');
    expect(batch.reason).toEqual(expect.any(String));
    expect(createDecision(batch, 'unavailable', 'approve')).toBeUndefined();
  });
  it('fails closed on hidden keys, mismatched configs, oversized metadata and aggregate text', () => {
    const extra: any = interrupt();
    extra.value.action_requests[0].hidden = 'mutation';
    const mismatch = interrupt();
    mismatch.value.review_configs[0].action_name = 'delete';
    const desc = interrupt();
    desc.value.action_requests[0].description = 'x'.repeat(1048577);
    const aggregate = interrupt(
      Array.from({ length: 9 }, () =>
        action('edit_file', {
          file_path: '/r',
          old_string: 'x'.repeat(65536),
          new_string: 'y'.repeat(65536),
        })
      )
    );
    for (const raw of [
      extra,
      mismatch,
      desc,
      aggregate,
      interrupt(Array.from({ length: 21 }, () => action())),
    ])
      expect(approvalState(raw).kind).toBe('unavailable');
  });
  it('does not invoke accessors or silently omit symbol keys', () => {
    let hits = 0;
    const raw: any = interrupt();
    Object.defineProperty(raw.value.action_requests[0].args, 'secret', {
      enumerable: true,
      get() {
        hits++;
        return true;
      },
    });
    expect(approvalState(raw).kind).toBe('unavailable');
    const symbol: any = interrupt();
    symbol.value.action_requests[0].args[Symbol('secret')] = true;
    expect(approvalState(symbol).kind).toBe('unavailable');
    expect(hits).toBe(0);
  });
  it('supports recursive root delete and real full-argument descriptions within explicit metadata bounds', () => {
    const raw = interrupt([
      action('delete', { file_path: '/' }),
      action('write_file', {
        file_path: '/reports/max',
        content: 'x'.repeat(65536),
      }),
    ]);
    raw.value.action_requests[1].description =
      'Tool write_file Args: ' + 'x'.repeat(65536);
    expect(approvalState(raw).kind).toBe('valid');
  });
  it('keeps bounded unsupported raw arguments visible without rewriting paths or unknown keys', () => {
    const raw = interrupt([
      action('write_file', {
        file_path: 'reports/./raw',
        content: 'x',
        hidden_mutation: true,
      }),
    ]);
    const projected = approvalState(raw);
    expect(projected.kind).toBe('unavailable');
    expect((projected as any).rawProposal).toEqual(raw);
  });
  it('does not emit decisions for forged choices, changed captured actions or getters', () => {
    const batch = approvalState(interrupt());
    if (batch.kind !== 'valid') throw new Error('Expected valid batch');
    expect(
      createDecision(
        { ...batch, choices: ['edit'] } as any,
        batch.signature,
        'edit'
      )
    ).toBeUndefined();
    expect(
      createDecision({ ...batch, actions: [] }, batch.signature, 'approve')
    ).toBeUndefined();
    let hits = 0;
    const malicious = {
      ...batch,
      get signature() {
        hits++;
        return batch.signature;
      },
    };
    expect(
      createDecision(malicious, batch.signature, 'approve')
    ).toBeUndefined();
    expect(hits).toBe(0);
  });
});
