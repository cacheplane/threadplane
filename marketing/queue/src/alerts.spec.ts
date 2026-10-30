import { createAlertSender } from './alerts.ts';

function harness(claimResults: boolean[], sendResult: unknown = { error: null }) {
  const claims: string[] = [];
  const released: string[] = [];
  const sent: unknown[] = [];
  const send = createAlertSender({
    resend: {
      async send(input) {
        sent.push(input);
        return sendResult as { error: null };
      },
    },
    from: 'alerts@threadplane.ai',
    to: 'founder@example.com',
    claim: async (key) => {
      claims.push(key);
      return claimResults.shift() ?? false;
    },
    release: async (key) => {
      released.push(key);
    },
  });
  return { claims, released, sent, send };
}

describe('createAlertSender', () => {
  it('sends only when the claim wins', async () => {
    const { claims, sent, send } = harness([true, false]);
    await send('post_failed:p1', 'Post failed', 'body');
    await send('post_failed:p1', 'Post failed', 'body');
    expect(claims).toEqual(['post_failed:p1', 'post_failed:p1']);
    expect(sent).toEqual([
      {
        from: 'alerts@threadplane.ai',
        to: 'founder@example.com',
        subject: 'Post failed',
        text: 'body',
      },
    ]);
  });

  it('throws and releases the claim when the sender reports an error', async () => {
    const { released, send } = harness([true], {
      error: { message: 'rate limited' },
    });
    await expect(send('k', 's', 'b')).rejects.toThrow(/rate limited/u);
    expect(released).toEqual(['k']);
  });

  it('keeps the claim when the send succeeds', async () => {
    const { released, send } = harness([true]);
    await send('k', 's', 'b');
    expect(released).toEqual([]);
  });
});
