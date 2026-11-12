import type { RenderViewProps } from '../../render/index.js';
import { mediaUrl } from './media-url.js';

/** A2UI Video: one video URL with the browser's playback controls; it never starts by itself. */
export function A2uiVideo({ props }: RenderViewProps) {
  const url = mediaUrl(props['url'], 'video');
  if (url === undefined) return null;
  return <video className="a2ui-video" src={url} controls preload="metadata" />;
}
