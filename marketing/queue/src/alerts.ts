export interface AlertEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
}

/** Structural slice of the Resend client's `emails` API; injected so queue has no resend dependency. */
export interface AlertEmailSender {
  send(
    input: AlertEmail
  ): Promise<{ error?: { message: string } | null } | void>;
}

export type MarketingAlert = (
  key: string,
  subject: string,
  body: string
) => Promise<void>;

/**
 * Sends each alert key at most once: `claim` is `claimAlert` bound to the
 * root executor, and only the caller that wins the claim sends the email.
 * A failed send hands the claim back via `release` (`releaseAlertClaim`)
 * so a later tick retries, then rethrows.
 */
export function createAlertSender(options: {
  resend: AlertEmailSender;
  from: string;
  to: string;
  claim: (key: string) => Promise<boolean>;
  release: (key: string) => Promise<void>;
}): MarketingAlert {
  return async (key, subject, body) => {
    if (!(await options.claim(key))) return;
    let failure: string | undefined;
    try {
      const response = await options.resend.send({
        from: options.from,
        to: options.to,
        subject,
        text: body,
      });
      if (response && response.error) failure = response.error.message;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    if (failure !== undefined) {
      await options.release(key);
      throw new Error(`Marketing alert ${key} could not be sent: ${failure}`);
    }
  };
}
