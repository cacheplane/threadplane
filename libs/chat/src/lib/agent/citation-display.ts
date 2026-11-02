// Pure, DOM-free display helpers over Citation. Shared by the inline marker,
// the preview card, and the sources panel so provenance rendering stays DRY.
import type { Citation } from './citation';

/** Supported source categories used for citation icons and visual tones. */
export type CitationTypeIcon = 'web' | 'file' | 'app' | 'memory' | 'generic';

/** Normalized source type, label, icon, tone, and recognition status for citation display. */
export interface CitationTypeMeta {
  type: string;
  label: string | null;
  icon: CitationTypeIcon;
  tone: CitationTypeIcon;
  isKnown: boolean;
}

/** A citation source marker rendered from a provider image URL. */
export interface CitationImageVisual {
  kind: 'image';
  iconUrl: string;
}

/** A citation source marker rendered with a source-category icon and tone. */
export interface CitationTypeIconVisual {
  kind: 'type-icon';
  icon: CitationTypeIcon;
  tone: CitationTypeIcon;
  label: string | null;
}

/** A citation source marker rendered as a colored initial. */
export interface CitationMonogramVisual {
  kind: 'monogram';
  monogram: string;
  color: string;
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

/** Hostname of `url` with a leading `www.` removed; null if absent/malformed. */
export function deriveDomain(url?: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Explicit `sourceType`, else 'web' inferred from a url, else 'unknown'. */
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

/** Short freshness label (e.g. "Apr 2024"); null when absent or unparseable. */
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
 * Choose the visual source marker for a citation: provider image, type icon, or monogram.
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
