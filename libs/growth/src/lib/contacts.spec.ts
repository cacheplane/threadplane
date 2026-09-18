import type {
  SqlExecutor,
  SqlQueryResult,
  SqlTransaction,
} from './database.ts';
// The observation transaction is exercised against Neon in observability-redaction.integration.spec.ts.
vi.mock('./observability/redaction.ts', () => ({
  redactContactObservationEvidence: vi.fn(async () => undefined),
}));
vi.mock('./observability/store.ts', () => ({
  privacyLock: vi.fn(async () => undefined),
}));
import {
  approveContactFromForm,
  approveContactFromInstallRuntimeInTransaction,
  normalizeInstallRuntimeEmail,
  CONTACT_HARD_STOP_REASONS,
  deleteContact,
  reauthorizeContact,
  type ApproveContactFromFormInput,
} from './contacts.ts';
import { createEmailLookupHmac, type EmailHmacKeyring } from './crypto.ts';
import {
  recomputeContactScore,
  type GrowthScoreContentRegistry,
} from './scoring.ts';

type TestRow = Record<string, unknown>;

function executorWith(
  handlers: Record<
    string,
    (parameters: readonly unknown[]) => SqlQueryResult<TestRow>
  >
): {
  calls: { marker: string; parameters: readonly unknown[]; sql: string }[];
  executor: SqlExecutor;
  transactions: { count: number };
} {
  const calls: {
    marker: string;
    parameters: readonly unknown[];
    sql: string;
  }[] = [];
  const transactions = { count: 0 };
  const transaction: SqlTransaction = {
    async execute<ResultRow extends Record<string, unknown>>(
      sql: string,
      parameters: readonly unknown[] = []
    ): Promise<SqlQueryResult<ResultRow>> {
      const marker = /\/\* growth:([a-z-]+) \*\//u.exec(sql)?.[1];
      const handler = marker ? handlers[marker] : undefined;
      const defaultResult =
        marker === 'read-key-versions' || marker === 'read-event-key'
          ? { rows: [] }
          : marker === 'insert-form-outreach-approved'
          ? { rows: [{ event_key: 'form:outreach-approved:test' }] }
          : undefined;
      if (!marker || (!handler && !defaultResult)) {
        throw new Error(`Unexpected SQL marker: ${marker ?? 'missing'}`);
      }
      calls.push({ marker, parameters, sql });
      return (handler?.(parameters) ??
        defaultResult) as SqlQueryResult<ResultRow>;
    },
  };

  return {
    calls,
    transactions,
    executor: {
      execute: transaction.execute,
      async transaction(operation) {
        transactions.count += 1;
        return operation(transaction);
      },
    },
  };
}

const keyring: EmailHmacKeyring = {
  active: { version: 2, secret: 'active-contact-hmac-secret-32-bytes' },
  previous: [{ version: 1, secret: 'previous-contact-hmac-secret-32-bytes' }],
};

const occurredAt = new Date('2026-09-01T12:00:00.000Z');
const baseApproval: ApproveContactFromFormInput = {
  email: ' Person@Example.COM ',
  displayName: '  Person Name ',
  companyName: ' Example Company ',
  companyDomain: ' Example.COM ',
  source: 'website',
  sourceForm: 'whitepaper',
  noticeText:
    'Send me the guide and a short, three-email follow-up from Brian about building with Threadplane. Unsubscribe anytime.',
  noticeVersion: 'whitepaper-v1',
  policyVersion: 'growth-v1',
  eventKey: 'form:whitepaper:submission-1',
  occurredAt,
  keyring,
  serverEmailClassification: 'work',
};

const formActivityRequestData = {
  company_domain: 'example.com',
  company_name: 'Example Company',
  display_name: 'Person Name',
  email_classification: 'work',
  notice_text: baseApproval.noticeText,
  notice_version: 'whitepaper-v1',
  policy_version: 'growth-v1',
  provenance: 'form_submission',
  source: 'website',
  source_form: 'whitepaper',
};
const formActivityData = {
  approval_granted: true,
  ...formActivityRequestData,
};

function contactRow(overrides: TestRow = {}): TestRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    email_hmac_key_version: 2,
    email_lookup_hmac: createEmailLookupHmac(
      'person@example.com',
      keyring.active
    ).digest,
    outreach_approved_at: null,
    deleted_at: null,
    updated_at: occurredAt,
    ...overrides,
  };
}

