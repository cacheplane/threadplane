import type { Citation } from '@threadplane/core';

/** Supported source categories used for citation icons and visual tones. */
export type CitationTypeIcon = 'web' | 'file' | 'app' | 'memory' | 'generic';

/** Normalized source type, label, icon, tone, and recognition status for citation display. */
export interface CitationTypeMeta {
  readonly type: string;
  readonly label: string | null;
  readonly icon: CitationTypeIcon;
  readonly tone: CitationTypeIcon;
  readonly isKnown: boolean;
}

/** A citation source marker rendered from a provider image URL. */
export interface CitationImageVisual {
  readonly kind: 'image';
  readonly iconUrl: string;
}

/** A citation source marker rendered with a source-category icon and tone. */
export interface CitationTypeIconVisual {
  readonly kind: 'type-icon';
  readonly icon: CitationTypeIcon;
  readonly tone: CitationTypeIcon;
  readonly label: string | null;
}

/** A citation source marker rendered as a colored initial. */
export interface CitationMonogramVisual {
  readonly kind: 'monogram';
  readonly monogram: string;
  readonly color: string;
}

/** The image, source-category icon, or monogram selected to identify a citation source. */
export type CitationSourceVisual =
  | CitationImageVisual
  | CitationTypeIconVisual
  | CitationMonogramVisual;

const KNOWN_TYPE_LABELS: Record<CitationTypeIcon, string> = {
  web: 'Web',
  file: 'File',
  app: 'App',
  memory: 'Memory',
  generic: 'Generic',
};

/** Extract a hostname with leading `www.` removed; null for missing/invalid URLs, empty for hostless URLs. This does not approve navigation. */
export function deriveDomain(url?: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Trim explicit sourceType, else infer 'web' from any truthy URL, else 'unknown'; no URL validation. */
export function deriveSourceType(c: Citation): string {
  const explicit = c.sourceType?.trim();
  if (explicit) return explicit;
  return c.url ? 'web' : 'unknown';
}

/** Uppercased first letter of the domain (or title) for the monogram chip. */
export function deriveMonogram(c: Citation): string {
  const seed = deriveDomain(c.url) ?? c.title ?? '';
  const ch = seed.trim().charAt(0);
  return ch ? ch.toUpperCase() : '?';
}

/** Deterministic hue in [0,360) from a seed string (stable monogram color). */
export function monogramHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) % 360;
  }
  return h;
}

/** Format a publication month/year in the host locale and timezone; null when missing or invalid. */
export function formatPublished(value?: string | number | Date): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
}

/** Deterministic monogram-chip background color (stable per source). */
export function monogramColor(c: Citation): string {
  const seed = deriveDomain(c.url) ?? c.title ?? '?';
  return `hsl(${monogramHue(seed)} 60% 45%)`;
}

function isKnownType(type: string): type is CitationTypeIcon {
  return Object.prototype.hasOwnProperty.call(KNOWN_TYPE_LABELS, type);
}

function readableSourceTypeLabel(type: string): string | null {
  const words = type.replace(/[-_\s]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : null;
}

/**
 * Derive normalized source-type metadata for badges, icons, and tone tokens.
 */
export function citationTypeMeta(c: Citation): CitationTypeMeta {
  const type = deriveSourceType(c);
  const canonicalType = type.toLowerCase();
  if (isKnownType(canonicalType)) {
    return {
      type: canonicalType,
      label: KNOWN_TYPE_LABELS[canonicalType],
      icon: canonicalType,
      tone: canonicalType,
      isKnown: true,
    };
  }

  return {
    type,
    label: type === 'unknown' ? null : readableSourceTypeLabel(type),
    icon: 'generic',
    tone: 'generic',
    isKnown: false,
  };
}

/**
 * Return a fresh image, type-icon, or monogram descriptor without fetching or approving URLs.
 */
export function citationSourceVisual(c: Citation): CitationSourceVisual {
  const iconUrl = c.iconUrl?.trim();
  if (iconUrl) {
    return { kind: 'image', iconUrl };
  }

  const meta = citationTypeMeta(c);
  if (meta.icon !== 'web') {
    return {
      kind: 'type-icon',
      icon: meta.icon,
      tone: meta.tone,
      label: meta.label,
    };
  }

  return {
    kind: 'monogram',
    monogram: deriveMonogram(c),
    color: monogramColor(c),
  };
}

/** Human label for the source-type badge; null when type is 'unknown'. */
export function citationTypeLabel(c: Citation): string | null {
  return citationTypeMeta(c).label;
}
