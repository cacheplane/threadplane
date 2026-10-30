export type Channel = 'x' | 'linkedin' | 'devto' | 'blog';
export type PostKind = 'release' | 'qa' | 'news' | 'guide' | 'take';
export type PostStatus =
  | 'draft'
  | 'scheduled'
  | 'posting'
  | 'posted'
  | 'failed'
  | 'cancelled';

export interface MarketingWeek {
  id: string;
  weekStart: string;
  status: 'drafting' | 'approved';
  approvedAt: string | null;
  notes: string | null;
  createdAt: string;
}

export interface MediaRef {
  url: string;
  alt: string;
}

export interface PostResult {
  postId?: string;
  url?: string;
  postedAt?: string;
  warnings?: string[];
}

export interface MarketingPost {
  id: string;
  weekId: string | null;
  channel: Channel;
  kind: PostKind;
  status: PostStatus;
  publishAt: string;
  payload: Record<string, unknown>;
  media: MediaRef[];
  sourceRefs: unknown[];
  dependsOn: string | null;
  utmCampaign: string | null;
  idempotencyKey: string;
  confirmedFlags: string[];
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  attempts: number;
  deployRequestedAt: string | null;
  result: PostResult | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewPost {
  weekId: string | null;
  channel: Channel;
  kind: PostKind;
  publishAt: Date;
  payload: Record<string, unknown>;
  media?: MediaRef[];
  sourceRefs?: unknown[];
  dependsOn?: string | null;
  utmCampaign?: string | null;
  /** `${channel}:${weekStart}:${slot}`, supplied by the caller. */
  idempotencyKey: string;
}