describe('install/runtime contact approval', () => {
  const input = {
    email: ' Person@Example.COM ',
    keyring,
    now: occurredAt,
    installObservationId: '11111111-1111-4111-8111-111111111111',
    runtimeObservationId: '22222222-2222-4222-8222-222222222222',
  };
  const id = String(contactRow().id);

  it.each([
    '',
    'bad',
    'person@localhost',
    'a..b@example.com',
    'person@-example.com',
    'no-reply@example.com',
    'noreply+tag@example.com',
    'do_not_reply@example.com',
    '123+person@users.noreply.github.com',
    'dependabot@example.com',
    'renovate[bot]@example.com',
    'github-actions@example.com',
    'bot+build@example.com',
  ])(
    'excludes unusable or automated email %s before database access',
    async (email) => {
      expect(normalizeInstallRuntimeEmail(email)).toBeNull();
      const harness = executorWith({});
      expect(
        await approveContactFromInstallRuntimeInTransaction(harness.executor, {
          ...input,
          email,
        })
      ).toBeNull();
      expect(harness.calls).toEqual([]);
    }
  );

  it('normalizes a personal address without inferring company membership', () => {
    expect(normalizeInstallRuntimeEmail(' Person+Threadplane@Gmail.COM ')).toBe(
      'person+threadplane@gmail.com'
    );
  });

  it('creates a contact and approves it with only linked-install provenance', async () => {
    const harness = executorWith({
      'lock-email': () => ({ rows: [] }),
      'find-install-runtime-contact': () => ({ rows: [] }),
      'insert-install-runtime-contact': () => ({ rows: [contactRow()] }),
      'find-hard-stops': () => ({ rows: [] }),
      'insert-activity': () => ({ rows: [{ event_key: 'inserted' }] }),
      'set-install-runtime-approval': () => ({ rows: [{ id }] }),
    });
    expect(
      await approveContactFromInstallRuntimeInTransaction(
        harness.executor,
        input
      )
    ).toBe(id);
    expect(harness.transactions.count).toBe(0);
    const creation = harness.calls.find(
      (call) => call.marker === 'insert-install-runtime-contact'
    );
    expect(creation?.parameters).toEqual([
      'person@example.com',
      createEmailLookupHmac(input.email, keyring.active).digest,
      2,
      'install_runtime',
    ]);
    const activity = harness.calls.find(
      (call) => call.marker === 'insert-activity'
    );
    expect(activity?.parameters).toEqual([
      `install_runtime.outreach_approved:${id}`,
      id,
      occurredAt,
      'install_runtime.outreach_approved',
      JSON.stringify({
        provenance: 'linked_install_runtime',
        install_observation_id: input.installObservationId,
        runtime_observation_id: input.runtimeObservationId,
      }),
      null,
    ]);
    expect(
      harness.calls.find(
        (call) => call.marker === 'set-install-runtime-approval'
      )?.sql
    ).toContain('outreach_approved_at is null');
    expect(harness.calls.some((call) => call.marker.includes('form'))).toBe(
      false
    );
  });

  it('approves an existing unapproved contact without overwriting contact facts', async () => {
    const harness = executorWith({
      'lock-email': () => ({ rows: [] }),
      'find-install-runtime-contact': () => ({ rows: [contactRow()] }),
      'find-hard-stops': () => ({ rows: [] }),
      'insert-activity': () => ({ rows: [{ event_key: 'inserted' }] }),
      'set-install-runtime-approval': () => ({ rows: [{ id }] }),
    });
    expect(
      await approveContactFromInstallRuntimeInTransaction(
        harness.executor,
        input
      )
    ).toBe(id);
    expect(
      harness.calls.filter((call) =>
        /insert.*contact|update-contact-facts/.test(call.marker)
      )
    ).toEqual([]);
  });

  it('returns an existing approval without another event or timestamp change', async () => {
    const harness = executorWith({
      'lock-email': () => ({ rows: [] }),
      'find-install-runtime-contact': () => ({
        rows: [contactRow({ outreach_approved_at: occurredAt })],
      }),
      'find-hard-stops': () => ({ rows: [] }),
    });
    expect(
      await approveContactFromInstallRuntimeInTransaction(
        harness.executor,
        input
      )
    ).toBe(id);
    expect(
      harness.calls.some(
        (call) =>
          call.marker === 'insert-activity' ||
          call.marker === 'set-install-runtime-approval'
      )
    ).toBe(false);
  });

  it.each(CONTACT_HARD_STOP_REASONS)(
    'never reauthorizes a contact stopped for %s',
    async (reason) => {
      const harness = executorWith({
        'lock-email': () => ({ rows: [] }),
        'find-install-runtime-contact': () => ({
          rows: [
            contactRow({
              outreach_approved_at: new Date('2026-08-01T00:00:00Z'),
            }),
          ],
        }),
        'find-hard-stops': () => ({
          rows: [{ kind: reason, occurred_at: occurredAt }],
        }),
      });
      expect(
        await approveContactFromInstallRuntimeInTransaction(
          harness.executor,
          input
        )
      ).toBeNull();
      expect(
        harness.calls.some(
          (call) =>
            call.marker === 'insert-activity' ||
            call.marker === 'set-install-runtime-approval'
        )
      ).toBe(false);
    }
  );

  it('keeps a deleted contact ineligible when its email survives only as a HMAC', async () => {
    const harness = executorWith({
      'lock-email': () => ({ rows: [] }),
      'find-install-runtime-contact': () => ({
        rows: [contactRow({ deleted_at: occurredAt })],
      }),
      'find-hard-stops': () => ({ rows: [] }),
    });
    expect(
      await approveContactFromInstallRuntimeInTransaction(
        harness.executor,
        input
      )
    ).toBeNull();
    expect(
      harness.calls.find(
        (call) => call.marker === 'find-install-runtime-contact'
      )?.sql
    ).toContain('contact.lookup_alias_added');
  });

  it('fails closed if the keyring cannot look up an older deleted contact', async () => {
    const harness = executorWith({
      'lock-email': () => ({ rows: [] }),
      'read-key-versions': () => ({ rows: [{ email_hmac_key_version: 3 }] }),
    });
    await expect(
      approveContactFromInstallRuntimeInTransaction(harness.executor, input)
    ).rejects.toThrow(/coverage/);
  });

  it('rejects ambiguous matches instead of approving an arbitrary contact', async () => {
    const harness = executorWith({
      'lock-email': () => ({ rows: [] }),
      'find-install-runtime-contact': () => ({
        rows: [contactRow(), contactRow({ id: 'other' })],
      }),
    });
    await expect(
      approveContactFromInstallRuntimeInTransaction(harness.executor, input)
    ).rejects.toThrow(/multiple/);
  });
});

