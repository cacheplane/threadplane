'use client';
import { useState } from 'react';

/** The caller keys this local state by destination within a generation. */
export function MarkdownImage({
  src,
  alt,
  title,
}: {
  readonly src: string | undefined;
  readonly alt: string;
  readonly title: string;
}) {
  const [failed, setFailed] = useState(false);
  return !src || failed ? (
    <span role="img" aria-label={alt || 'Image unavailable'}>
      {alt || 'Image unavailable'}
    </span>
  ) : (
    <img
      src={src}
      alt={alt}
      title={title || undefined}
      style={{ maxWidth: '100%' }}
      onError={() => setFailed(true)}
    />
  );
}
