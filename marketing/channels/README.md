# @threadplane-internal/marketing-channels

Channel adapters for the Threadplane marketing pipeline. One adapter per channel, all behind a single `ChannelAdapter` interface.

## Implemented

- **X** (`getAdapter('x')`) — post single tweets, threads, and image media (PNG ≤ 5MB, alt text required). `metrics()` is a stub until the X tier upgrades to Basic+.
- **Dev.to** (`getAdapter('devto')`) — post articles with title, tags, canonical URL, description. Real `metrics()` (Dev.to's read API is free).
- **LinkedIn** (`getAdapter('linkedin')`) — post to your personal profile with one optional image (PNG ≤ 5MB, alt text required) and an optional `firstComment` posted right after. `metrics()` is a stub: reading member post stats needs a partner-only permission.

## Planned (follow-up commits in this package — no separate spec)

- Reddit

## Quickstart

```ts
import { getAdapter } from '@threadplane-internal/marketing-channels';

const x = getAdapter('x');
const result = await x.post({
  channel: 'x',
  text: 'Hello from Threadplane.',
});
console.log(result.url);
```

## Auth (X)

X uses OAuth 2.0 User Context with PKCE. The first time you set it up, run the bootstrapper:

```bash
npm run marketing:channels:x:auth
```

It opens your browser, you authorize the app, and it prints the tokens for you to paste into `.env`:

```
X_ACCESS_TOKEN=...
X_REFRESH_TOKEN=...
X_USER_HANDLE=brian
```

Prerequisites: create an X v2 app at <https://developer.x.com/en/portal/dashboard> and set the `X_CLIENT_ID` + `X_CLIENT_SECRET` env vars from the app's OAuth 2.0 section.

When an access token expires, the adapter automatically calls `/2/oauth2/token` to refresh. Rotated tokens remain in memory and are never logged by the adapter. They are not persisted across process restarts; if authentication fails after restarting, run the bootstrapper again.

## Auth (LinkedIn)

LinkedIn uses 3-legged OAuth 2.0. One-time app setup:

1. Create an app at <https://www.linkedin.com/developers/apps>. LinkedIn requires a company page to associate it with.
2. Under **Products**, add **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect**. Both are self-serve.
3. Under **Auth**, add the redirect URL `http://localhost:8724/callback`.
4. Copy the Client ID and Primary Client Secret into `.env` as `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`.

Then run the bootstrapper:

```bash
npm run marketing:channels:linkedin:auth
```

It opens your browser, you authorize the app, and it prints the values for `.env`:

```
LINKEDIN_ACCESS_TOKEN=...
LINKEDIN_AUTHOR_URN=urn:li:person:...
LINKEDIN_TOKEN_EXPIRES_AT=2027-01-01T00:00:00.000Z
```

Tokens last 60 days and self-serve apps get no refresh token, so there's no automatic refresh. The adapter warns on stderr when the token expires within 7 days and refuses to post once it has expired; run the bootstrapper again either way.

Post text is sent in LinkedIn's "little" format. The adapter escapes its reserved characters (`| { } @ [ ] ( ) < > \ * _ ~`, and any `#` that doesn't start a hashtag) so the text renders as written. Unescaped parentheses can silently truncate a post. `#word` hashtags stay live.

A failed `firstComment` doesn't throw, because the post is already live: the result carries a `warnings` entry instead, so add the comment by hand.

## Auth (Dev.to)

Dev.to uses a single static API key.

1. Sign in to Dev.to.
2. **Settings** → **Extensions** → **DEV Community API Keys** → **Generate API Key**.
   Name it `threadplane-marketing` (or anything you like).
3. Copy the key into `.env`:

   ```
   DEVTO_API_KEY=<paste>
   ```

4. Verify with a dry-run:

   ```bash
   DRY_RUN=1 npm run marketing:channels:devto:smoke
   ```

### Tag rules (Dev.to)

Dev.to is strict about tags. The validator catches violations before the API call:

- Maximum 4 tags per post.
- Each tag: lowercase letters and digits only — `^[a-z0-9]+$`.
- No hyphens (`lang-graph` ✗), underscores (`lang_graph` ✗), or uppercase (`Angular` ✗).
- Each tag ≤ 30 chars.

## Dry-run

Set `DRY_RUN=1` and `post()` writes the draft to `tmp/marketing/dry-runs/<id>.json` instead of hitting any API. Safe for local development and CI.

The default path is relative to the process working directory. Set `MARKETING_DRY_RUN_DIR` to an absolute path or a different relative directory to direct output to an operator's review folder. This storage is independent of Cowork.

```bash
DRY_RUN=1 npx tsx marketing/channels/scripts/smoke.ts
```

## Validation

All adapters call `validateDraft()` first. Drafts that violate per-channel rules throw `ValidationError` before any network call. X rules:

- Single tweet OR thread (mutually exclusive).
- Each tweet/part ≤ 280 code points.
- Threads have ≥ 2 parts.
- Up to 4 media items per post.
- PNG only, ≤ 5MB, alt text required (1-1000 chars).

LinkedIn rules:

- `text` required, ≤ 3000 code points. No `threadParts`.
- No `link`: the Posts API doesn't scrape link previews. Put the URL in `firstComment` or the text.
- `firstComment` 1-1250 code points.
- At most 1 image, with the same PNG and alt-text rules as X.

## Adding a new adapter

1. Create `src/<channel>/{index,auth,post}.ts`.
2. Implement `ChannelAdapter`.
3. Add the per-channel rules to `validation.ts`.
4. Wire into `registry.ts:buildAdapter`.
5. Add an entry to this README.
6. Add env vars to `marketing/.env.example`.
7. Tests use `msw/node` to mock the channel's HTTP API.

## See also

- [Growth architecture and operations](../../docs/growth/README.md)
- Spec: `docs/superpowers/specs/marketing/2026-05-17-channel-adapters-design.md`
- Meta: `docs/superpowers/specs/marketing/2026-05-17-marketing-meta-design.md`
- Manual smoke recipe: `MANUAL-SMOKE.md`