describe('approveContactFromForm', () => {
  it('records blocked facts without changing a legitimate existing contact or consent', async () => {
    const approved = contactRow({ outreach_approved_at: occurredAt });
    const harness = executorWith({
      'lock-email': () => ({ rows: [] }),
      'find-contact': () => ({ rows: [approved] }),
      'find-hard-stops': () => ({ rows: [] }),
      'insert-activity': (parameters) => {
        expect(JSON.parse(String(parameters[4]))).toMatchObject({
          approval_granted: false,
          form_abuse_blocked: true,
        });
        return { rows: [{ event_key: baseApproval.eventKey }] };
      },
      'read-control-state': () => ({
        rows: [
          {
            ...approved,
            latest_hard_stop_kind: null,
            latest_hard_stop_at: null,
          },
        ],
      }),
    });
    const result = await approveContactFromForm(harness.executor, {
      ...baseApproval,
      serverFormBlocked: true,
    });
    expect(result.formApprovalGranted).toBe(false);
    expect(result.canSend).toBe(true);
    expect(
      harness.calls.some((c) =>
        [
          'update-contact-facts',
          'set-form-approval',
          'insert-form-outreach-approved',
        ].includes(c.marker)
      )
    ).toBe(false);
  });

  it('normalizes direct facts, preserves a private lookup, and records exact approval provenance', async () => {
    const harness = executorWith({
      'lock-email': () => ({ rows: [{}] }),
      'find-contact': () => ({ rows: [] }),
      'insert-contact': () => ({ rows: [contactRow()] }),
      'find-hard-stops': () => ({ rows: [] }),
      'insert-activity': (parameters) => {
        const data = JSON.parse(String(parameters[4]));
        expect(data).toEqual(formActivityData);
        return { rows: [{ event_key: baseApproval.eventKey }] };
      },
      'set-form-approval': () => ({
        rows: [contactRow({ outreach_approved_at: occurredAt })],
      }),
      'read-control-state': () => ({
        rows: [
          contactRow({
            outreach_approved_at: occurredAt,
            latest_hard_stop_kind: null,
            latest_hard_stop_at: null,
          }),
        ],
      }),
    });

    const result = await approveContactFromForm(harness.executor, baseApproval);

    expect(result.authorization).toBe('approved');
    expect(result.canSend).toBe(true);
    expect(result.formApprovalGranted).toBe(true);
    expect(harness.transactions.count).toBe(1);
    const insert = harness.calls.find(
      ({ marker }) => marker === 'insert-contact'
    );
    expect(insert?.parameters).toEqual(
      expect.arrayContaining([
        'person@example.com',
        2,
        'Person Name',
        'Example Company',
        'example.com',
      ])
    );
    expect(insert?.parameters).not.toContain(' Person@Example.COM ');
    const approvalActivity = harness.calls.find(
      ({ marker }) => marker === 'insert-form-outreach-approved'
    );
    const approvalData = JSON.parse(
      String(approvalActivity?.parameters.at(-1))
    );
    expect(approvalData).toEqual({
      email_classification: 'work',
      policy_version: 'growth-v1',
      source: 'website',
      source_form: 'whitepaper',
      verification: 'server_verified',
    });

    const emptyRegistry: GrowthScoreContentRegistry = {
      version: 'content-registry:v1',
      entries: [],
    };
    const scoringExecutor: SqlExecutor = {
      async execute<Row extends Record<string, unknown>>() {
        return {
          rows: [
            {
              event_key: String(approvalActivity?.parameters[0]),
              contact_id: String(contactRow().id),
              project_id: null,
              kind: 'form.outreach_approved',
              occurred_at: occurredAt,
              data: approvalData,
            },
          ] as unknown as Row[],
        };
      },
      async transaction(operation) {
        return operation(this);
      },
    };
    expect(
      (
        await recomputeContactScore(scoringExecutor, {
          contactId: String(contactRow().id),
          contentRegistry: emptyRegistry,
        })
      ).score
    ).toBe(30);
  });

  it('defaults omitted server email classification to unknown', async () => {
    const harness = executorWith({
      'lock-email': () => ({ rows: [{}] }),
      'find-contact': () => ({ rows: [] }),
      'insert-contact': () => ({ rows: [contactRow()] }),
      'find-hard-stops': () => ({ rows: [] }),
      'insert-activity': () => ({
        rows: [{ event_key: baseApproval.eventKey }],
      }),
      'set-form-approval': () => ({
        rows: [contactRow({ outreach_approved_at: occurredAt })],
      }),
      'read-control-state': () => ({
        rows: [
          contactRow({
            outreach_approved_at: occurredAt,
            latest_hard_stop_kind: null,
            latest_hard_stop_at: null,
          }),
        ],
      }),
    });

    await approveContactFromForm(harness.executor, {
      ...baseApproval,
      serverEmailClassification: undefined,
      verification: 'user_supplied',
    } as ApproveContactFromFormInput & { verification: string });

    const approvalActivity = harness.calls.find(
      ({ marker }) => marker === 'insert-form-outreach-approved'
    );
    expect(
      JSON.parse(String(approvalActivity?.parameters.at(-1)))
    ).toMatchObject({
      email_classification: 'unknown',
      verification: 'server_verified',
    });
  });

  it.each([
    'unsubscribe',
    'complaint',
    'hard_bounce',
    'provider_suppression',
    'invalid_address',
    'manual_suppression',
    'campaign.reply_received',
    'deletion',
  ] as const)('does not reauthorize after %s', async (reason) => {
    const stoppedAt = new Date('2026-08-31T12:00:00.000Z');
    const harness = executorWith({
      'lock-email': () => ({ rows: [{}] }),
      'find-contact': () => ({ rows: [contactRow()] }),
      'update-contact-facts': () => ({ rows: [contactRow()] }),
      'find-hard-stops': () => ({
        rows: [{ kind: reason, occurred_at: stoppedAt }],
      }),
      'insert-activity': (parameters) => {
        expect(JSON.parse(String(parameters[4]))).toMatchObject({
          approval_granted: false,
          blocked_by: reason,
        });
        return { rows: [{ event_key: baseApproval.eventKey }] };
      },
      'read-control-state': () => ({
        rows: [
          contactRow({
            latest_hard_stop_kind: reason,
            latest_hard_stop_at: stoppedAt,
          }),
        ],
      }),
    });

    const result = await approveContactFromForm(harness.executor, baseApproval);

    expect(result.authorization).toBe(
      reason === 'deletion' ? 'deleted' : 'stopped'
    );
    expect(result.canSend).toBe(false);
    expect(CONTACT_HARD_STOP_REASONS).toContain(reason);
    expect(
      harness.calls.some(({ marker }) => marker === 'set-form-approval')
    ).toBe(false);
    expect(
      harness.calls.some(({ marker }) => marker === 'update-contact-facts')
    ).toBe(false);
    if (reason === 'deletion') {
      expect(
        harness.calls.some(({ marker }) => marker === 'insert-activity')
      ).toBe(false);
    }
  });

  it('treats an explicit event-key replay at a later request time as inert', async () => {
    const harness = executorWith({
      'lock-email': () => ({ rows: [{}] }),
      'find-contact': () => ({ rows: [contactRow()] }),
      'update-contact-facts': () => ({ rows: [contactRow()] }),
      'find-hard-stops': () => ({ rows: [] }),
      'insert-activity': () => ({ rows: [] }),
      'read-event-key': () => ({
        rows: [
          {
            contact_id: contactRow().id,
            data: formActivityData,
            kind: 'contact.form_submission',
            occurred_at: '2026-09-01T05:00:00.000-07:00',
            project_id: null,
          },
        ],
      }),
      'read-control-state': () => ({
        rows: [
          contactRow({
            latest_hard_stop_kind: null,
            latest_hard_stop_at: null,
          }),
        ],
      }),
    });

    const result = await approveContactFromForm(harness.executor, {
      ...baseApproval,
      occurredAt: new Date('2026-09-01T12:05:00.000Z'),
    });

    expect(result.canSend).toBe(false);
    expect(result.formApprovalGranted).toBe(true);
    expect(
      harness.calls.some(({ marker }) => marker === 'set-form-approval')
    ).toBe(false);
    expect(
      harness.calls.some(({ marker }) => marker === 'update-contact-facts')
    ).toBe(false);
  });

  it('treats legacy form activity without classification as unknown on replay', async () => {
    const legacyData = { ...formActivityData };
    delete (legacyData as Partial<typeof formActivityData>)
      .email_classification;
    const harness = executorWith({
      'lock-email': () => ({ rows: [{}] }),
      'find-contact': () => ({ rows: [contactRow()] }),
      'insert-activity': () => ({ rows: [] }),
      'read-event-key': () => ({
        rows: [
          {
            contact_id: contactRow().id,
            data: legacyData,
            kind: 'contact.form_submission',
            occurred_at: occurredAt,
            project_id: null,
          },
        ],
      }),
      'read-control-state': () => ({
        rows: [
          contactRow({
            latest_hard_stop_kind: null,
            latest_hard_stop_at: null,
          }),
        ],
      }),
    });

    await expect(
      approveContactFromForm(harness.executor, {
        ...baseApproval,
        serverEmailClassification: undefined,
      })
    ).resolves.toMatchObject({ canSend: false });
  });

  it('keeps the original granted outcome when an approved form is replayed after a later stop', async () => {
    const stoppedAt = new Date('2026-09-02T12:00:00.000Z');
    const stoppedRow = contactRow({
      outreach_approved_at: occurredAt,
      latest_hard_stop_kind: 'unsubscribe',
      latest_hard_stop_at: stoppedAt,
    });
    const harness = executorWith({
      'lock-email': () => ({ rows: [{}] }),
      'find-contact': () => ({
        rows: [contactRow({ outreach_approved_at: occurredAt })],
      }),
      'find-hard-stops': () => ({
        rows: [{ kind: 'unsubscribe', occurred_at: stoppedAt }],
      }),
      'insert-activity': () => ({ rows: [] }),
      'read-event-key': () => ({
        rows: [
          {
            contact_id: contactRow().id,
            data: formActivityData,
            kind: 'contact.form_submission',
            occurred_at: occurredAt,
            project_id: null,
          },
        ],
      }),
      'read-control-state': () => ({ rows: [stoppedRow] }),
    });

    const result = await approveContactFromForm(harness.executor, {
      ...baseApproval,
      occurredAt: new Date('2026-09-03T12:00:00.000Z'),
    });

    expect(result).toMatchObject({
      authorization: 'stopped',
      canSend: false,
      formApprovalGranted: true,
    });
    expect(
      harness.calls.some(({ marker }) => marker === 'update-contact-facts')
    ).toBe(false);
    expect(
      harness.calls.some(({ marker }) => marker === 'set-form-approval')
    ).toBe(false);
  });

  it('keeps the original denied outcome when a stopped form is replayed after explicit reauthorization', async () => {
    const stoppedAt = new Date('2026-08-31T12:00:00.000Z');
    const reauthorizedAt = new Date('2026-09-02T12:00:00.000Z');
    const approvedRow = contactRow({
      outreach_approved_at: reauthorizedAt,
      latest_hard_stop_kind: 'campaign.reply_received',
      latest_hard_stop_at: stoppedAt,
    });
    const harness = executorWith({
      'lock-email': () => ({ rows: [{}] }),
      'find-contact': () => ({ rows: [approvedRow] }),
      'find-hard-stops': () => ({
        rows: [{ kind: 'campaign.reply_received', occurred_at: stoppedAt }],
      }),
      'insert-activity': () => ({ rows: [] }),
      'read-event-key': () => ({
        rows: [
          {
            contact_id: contactRow().id,
            data: {
              approval_granted: false,
              blocked_by: 'campaign.reply_received',
              ...formActivityRequestData,
            },
            kind: 'contact.form_submission',
            occurred_at: occurredAt,
            project_id: null,
          },
        ],
      }),
      'read-control-state': () => ({ rows: [approvedRow] }),
    });

    const result = await approveContactFromForm(harness.executor, {
      ...baseApproval,
      occurredAt: new Date('2026-09-03T12:00:00.000Z'),
    });

    expect(result).toMatchObject({
      authorization: 'approved',
      canSend: true,
      formApprovalGranted: false,
    });
    expect(
      harness.calls.some(({ marker }) => marker === 'update-contact-facts')
    ).toBe(false);
    expect(
      harness.calls.some(({ marker }) => marker === 'set-form-approval')
    ).toBe(false);
  });

  it('rejects an event-key collision when an immutable submitted fact differs', async () => {
    const harness = executorWith({
      'lock-email': () => ({ rows: [{}] }),
      'find-contact': () => ({ rows: [contactRow()] }),
      'find-hard-stops': () => ({ rows: [] }),
      'insert-activity': () => ({ rows: [] }),
      'read-event-key': () => ({
        rows: [
          {
            contact_id: contactRow().id,
            data: { ...formActivityData, display_name: 'Different Person' },
            kind: 'contact.form_submission',
            occurred_at: occurredAt,
            project_id: null,
          },
        ],
      }),
    });

    await expect(
      approveContactFromForm(harness.executor, baseApproval)
    ).rejects.toThrow(/event key conflict/i);
    expect(
      harness.calls.some(({ marker }) => marker === 'set-form-approval')
    ).toBe(false);
    expect(
      harness.calls.some(({ marker }) => marker === 'update-contact-facts')
    ).toBe(false);
  });

  it('rejects unbounded submitted facts before opening a transaction', async () => {
    const harness = executorWith({});

    await expect(
      approveContactFromForm(harness.executor, {
        ...baseApproval,
        displayName: 'x'.repeat(201),
      })
    ).rejects.toThrow(/displayName/i);
    expect(harness.transactions.count).toBe(0);
  });

  it('rejects an unrecognized server email classification before opening a transaction', async () => {
    const harness = executorWith({});

    await expect(
      approveContactFromForm(harness.executor, {
        ...baseApproval,
        serverEmailClassification: 'corporate',
      } as unknown as ApproveContactFromFormInput)
    ).rejects.toThrow(/serverEmailClassification/u);
    expect(harness.transactions.count).toBe(0);
  });

  it.each([
    {
      description: 'an untouched retired suppression version',
      keyring: {
        active: {
          version: 3,
          secret: 'version-3-contact-hmac-secret-32-bytes',
        },
        previous: [keyring.active],
      } satisfies EmailHmacKeyring,
      storedVersion: 1,
    },
    {
      description: 'an older writer after a newer rekey',
      keyring,
      storedVersion: 3,
    },
  ])('fails closed for $description', async ({ keyring, storedVersion }) => {
    const harness = executorWith({
      'lock-email': () => ({ rows: [{}] }),
      'read-key-versions': () => ({
        rows: [{ email_hmac_key_version: storedVersion }],
      }),
    });

    await expect(
      approveContactFromForm(harness.executor, {
        ...baseApproval,
        keyring,
      })
    ).rejects.toThrow(new RegExp(`rotation coverage.*${storedVersion}`, 'i'));
    expect(harness.calls.some(({ marker }) => marker === 'find-contact')).toBe(
      false
    );
    expect(
      harness.calls.some(({ marker }) => marker === 'insert-contact')
    ).toBe(false);
    expect(
      harness.calls.some(({ marker }) => marker === 'insert-activity')
    ).toBe(false);
  });

  it('covers an untouched old suppression key and rekeys it to the active version', async () => {
    const deletedAt = new Date('2026-08-31T12:00:00.000Z');
    const rotationKeyring: EmailHmacKeyring = {
      active: { version: 3, secret: 'version-3-contact-hmac-secret-32-bytes' },
      previous: [keyring.active, ...(keyring.previous ?? [])],
    };
    const oldKey = rotationKeyring.previous?.[1];
    if (!oldKey) throw new Error('Expected the v1 test key');
    const oldLookup = createEmailLookupHmac('person@example.com', oldKey);
    const harness = executorWith({
      'lock-email': () => ({ rows: [{}] }),
      'read-key-versions': () => ({
        rows: [{ email_hmac_key_version: 1 }],
      }),
      'find-contact': () => ({
        rows: [
          contactRow({
            deleted_at: deletedAt,
            email_hmac_key_version: 1,
            email_lookup_hmac: oldLookup.digest,
          }),
        ],
      }),
      'insert-activity': () => ({ rows: [{ event_key: 'alias:v1' }] }),
      'rekey-contact': (parameters) => ({
        rows: [
          contactRow({
            deleted_at: deletedAt,
            email_hmac_key_version: parameters[1],
            email_lookup_hmac: parameters[2],
          }),
        ],
      }),
      'find-hard-stops': () => ({
        rows: [{ kind: 'deletion', occurred_at: deletedAt }],
      }),
      'read-control-state': () => ({
        rows: [
          contactRow({
            deleted_at: deletedAt,
            latest_hard_stop_kind: 'deletion',
            latest_hard_stop_at: deletedAt,
          }),
        ],
      }),
    });

    const result = await approveContactFromForm(harness.executor, {
      ...baseApproval,
      keyring: rotationKeyring,
    });

    expect(result.authorization).toBe('deleted');
    const coverageQuery = harness.calls.find(
      ({ marker }) => marker === 'read-key-versions'
    );
    expect(coverageQuery?.sql).toMatch(
      /select distinct email_hmac_key_version[\s\S]*from growth_contacts/u
    );
    expect(coverageQuery?.sql).not.toMatch(/deleted_at/u);
    expect(
      harness.calls.find(({ marker }) => marker === 'rekey-contact')
        ?.parameters[1]
    ).toBe(3);
  });

  it('uses a rotation-stable lock and rekeys a deleted suppression row without restoring PII', async () => {
    const deletedAt = new Date('2026-08-31T12:00:00.000Z');
    const previousKey = keyring.previous?.[0];
    if (!previousKey) throw new Error('Expected the previous test key');
    const oldDigest = createEmailLookupHmac(
      'person@example.com',
      previousKey
    ).digest;
    const harness = executorWith({
      'lock-email': () => ({ rows: [{}] }),
      'read-key-versions': () => ({
        rows: [{ email_hmac_key_version: 1 }],
      }),
      'find-contact': () => ({
        rows: [
          contactRow({
            deleted_at: deletedAt,
            email_hmac_key_version: 1,
            email_lookup_hmac: oldDigest,
          }),
        ],
      }),
      'insert-activity': (parameters) => {
        expect(parameters[0]).toBe(
          `contact.lookup_alias_added:${String(contactRow().id)}:v1`
        );
        expect(parameters[3]).toBe('contact.lookup_alias_added');
        expect(JSON.parse(String(parameters[4]))).toEqual({
          digest: oldDigest,
          key_version: 1,
        });
        return { rows: [{ event_key: parameters[0] }] };
      },
      'rekey-contact': (parameters) => {
        expect(parameters[1]).toBe(2);
        expect(parameters[2]).toEqual(expect.any(String));
        return {
          rows: [
            contactRow({
              deleted_at: deletedAt,
              email_hmac_key_version: 2,
              email_lookup_hmac: parameters[2],
            }),
          ],
        };
      },
      'find-hard-stops': () => ({
        rows: [{ kind: 'deletion', occurred_at: deletedAt }],
      }),
      'read-control-state': () => ({
        rows: [
          contactRow({
            deleted_at: deletedAt,
            latest_hard_stop_kind: 'deletion',
            latest_hard_stop_at: deletedAt,
          }),
        ],
      }),
    });

    const result = await approveContactFromForm(harness.executor, {
      ...baseApproval,
      keyring,
    });

    expect(result.authorization).toBe('deleted');
    expect(
      harness.calls.find(({ marker }) => marker === 'lock-email')?.parameters
    ).toEqual(['person@example.com']);
    expect(
      harness.calls.find(({ marker }) => marker === 'find-contact')?.sql
    ).toMatch(/email_normalized\s*=\s*\$2/u);
    expect(
      harness.calls.find(({ marker }) => marker === 'find-contact')?.sql
    ).toMatch(/contact\.lookup_alias_added/u);
    expect(
      harness.calls.find(({ marker }) => marker === 'rekey-contact')?.sql
    ).toMatch(/email_hmac_key_version\s*<\s*\$2/u);
    expect(harness.calls.map(({ marker }) => marker)).toEqual([
      'lock-email',
      'read-key-versions',
      'find-contact',
      'read-event-key',
      'insert-activity',
      'rekey-contact',
      'find-hard-stops',
      'read-control-state',
    ]);
    expect(
      harness.calls.some(({ marker }) => marker === 'update-contact-facts')
    ).toBe(false);
  });

  it('does not let a retired writer use a private alias to bypass key coverage', async () => {
    const harness = executorWith({
      'lock-email': () => ({ rows: [{}] }),
      'read-key-versions': () => ({
        rows: [{ email_hmac_key_version: 3 }],
      }),
    });

    await expect(
      approveContactFromForm(harness.executor, {
        ...baseApproval,
        keyring,
      })
    ).rejects.toThrow(/rotation coverage.*3/i);
    expect(harness.calls.some(({ marker }) => marker === 'find-contact')).toBe(
      false
    );
    expect(
      harness.calls.some(({ marker }) => marker === 'insert-activity')
    ).toBe(false);
  });
});

