import type { ChannelAdapter, Draft, PostMetrics, PostResult } from '../types.ts';
import { validateDraft } from '../validation.ts';
import { XAuth, type XAuthOptions } from './auth.ts';
import { postX } from './post.ts';

export class XAdapter implements ChannelAdapter {
  readonly id = 'x' as const;
  private readonly auth: XAuth;

  constructor(opts?: XAuthOptions) {
    this.auth = new XAuth(opts);
  }

  async post(draft: Draft): Promise<PostResult> {
    validateDraft(draft, { adapterId: 'x' });
    return postX(this.auth, draft);
  }

  async metrics(postId: string): Promise<PostMetrics> {
    // X read endpoints unavailable on Free/pay-per-use tier (May 2026).
    // When tier upgrades to Basic+, replace with GET /2/tweets/{id}?tweet.fields=public_metrics.
    return { postId, fetchedAt: new Date().toISOString() };
  }
}
