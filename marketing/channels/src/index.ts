//
// @threadplane-internal/marketing-channels — public API.
// See docs/superpowers/specs/marketing/2026-05-17-channel-adapters-design.md

export type {
  Draft,
  DraftMedia,
  PostResult,
  PostMetrics,
  ChannelAdapter,
  ChannelId,
  AdapterOptions,
  XCredentials,
  LinkedInCredentials,
  DevToCredentials,
} from './types.ts';

export { validateDraft, ValidationError } from './validation.ts';

export { getAdapter, createAdapter } from './registry.ts';
