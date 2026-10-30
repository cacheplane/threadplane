import type { ChannelAdapter, DevToCredentials, Draft, PostMetrics, PostResult } from '../types.ts';
import { validateDraft } from '../validation.ts';
import { postDevTo } from './post.ts';
import { fetchDevToMetrics } from './metrics.ts';

export class DevToAdapter implements ChannelAdapter {
  readonly id = 'devto' as const;
  private readonly apiKey: string;

  constructor(opts?: { credentials: DevToCredentials }) {
    if (opts) {
      this.apiKey = opts.credentials.apiKey;
      return;
    }
    const key = process.env.DEVTO_API_KEY;
    if (!key || key.length === 0) {
      throw new Error(
        'Dev.to adapter missing env var: DEVTO_API_KEY. Generate one at https://dev.to/settings/extensions and add to .env.',
      );
    }
    this.apiKey = key;
  }

  async post(draft: Draft): Promise<PostResult> {
    validateDraft(draft, { adapterId: 'devto' });
    return postDevTo(this.apiKey, draft);
  }

  async metrics(postId: string): Promise<PostMetrics> {
    return fetchDevToMetrics(this.apiKey, postId);
  }
}
