import type { ChannelAdapter, Draft, PostMetrics, PostResult } from '../types';
import { validateDraft } from '../validation';
import { LinkedInAuth } from './auth';
import { postLinkedIn } from './post';

export class LinkedInAdapter implements ChannelAdapter {
  readonly id = 'linkedin' as const;
  private readonly auth: LinkedInAuth;

  constructor() {
    this.auth = new LinkedInAuth();
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
