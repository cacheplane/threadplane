import { expect, test, vi } from 'vitest';

import {
  bindOutboundMessageId,
  loadInboxConfig,
  parseReplyHeaders,
  processInboxReceipt,
} from './inbox-replies.ts';
import { executorWith } from './inbox-test-support.ts';

const config = {
  enabled: true as const,
  address: 'brian@threadplane.ai',
  startedAt: new Date('2026-10-22T00:00:00Z'),
};
const receivedAt = new Date('2026-10-22T01:00:00Z');
const receipt = {
  id: 'incoming-1',
  recipient: config.address,
  received_at: receivedAt,
  status: 'pending',
  rfc_message_id: null,
  reference_ids: null,
};
const message = {
  id: 'incoming-1',
  to: [config.address],
  from: 'Reader <reader@example.com>',
  created_at: receivedAt.toISOString(),
  headers: {
    'Message-ID': '<reply@example.com>',
    'In-Reply-To': '<sent@resend.com>',
    References: '<older@resend.com> <sent@resend.com>',
  },
  text: 'not persisted',
};

test('receiving defaults off and only accepts the production root mailbox', () => {
  expect(loadInboxConfig({})).toEqual({ enabled: false });
  expect(() =>
    loadInboxConfig({
      RESEND_RECEIVING_ENABLED: 'true',
      GROWTH_DATABASE_ENVIRONMENT: 'production',
      RESEND_RECEIVING_ADDRESS: 'brian@invalid.example',
    })
  ).toThrow();
  expect(
    loadInboxConfig({
      RESEND_RECEIVING_ENABLED: 'true',
      GROWTH_DATABASE_ENVIRONMENT: 'production',
      RESEND_RECEIVING_ADDRESS: config.address,
      RESEND_RECEIVING_STARTED_AT: config.startedAt.toISOString(),
    })
  ).toEqual(config);
});

test('references are ordered direct first and normalize only the domain', () => {
  expect(
    parseReplyHeaders({
      'In-Reply-To': '<Case@EXAMPLE.COM>',
      references: '<older@example.com> <Case@EXAMPLE.COM>',
    })
  ).toEqual({
    messageId: null,
    references: ['<Case@example.com>', '<older@example.com>'],
    direct: '<Case@example.com>',
  });
  expect(() => parseReplyHeaders({ References: 'x'.repeat(20000) })).toThrow();
});

test('folded RFC reference headers are unfolded without accepting bare newlines', () => {
  expect(
    parseReplyHeaders({
      References: '<one@example.com>\r\n\t<two@example.com>',
    }).references
  ).toEqual(['<one@example.com>', '<two@example.com>']);
  expect(() =>
    parseReplyHeaders({ References: '<one@example.com>\r\nInjected: bad' })
  ).toThrow();
});

test('reference parsing consumes only complete IDs and whitespace', () => {
  expect(
    parseReplyHeaders({ References: '<one@example.com><two@example.com>' })
      .references
  ).toEqual(['<one@example.com>', '<two@example.com>']);
  for (const value of [
    '<<script>reader@example.com>',
    '<script>',
    'prefix <one@example.com>',
    '<one@example.com>junk<two@example.com>',
    '<one@example.com> suffix',
  ]) {
    expect(() => parseReplyHeaders({ References: value })).toThrow();
  }
});

test('matched reply uses provider receipt time and canonical mailbox stop, once', async () => {
  const stop = vi.fn(async () => ({ applied: true }));
  const { executor, calls } = executorWith({
    'inbox-receipt-lock': () => ({ rows: [receipt] }),
    'inbox-match': () => ({
      rows: [{ contact_id: 'contact-1', rfc_message_id: '<sent@resend.com>' }],
    }),
    'inbox-contact-lock': () => ({
      rows: [
        {
          id: 'contact-1',
          deleted_at: null,
          email_normalized: 'reader@example.com',
        },
      ],
    }),
    'inbox-complete': () => ({ rows: [] }),
  });

  const result = await processInboxReceipt(executor, receipt.id, config, {
    getReceived: async () => message,
    stopContact: stop as never,
  });

  expect(result).toBe('stopped');
  expect(stop).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      contactId: 'contact-1',
      reason: 'campaign.reply_received',
      occurredAt: receivedAt,
      provenance: expect.objectContaining({ kind: 'mailbox_reply' }),
    })
  );
  expect(stop).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ eventKey: 'resend:reply:incoming-1:stop' })
  );
  expect(JSON.stringify(calls)).not.toContain('not persisted');
});

test('early reply stays pending until a binding exists', async () => {
  const stop = vi.fn();
  const { executor } = executorWith({
    'inbox-receipt-lock': () => ({ rows: [receipt] }),
    'inbox-match': () => ({ rows: [] }),
    'inbox-pending': () => ({ rows: [] }),
  });

  expect(
    await processInboxReceipt(executor, receipt.id, config, {
      getReceived: async () => message,
      stopContact: stop,
    })
  ).toBe('pending');
  expect(stop).not.toHaveBeenCalled();
});

test('deletion before receipt association leaves an erasure marker for forwarding', async () => {
  const stop = vi.fn();
  const { executor, calls } = executorWith({
    'inbox-receipt-lock': () => ({ rows: [receipt] }),
    'inbox-match': () => ({
      rows: [{ contact_id: 'contact-1', rfc_message_id: '<sent@resend.com>' }],
    }),
    'inbox-contact-lock': () => ({
      rows: [
        { id: 'contact-1', deleted_at: receivedAt, email_normalized: null },
      ],
    }),
    'inbox-complete': () => ({ rows: [] }),
  });

  const result = await processInboxReceipt(executor, receipt.id, config, {
    getReceived: async () => message,
    stopContact: stop,
  });

  expect(result).toBe('ignored');
  expect(
    calls.find((call) => call.marker === 'inbox-complete')?.params
  ).toEqual([receipt.id, 'ignored', null, 'contact_deleted']);
  expect(stop).not.toHaveBeenCalled();
});

