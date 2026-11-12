import type { RenderViewProps } from '../../render/index.js';
import { mediaUrl } from './media-url.js';

/** A2UI AudioPlayer: one audio URL with the browser's playback controls, named by its optional description. */
export function A2uiAudioPlayer({ props }: RenderViewProps) {
  const { description } = props;
  const url = mediaUrl(props['url'], 'audio');
  if (url === undefined) return null;
  const label =
    typeof description === 'string' && description !== ''
      ? description
      : undefined;
  return (
    <div className="a2ui-audio-wrap">
      {label === undefined ? null : (
        <span className="a2ui-audio-description">{label}</span>
      )}
      <audio
        className="a2ui-audio"
        src={url}
        controls
        preload="metadata"
        aria-label={label}
      />
    </div>
  );
}