describe('reauthorizeContact', () => {
  it('requires an explicit policy to permit every prior hard stop', async () => {
    const harness = executorWith({
      'lock-contact': () => ({ rows: [contactRow()] }),
      'find-hard-stops': () => ({
        rows: [
          {
            kind: 'provider_suppression',
            occurred_at: new Date('2026-08-31T12:00:00.000Z'),
          },
        ],
      }),
      'read-control-state': () => ({
        rows: [
          contactRow({
            latest_hard_stop_kind: 'provider_suppression',
            latest_hard_stop_at: new Date('2026-08-31T12:00:00.000Z'),
          }),
        ],
      }),
    });

    const result = await reauthorizeContact(harness.executor, {
      contactId: String(contactRow().id),
      eventKey: 'founder:reauthorize:1',
      occurredAt,
      actor: 'founder',
      reason: 'provider suppression remains unresolved',
      source: 'growth-control',
      policyVersion: 'growth-v1',
      allowedPriorStops: ['unsubscribe'],
    });

    expect(result.reauthorized).toBe(false);
    expect(result.blockedBy).toEqual(['provider_suppression']);
    expect(
      harness.calls.some(({ marker }) => marker === 'set-reauthorized')
    ).toBe(false);
  });

  it('does not override a reply stop unless reply is expressly allowed', async () => {
    const stoppedAt = new Date('2026-08-31T12:00:00.000Z');
    const harness = executorWith({
      'lock-contact': () => ({ rows: [contactRow()] }),
      'find-hard-stops': () => ({
        rows: [{ kind: 'campaign.reply_received', occurred_at: stoppedAt }],
      }),
      'read-control-state': () => ({
        rows: [
          contactRow({
            latest_hard_stop_kind: 'campaign.reply_received',
            latest_hard_stop_at: stoppedAt,
          }),
        ],
      }),
    });

    const result = await reauthorizeContact(harness.executor, {
      contactId: String(contactRow().id),
      eventKey: 'founder:reauthorize:reply-denied',
      occurredAt,
      actor: 'founder',
      reason: 'no renewed request',
      source: 'growth-control',
      policyVersion: 'growth-v1',
      allowedPriorStops: [],
    });

    expect(result.reauthorized).toBe(false);
    expect(result.blockedBy).toEqual(['campaign.reply_received']);
    expect(
      harness.calls.some(({ marker }) => marker === 'insert-activity')
    ).toBe(false);
  });

  it.each([
    ['equal', new Date('2026-09-01T12:00:00.000Z')],
    ['backdated', new Date('2026-09-01T11:59:59.999Z')],
  ] as const)(
    'rejects %s reauthorization chronology without recording provenance',
    async (_description, reauthorizationAt) => {
      const stoppedAt = new Date('2026-09-01T12:00:00.000Z');
      const stoppedRow = contactRow({
        latest_hard_stop_kind: 'campaign.reply_received',
        latest_hard_stop_at: stoppedAt,
      });
      const harness = executorWith({
        'lock-contact': () => ({ rows: [contactRow()] }),
        'find-hard-stops': () => ({
          rows: [{ kind: 'campaign.reply_received', occurred_at: stoppedAt }],
        }),
        'read-control-state': () => ({ rows: [stoppedRow] }),
      });

      const result = await reauthorizeContact(harness.executor, {
        contactId: String(contactRow().id),
        eventKey: `founder:reauthorize:${_description}`,
        occurredAt: reauthorizationAt,
        actor: 'founder',
        reason: 'verified renewed request',
        source: 'growth-control',
        policyVersion: 'growth-v1',
        allowedPriorStops: ['campaign.reply_received'],
      });

      expect(result).toMatchObject({
        reauthorized: false,
        blockedBy: ['campaign.reply_received'],
        state: { authorization: 'stopped', canSend: false },
      });
      expect(
        harness.calls.some(({ marker }) => marker === 'insert-activity')
      ).toBe(false);
      expect(
        harness.calls.some(({ marker }) => marker === 'set-reauthorized')
      ).toBe(false);
    }
  );

  it('records distinct founder provenance and restores approval when policy explicitly allows it', async () => {
    const stoppedAt = new Date('2026-08-31T12:00:00.000Z');
    const harness = executorWith({
      'lock-contact': () => ({ rows: [contactRow()] }),
      'find-hard-stops': () => ({
        rows: [{ kind: 'campaign.reply_received', occurred_at: stoppedAt }],
      }),
      'insert-activity': (parameters) => {
        expect(parameters[3]).toBe('contact.reauthorized');
        expect(JSON.parse(String(parameters[4]))).toEqual({
          actor: 'founder',
          policy_version: 'growth-v1',
          prior_stops: ['campaign.reply_received'],
          provenance: 'founder_action',
          reason: 'verified renewed request',
          source: 'growth-control',
        });
        return { rows: [{ event_key: 'founder:reauthorize:2' }] };
      },
      'set-reauthorized': () => ({
        rows: [contactRow({ outreach_approved_at: occurredAt })],
      }),
      'read-control-state': () => ({
        rows: [
          contactRow({
            outreach_approved_at: occurredAt,
            latest_hard_stop_kind: 'campaign.reply_received',
            latest_hard_stop_at: stoppedAt,
          }),
        ],
      }),
    });

    const result = await reauthorizeContact(harness.executor, {
      contactId: String(contactRow().id),
      eventKey: 'founder:reauthorize:2',
      occurredAt,
      actor: 'founder',
      reason: 'verified renewed request',
      source: 'growth-control',
      policyVersion: 'growth-v1',
      allowedPriorStops: ['campaign.reply_received'],
    });

    expect(result.reauthorized).toBe(true);
    expect(result.state.authorization).toBe('approved');
  });

  it('rejects a reauthorization event-key collision with changed provenance', async () => {
    const stoppedAt = new Date('2026-08-31T12:00:00.000Z');
    const harness = executorWith({
      'lock-contact': () => ({ rows: [contactRow()] }),
      'find-hard-stops': () => ({
        rows: [{ kind: 'campaign.reply_received', occurred_at: stoppedAt }],
      }),
      'insert-activity': () => ({ rows: [] }),
      'read-event-key': () => ({
        rows: [
          {
            contact_id: contactRow().id,
            data: {
              actor: 'founder',
              policy_version: 'growth-v1',
              prior_stops: ['campaign.reply_received'],
              provenance: 'founder_action',
              reason: 'different reason',
              source: 'growth-control',
            },
            kind: 'contact.reauthorized',
            occurred_at: occurredAt,
            project_id: null,
          },
        ],
      }),
    });

    await expect(
      reauthorizeContact(harness.executor, {
        contactId: String(contactRow().id),
        eventKey: 'founder:reauthorize:collision',
        occurredAt,
        actor: 'founder',
        reason: 'verified renewed request',
        source: 'growth-control',
        policyVersion: 'growth-v1',
        allowedPriorStops: ['campaign.reply_received'],
      })
    ).rejects.toThrow(/event key conflict/i);
    expect(
      harness.calls.some(({ marker }) => marker === 'set-reauthorized')
    ).toBe(false);
  });
});