test('already processed receipts never apply a second stop', async () => {
  const stop = vi.fn();
  const { executor } = executorWith({
    'inbox-receipt-lock': () => ({ rows: [{ ...receipt, status: 'stopped' }] }),
  });

  expect(
    await processInboxReceipt(executor, receipt.id, config, {
      getReceived: async () => message,
      stopContact: stop,
    })
  ).toBe('stopped');
  expect(stop).not.toHaveBeenCalled();
});

test('wrong recipient cannot stop a contact even with valid references', async () => {
  const stop = vi.fn();
  const { executor } = executorWith({
    'inbox-receipt-lock': () => ({ rows: [receipt] }),
  });

  await expect(
    processInboxReceipt(executor, receipt.id, config, {
      getReceived: async () => ({ ...message, to: ['wrong@example.com'] }),
      stopContact: stop,
    })
  ).rejects.toThrow();
  expect(stop).not.toHaveBeenCalled();
});

test('different-contact references remain pending rather than guessing by sender', async () => {
  const { executor } = executorWith({
    'inbox-receipt-lock': () => ({ rows: [receipt] }),
    'inbox-match': () => ({
      rows: [
        { contact_id: 'a', rfc_message_id: '<older@resend.com>' },
        { contact_id: 'b', rfc_message_id: '<sent@resend.com>' },
      ],
    }),
    'inbox-pending': () => ({ rows: [] }),
  });

  expect(
    await processInboxReceipt(executor, receipt.id, config, {
      getReceived: async () => ({
        ...message,
        headers: { References: '<older@resend.com> <sent@resend.com>' },
      }),
      stopContact: vi.fn(),
    })
  ).toBe('pending');
});

test('outbound binding refuses a conflicting existing message ID', async () => {
  const { executor } = executorWith({
    'discover-provider-message-job': () => ({ rows: [] }),
  });

  await expect(
    bindOutboundMessageId(executor, 'outgoing-1', '<sent@resend.com>')
  ).rejects.toThrow('binding');
});

test('receiving cannot enable the same root mailbox in another database environment', () => {
  for (const environment of [undefined, 'preview', 'test']) {
    expect(() =>
      loadInboxConfig({
        RESEND_RECEIVING_ENABLED: 'true',
        RESEND_RECEIVING_STARTED_AT: config.startedAt.toISOString(),
        GROWTH_DATABASE_ENVIRONMENT: environment,
      })
    ).toThrow();
  }
  expect(
    loadInboxConfig({
      RESEND_RECEIVING_ENABLED: 'true',
      RESEND_RECEIVING_STARTED_AT: config.startedAt.toISOString(),
      GROWTH_DATABASE_ENVIRONMENT: 'production',
    })
  ).toEqual(config);
});

test('mismatched sender remains pending without stopping the referenced contact', async () => {
  const stop = vi.fn();
  const { executor, calls } = executorWith({
    'inbox-receipt-lock': () => ({ rows: [receipt] }),
    'inbox-match': () => ({
      rows: [{ contact_id: 'contact-1', rfc_message_id: '<sent@resend.com>' }],
    }),
    'inbox-contact-lock': () => ({
      rows: [
        {
          id: 'contact-1',
          deleted_at: null,
          email_normalized: 'other@example.com',
        },
      ],
    }),
    'inbox-pending': () => ({ rows: [] }),
  });
  expect(
    await processInboxReceipt(executor, receipt.id, config, {
      getReceived: async () => message,
      stopContact: stop,
    })
  ).toBe('pending');
  expect(stop).not.toHaveBeenCalled();
  expect(calls.find((call) => call.marker === 'inbox-pending')?.sql).toContain(
    'sender_mismatch'
  );
  expect(
    calls.findIndex((call) =>
      call.sql.includes('growth-observation-privacy-v1')
    )
  ).toBeLessThan(
    calls.findIndex((call) =>
      call.sql.includes('google-mailbox-reconciliation')
    )
  );
  expect(
    calls.find((call) => call.marker === 'inbox-receipt-lock')?.sql
  ).not.toContain('for update');
});

test.each(['provider', 'headers'])(
  'unread %s failures persist closed diagnosis without message content',
  async (failure) => {
    const { executor, calls } = executorWith({
      'inbox-processing-failed': () => ({ rows: [] }),
    });
    await expect(
      processInboxReceipt(executor, receipt.id, config, {
        getReceived: async () => {
          if (failure === 'provider') throw new Error('sensitive subject');
          return { ...message, headers: { References: 'sensitive body' } };
        },
        stopContact: vi.fn(),
      })
    ).rejects.toThrow(/^Inbox receipt processing failed$/);
    const diagnostic = calls.find(
      (call) => call.marker === 'inbox-processing-failed'
    );
    expect(diagnostic?.sql).toContain("last_error_code = 'processing_failed'");
    expect(diagnostic?.sql).toContain("status = 'pending'");
    expect(diagnostic?.sql).not.toContain('reference_ids =');
    expect(JSON.stringify(calls)).not.toContain('sensitive');
  }
);
