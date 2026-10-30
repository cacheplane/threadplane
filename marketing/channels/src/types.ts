//
// @threadplane-internal/marketing-channels — public types.

export type ChannelId = 'x' | 'linkedin' | 'devto' | 'reddit';

export interface DraftMedia {
  png: Buffer;
  alt: string;
}

export interface DraftArticle {
  /** 1-128 chars. */
  title: string;
  /** Channel-specific limits. Dev.to: ^[a-z0-9]+$, ≤ 4 items, each ≤ 30 chars. */
  tags?: string[];
  /** Absolute https: URL — origin post location. Tells search engines where the canonical version lives. */
  canonicalUrl?: string;
  /** Meta description; falls through to the platform's SEO subtitle. */
  description?: string;
}

export interface Draft {
  channel: ChannelId;
  text?: string;
  threadParts?: string[];
  media?: DraftMedia[];
  link?: { url: string; previewTitle?: string };
  scheduledAt?: string;
  article?: DraftArticle;
  /** LinkedIn only: posted as the author's first comment right after the post. */
  firstComment?: string;
}

export interface PostResult {
  channel: ChannelId;
  postId: string;
  url: string;
  postedAt: string;
  /** Follow-up steps that failed after the post itself went live. */
  warnings?: string[];
}

export interface PostMetrics {
  postId: string;
  impressions?: number;
  clicks?: number;
  replies?: number;
  shares?: number;
  fetchedAt: string;
}

export interface ChannelAdapter {
  readonly id: ChannelId;
  post(draft: Draft): Promise<PostResult>;
  metrics(postId: string): Promise<PostMetrics>;
}

export interface XCredentials {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  userHandle: string;
}

export interface LinkedInCredentials {
  accessToken: string;
  authorUrn: string;
  expiresAt?: Date;
}

export interface DevToCredentials {
  apiKey: string;
}

/** Credentials injected by a caller (e.g. loaded from a database) instead of `process.env`. */
export interface AdapterOptions {
  x?: {
    credentials: XCredentials;
    /** Awaited by `XAuth.refresh()` before it returns, so rotated tokens can be persisted. */
    onTokensRotated?: (t: { accessToken: string; refreshToken: string }) => Promise<void>;
  };
  linkedin?: { credentials: LinkedInCredentials };
  devto?: { credentials: DevToCredentials };
}