describe('deleteContact', () => {
  it('cancels unsent work, scrubs PII, unlinks projects, and preserves only suppression/audit state', async () => {
    const deletedRow = contactRow({
      deleted_at: occurredAt,
      latest_hard_stop_kind: 'deletion',
      latest_hard_stop_at: occurredAt,
    });
    const harness = executorWith({
      'lock-contact': () => ({ rows: [contactRow()] }),
      'delete-artifacts': () => ({ rows: [{ id: 'artifact-id' }] }),
      'cancel-and-scrub-jobs': () => ({
        rows: [
          { id: 'pending-job', status: 'cancelled' },
          { id: 'leased-job', status: 'cancelled' },
          { id: 'submitted-job', status: 'completed' },
        ],
      }),
      'unlink-projects': () => ({ rows: [{ id: 'project-id' }] }),
      'delete-private-activity': () => ({ rows: [{ id: 1n }] }),
      'scrub-retained-activity': () => ({ rows: [{ id: 2n }] }),
      'insert-activity': () => ({
        rows: [{ event_key: 'founder:delete:1' }],
      }),
      'scrub-contact': () => ({ rows: [deletedRow] }),
      'read-control-state': () => ({ rows: [deletedRow] }),
    });

    const result = await deleteContact(harness.executor, {
      contactId: String(contactRow().id),
      eventKey: 'founder:delete:1',
      occurredAt,
      actor: 'founder',
      source: 'verified-deletion-request',
      policyVersion: 'growth-v1',
    });

    expect(result.deleted).toBe(true);
    expect(result.state.authorization).toBe('deleted');
    expect(result.state.canSend).toBe(false);
    expect(result.cancelledJobIds).toEqual(['pending-job', 'leased-job']);
    expect(result.retainedJobIds).toEqual(['submitted-job']);
    expect(result.unlinkedProjectIds).toEqual(['project-id']);
    expect(result.deletedArtifactIds).toEqual(['artifact-id']);
    expect(
      harness.calls.find(({ marker }) => marker === 'cancel-and-scrub-jobs')
        ?.sql
    ).toMatch(/project_id\s*=\s*null/u);
    expect(
      harness.calls.find(({ marker }) => marker === 'cancel-and-scrub-jobs')
        ?.sql
    ).toMatch(/then\s+'completed'/u);
    expect(
      harness.calls.find(({ marker }) => marker === 'cancel-and-scrub-jobs')
        ?.sql
    ).toMatch(/lease_until\s*=\s*null[\s\S]*lease_token\s*=\s*null/u);
    expect(
      harness.calls.find(({ marker }) => marker === 'cancel-and-scrub-jobs')
        ?.sql
    ).toMatch(
      /when kind = 'send_step' then[\s\S]*jsonb_build_object\([\s\S]*'campaign_version'[\s\S]*'step'/u
    );
    expect(
      harness.calls.find(({ marker }) => marker === 'scrub-retained-activity')
        ?.sql
    ).toMatch(/project_id\s*=\s*null/u);
    expect(
      harness.calls.find(({ marker }) => marker === 'delete-private-activity')
        ?.sql
    ).toMatch(/contact\.lookup_alias_added/u);
    expect(
      harness.calls.find(({ marker }) => marker === 'scrub-retained-activity')
        ?.sql
    ).toMatch(/key_version[\s\S]*digest/u);
    expect(
      harness.calls.find(({ marker }) => marker === 'scrub-retained-activity')
        ?.sql
    ).toMatch(
      /delivery\.submission_authorized[\s\S]*lease_token[\s\S]*bounded_stop_race/u
    );
    expect(harness.calls.map(({ marker }) => marker)).toEqual([
      'lock-contact',
      'insert-activity',
      'cancel-and-scrub-jobs',
      'delete-artifacts',
      'unlink-projects',
      'delete-private-activity',
      'scrub-retained-activity',
      'scrub-contact',
      'read-control-state',
    ]);
  });

  it('atomically closes an authorized crashed lease unknown for manual review without retry', async () => {
    const deletedRow = contactRow({
      deleted_at: occurredAt,
      latest_hard_stop_kind: 'deletion',
      latest_hard_stop_at: occurredAt,
    });
    const authorizedJobId = '00000000-0000-4000-8000-000000000091';
    const harness = executorWith({
      'lock-contact': () => ({ rows: [contactRow()] }),
      'cancel-and-scrub-jobs': () => {
        return {
          rows: [
            {
              id: authorizedJobId,
              status: 'failed',
              delivery_status: 'unknown',
              last_error_code: 'provider_acceptance_interrupted_by_deletion',
            },
          ],
        };
      },
      'insert-deletion-provider-unknown': (parameters) => {
        expect(parameters).toEqual([[authorizedJobId], occurredAt]);
        return {
          rows: [
            { event_key: `job:${authorizedJobId}:provider-acceptance-unknown` },
          ],
        };
      },
      'delete-artifacts': () => ({ rows: [] }),
      'unlink-projects': () => ({ rows: [] }),
      'delete-private-activity': () => ({ rows: [] }),
      'scrub-retained-activity': () => ({ rows: [] }),
      'insert-activity': () => ({
        rows: [{ event_key: 'founder:delete:authorized-crash' }],
      }),
      'scrub-contact': () => ({ rows: [deletedRow] }),
      'read-control-state': () => ({ rows: [deletedRow] }),
    });

    const result = await deleteContact(harness.executor, {
      contactId: String(contactRow().id),
      eventKey: 'founder:delete:authorized-crash',
      occurredAt,
      actor: 'founder',
      source: 'verified-deletion-request',
      policyVersion: 'growth-v1',
    });

    expect(result.cancelledJobIds).toEqual([]);
    expect(result.retainedJobIds).toEqual([authorizedJobId]);
    expect(harness.calls.map(({ marker }) => marker)).toContain(
      'insert-deletion-provider-unknown'
    );
    const cancellationSql = harness.calls.find(
      ({ marker }) => marker === 'cancel-and-scrub-jobs'
    )?.sql;
    expect(cancellationSql).toMatch(/delivery\.submission_authorized/u);
    expect(cancellationSql).toMatch(/bounded_stop_race/u);
    expect(cancellationSql).toMatch(
      /growth_activity submission_authorization/u
    );
    expect(cancellationSql).not.toMatch(/growth_activity authorization/u);
    expect(cancellationSql).toMatch(/set status = case[\s\S]*then 'failed'/u);
    expect(cancellationSql).toMatch(
      /delivery_status = case[\s\S]*then 'unknown'/u
    );
    expect(cancellationSql).toMatch(
      /provider_acceptance_interrupted_by_deletion/u
    );
    expect(cancellationSql).toMatch(/lease_token = null/u);
    const unknownSql = harness.calls.find(
      ({ marker }) => marker === 'insert-deletion-provider-unknown'
    )?.sql;
    expect(unknownSql).toMatch(/delivery\.acceptance_unknown/u);
    expect(unknownSql).toMatch(/'manual_review', true/u);
    expect(unknownSql).toMatch(/delivery_status', 'unknown'/u);
    expect(unknownSql).not.toMatch(/email_normalized|provider_email_id/u);
    expect(
      harness.calls.find(({ marker }) => marker === 'scrub-retained-activity')
        ?.sql
    ).toMatch(/'manual_review', data -> 'manual_review'/u);
  });

  it('makes repeated deletion inert even with a different event key', async () => {
    const deletedAt = new Date('2026-08-31T12:00:00.000Z');
    const deletedRow = contactRow({
      deleted_at: deletedAt,
      latest_hard_stop_kind: 'deletion',
      latest_hard_stop_at: deletedAt,
    });
    const harness = executorWith({
      'lock-contact': () => ({ rows: [deletedRow] }),
      'read-event-key': () => ({ rows: [] }),
      'read-control-state': () => ({ rows: [deletedRow] }),
    });

    const result = await deleteContact(harness.executor, {
      contactId: String(contactRow().id),
      eventKey: 'founder:delete:repeated',
      occurredAt,
      actor: 'founder',
      source: 'verified-deletion-request',
      policyVersion: 'growth-v1',
    });

    expect(result.deleted).toBe(false);
    expect(result.state.deletedAt).toEqual(deletedAt);
    expect(harness.calls.map(({ marker }) => marker)).toEqual([
      'lock-contact',
      'read-event-key',
      'read-control-state',
    ]);
  });

  it('rejects an altered replay of the original deletion event after deletion', async () => {
    const deletedAt = new Date('2026-08-31T12:00:00.000Z');
    const deletedRow = contactRow({
      deleted_at: deletedAt,
      latest_hard_stop_kind: 'deletion',
      latest_hard_stop_at: deletedAt,
    });
    const harness = executorWith({
      'lock-contact': () => ({ rows: [deletedRow] }),
      'read-event-key': () => ({
        rows: [
          {
            contact_id: contactRow().id,
            data: {
              actor: 'founder',
              policy_version: 'growth-v1',
              provenance: 'verified_deletion',
              source: 'original-source',
            },
            kind: 'deletion',
            occurred_at: occurredAt,
            project_id: null,
          },
        ],
      }),
      'read-control-state': () => ({ rows: [deletedRow] }),
    });

    await expect(
      deleteContact(harness.executor, {
        contactId: String(contactRow().id),
        eventKey: 'founder:delete:original',
        occurredAt,
        actor: 'founder',
        source: 'changed-source',
        policyVersion: 'growth-v1',
      })
    ).rejects.toThrow(/event key conflict/i);
    expect(
      harness.calls.some(({ marker }) => marker === 'read-control-state')
    ).toBe(false);
  });

  it('rejects a deletion event-key collision with changed provenance', async () => {
    const harness = executorWith({
      'lock-contact': () => ({ rows: [contactRow()] }),
      'cancel-and-scrub-jobs': () => ({ rows: [] }),
      'delete-artifacts': () => ({ rows: [] }),
      'unlink-projects': () => ({ rows: [] }),
      'delete-private-activity': () => ({ rows: [] }),
      'scrub-retained-activity': () => ({ rows: [] }),
      'insert-activity': () => ({ rows: [] }),
      'read-event-key': () => ({
        rows: [
          {
            contact_id: contactRow().id,
            data: {
              actor: 'founder',
              policy_version: 'growth-v1',
              provenance: 'verified_deletion',
              source: 'different-source',
            },
            kind: 'deletion',
            occurred_at: occurredAt,
            project_id: null,
          },
        ],
      }),
    });

    await expect(
      deleteContact(harness.executor, {
        contactId: String(contactRow().id),
        eventKey: 'founder:delete:collision',
        occurredAt,
        actor: 'founder',
        source: 'verified-deletion-request',
        policyVersion: 'growth-v1',
      })
    ).rejects.toThrow(/event key conflict/i);
    expect(harness.calls.some(({ marker }) => marker === 'scrub-contact')).toBe(
      false
    );
    expect(harness.calls.map(({ marker }) => marker)).toEqual([
      'lock-contact',
      'insert-activity',
      'read-event-key',
    ]);
  });
});
