import type { ChannelAdapter, Draft, PostMetrics, PostResult } from '../types.ts';
import { validateDraft } from '../validation.ts';
import { LinkedInAuth } from './auth.ts';
import type { LinkedInCredentials } from '../types.ts';
import { postLinkedIn } from './post.ts';

export class LinkedInAdapter implements ChannelAdapter {
  readonly id = 'linkedin' as const;
  private readonly auth: LinkedInAuth;

  constructor(opts?: { credentials: LinkedInCredentials; signal?: AbortSignal }) {
    this.auth = new LinkedInAuth(opts);
  }

  async post(draft: Draft): Promise<PostResult> {
    validateDraft(draft, { adapterId: 'linkedin' });
    return postLinkedIn(this.auth, draft);
  }

  async metrics(postId: string): Promise<PostMetrics> {
    // Reading a member's post stats needs r_member_social, which LinkedIn
    // grants to approved partners only. Self-serve apps can write, not read.
    return { postId, fetchedAt: new Date().toISOString() };
  }
}
