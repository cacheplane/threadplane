# Resend receiving and Google retirement

Threadplane receives `brian@threadplane.ai` through Resend and forwards to
`brian@cacheplane.ai`. Forwarded mail uses the original sender as Reply-To and
includes `original.eml` with attachments. Human replies come from Cacheplane.
The operator confirmed no other root addresses, aliases or groups need migration.

The operator waived historical reply reconciliation and uninterrupted coverage
during cutover. Do not require a Gmail drain, historical backfill or mailbox export.
Existing RFC bindings remain usable; binding repair covers sends created or
provider-accepted from the receiving start onward.

## Production cutover evidence

Receiving activated on 2026-10-22 with the fixed start
`2026-10-22T20:23:19.399Z`. The root MX is `receive.forge.rmta.net`, priority 0,
TTL 60. Resend verified receiving and the existing sending records. Website and
lifecycle production deployments use the new receiving controls; the Google
callback returns 410, its credentials were removed, and legacy reconciliation
jobs were cancelled through the audited retirement operation.

A controlled incoming message was automatically forwarded to `brian@cacheplane.ai`
and reported delivered by Resend. Its Reply-To retained the original sender and
`original.eml` retained the test attachment. Google Admin reports no subscriptions;
Apps Script is inaccessible because Workspace was already cancelled. Permanent
deletion of the remaining Google organization is a separate irreversible step.
The deployed five-minute recovery cron refreshed mailbox health at
`2026-10-22T20:40:24.365Z`, with no recovery in progress and no active legacy
`reply_reconcile` jobs.

## Configuration

Apply migration `0009_growth_resend_receiving.sql` before deploying: deletion
scrubs receipts even when receiving is disabled. Preview receiving stays disabled.
Never connect the same receiving address to multiple databases.

| Variable                                         | Deployment                    | Purpose                                                    |
| ------------------------------------------------ | ----------------------------- | ---------------------------------------------------------- |
| `RESEND_RECEIVING_ENABLED=true`                  | Website, lifecycle production | Receiving and ongoing campaign health controls             |
| `RESEND_RECEIVING_STARTED_AT`                    | Both                          | Immutable UTC start, set before root MX changes            |
| `GROWTH_DATABASE_ENVIRONMENT=production`         | Both                          | Explicit growth environment                                |
| `RESEND_RECEIVING_API_KEY`                       | Website                       | Dedicated server-only receiving/sent-email read credential |
| `RESEND_INBOUND_WEBHOOK_SECRET`                  | Website                       | Separate `email.received` signing secret                   |
| `RESEND_API_KEY`                                 | Both                          | Existing Threadplane sending credential                    |
| `RESEND_WEBHOOK_SECRET`                          | Website                       | Existing delivery signing secret                           |
| `CRON_SECRET`                                    | Website                       | Existing bearer secret, at least 32 characters             |
| `FOUNDER_NOTIFICATION_EMAIL=brian@cacheplane.ai` | Lifecycle                     | Internal notifications delivered directly                  |

Retain existing database, HMAC keyring, campaign, tracking and unsubscribe controls.
Resend receiving reads currently require `full_access`; a variable name does not
narrow provider permissions. Do not deploy the shared provisioning token.

## Cutover

1. Snapshot root MX. Initial inventory: `smtp.google.com.` priority 1, TTL 60.
   Preserve Resend's `send` MX/SPF and `resend._domainkey` records.
2. Apply migrations with Node 22 and the existing database preflight. Deploy website
   and lifecycle with matching receiving settings and the same fixed start.
3. Enable receiving on the existing verified `threadplane.ai` Resend domain.
   Register `https://threadplane.ai/api/webhooks/resend-inbound` for `email.received`
   with its own secret. Preserve all other webhooks, including Threadplane delivery.
4. Replace only the root Google MX with Resend's exact receiving MX. Verify public
   DNS and domain status; keep sending records unchanged.
5. With explicit production `DATABASE_URL` and receiving settings, run
   `npm run growth:receiving -- recover`. Partial work returns `complete:false` and
   resumes next time. Vercel calls `/api/cron/inbox-recovery` every five minutes;
   its 300-second route budget requires a supporting plan.
6. Run `npm run growth:receiving -- retire-google --actor brian --evidence cutover-2026-10-22`.
   This records retirement, releases old Google recovery pauses and cancels legacy
   `reply_reconcile` jobs, without waiting for historical coverage.
7. Remove `GOOGLE_REPLY_HMAC_SECRET` from website environments. The retired callback
   returns HTTP 410 without reading a secret/database. Poller source and CI are removed.
8. In Google, delete `pollThreadplaneMailbox` triggers, revoke the script's access,
   and archive/delete its project. Cancel the dedicated account after checking it
   is not needed for unrelated Google services. No export or drain is required.
9. Check new inbound delivery, attachment and Reply-To at Cacheplane, and a controlled
   reply stopping follow-ups. These verify the new route, not continuity with Google.

Google's root SPF authorization and `google._domainkey` can be removed after Google
sending stops. Preserve Google site-verification records used by Search Console.

## Processing and recovery

Raw-body signature verification precedes admission. Only `email.received` for Brian's
exact address and the fixed start enters the ledger. Bodies, subjects and MIME are
transient; identifiers, bounded references and closed error codes persist.
Reply matching prefers In-Reply-To, then References, requires the known contact sender,
and uses canonical `stopContact`. Forwarding runs independently, including unrelated mail.

Root-self mail, Cacheplane destination mail and our forwarding marker do not forward
recursively. Third-party automated notices still forward. Erased contact tombstones
suppress delayed forwards. Payload hashes and product/environment-scoped keys preserve
retry identity; unresolved attempts expire at 23 hours rather than risk duplicates
beyond Resend's 24-hour idempotency period.

Recovery persists pagination progress, repairs active-period bindings, processes receipts
and retries forwarding. Missing, recovering, stale (>10-minute) or unread coverage pauses
new campaigns; known-contact unresolved replies block that contact. These controls concern
ongoing Resend operation, not historical Google mail.

Use `npm run growth:receiving -- status` for aggregate health. Parsing/provider failures
remain pending with `processing_failed`. Inspect the message in Resend. Explicitly ignore
one reviewed receipt with `npm run growth:receiving -- review-ignore --receipt-id ID --actor brian --evidence REVIEW_REFERENCE`.
The decision is audited; never manually advance health or bulk-complete receipts.

## Rollback

Pause campaigns if receiving fails. Restore saved root MX to return inbound mail to Google
only if that account still exists. Restoring its retired collector requires deliberate code
and configuration rollback. Preserve receipt, attempt and retirement evidence.
