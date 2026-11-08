import { createMessageContent, type MessageRow } from './index.js';
const content = createMessageContent();
declare const row: MessageRow;
// @ts-expect-error Rows are readonly.
row.id = 'changed';
// @ts-expect-error Reasoning snapshots are readonly.
row.reasoning = undefined;
if (row.reasoning) {
  // @ts-expect-error Owned document text is readonly.
  row.reasoning.document.content = 'changed';
}
// @ts-expect-error project requires a snapshot.
content.project();
content.dispose();

import type { Citation as DisplayCitation } from '@threadplane/core';
import type {
  CitationTypeIcon,
  CitationTypeMeta,
  CitationImageVisual,
  CitationTypeIconVisual,
  CitationMonogramVisual,
  CitationSourceVisual,
} from './index.js';
type CitationDisplayEqual<A, B> = (<T>() => T extends A ? 1 : 2) extends <
  T
>() => T extends B ? 1 : 2
  ? true
  : false;
type CitationDisplayAssert<T extends true> = T;
export type CitationTypeIconContract = CitationDisplayAssert<
  CitationDisplayEqual<
    CitationTypeIcon,
    'web' | 'file' | 'app' | 'memory' | 'generic'
  >
>;
export type CitationTypeMetaContract = CitationDisplayAssert<
  CitationDisplayEqual<
    CitationTypeMeta,
    {
      readonly type: string;
      readonly label: string | null;
      readonly icon: CitationTypeIcon;
      readonly tone: CitationTypeIcon;
      readonly isKnown: boolean;
    }
  >
>;
export type CitationImageVisualContract = CitationDisplayAssert<
  CitationDisplayEqual<
    CitationImageVisual,
    { readonly kind: 'image'; readonly iconUrl: string }
  >
>;
export type CitationTypeIconVisualContract = CitationDisplayAssert<
  CitationDisplayEqual<
    CitationTypeIconVisual,
    {
      readonly kind: 'type-icon';
      readonly icon: CitationTypeIcon;
      readonly tone: CitationTypeIcon;
      readonly label: string | null;
    }
  >
>;
export type CitationMonogramVisualContract = CitationDisplayAssert<
  CitationDisplayEqual<
    CitationMonogramVisual,
    {
      readonly kind: 'monogram';
      readonly monogram: string;
      readonly color: string;
    }
  >
>;
export type CitationSourceVisualContract = CitationDisplayAssert<
  CitationDisplayEqual<
    CitationSourceVisual,
    CitationImageVisual | CitationTypeIconVisual | CitationMonogramVisual
  >
>;
export type DeriveDomainContract = CitationDisplayAssert<
  CitationDisplayEqual<
    typeof import('./index.js').deriveDomain,
    (url?: string) => string | null
  >
>;
export type DeriveSourceTypeContract = CitationDisplayAssert<
  CitationDisplayEqual<
    typeof import('./index.js').deriveSourceType,
    (citation: DisplayCitation) => string
  >
>;
export type DeriveMonogramContract = CitationDisplayAssert<
  CitationDisplayEqual<
    typeof import('./index.js').deriveMonogram,
    (citation: DisplayCitation) => string
  >
>;
export type MonogramHueContract = CitationDisplayAssert<
  CitationDisplayEqual<
    typeof import('./index.js').monogramHue,
    (seed: string) => number
  >
>;
export type FormatPublishedContract = CitationDisplayAssert<
  CitationDisplayEqual<
    typeof import('./index.js').formatPublished,
    (value?: string | number | Date) => string | null
  >
>;
export type MonogramColorContract = CitationDisplayAssert<
  CitationDisplayEqual<
    typeof import('./index.js').monogramColor,
    (citation: DisplayCitation) => string
  >
>;
export type CitationTypeMetaFunctionContract = CitationDisplayAssert<
  CitationDisplayEqual<
    typeof import('./index.js').citationTypeMeta,
    (citation: DisplayCitation) => CitationTypeMeta
  >
>;
export type CitationTypeLabelContract = CitationDisplayAssert<
  CitationDisplayEqual<
    typeof import('./index.js').citationTypeLabel,
    (citation: DisplayCitation) => string | null
  >
>;
export type CitationSourceVisualFunctionContract = CitationDisplayAssert<
  CitationDisplayEqual<
    typeof import('./index.js').citationSourceVisual,
    (citation: DisplayCitation) => CitationSourceVisual
  >
>;

import {
  deriveDomain,
  deriveSourceType,
  deriveMonogram,
  monogramHue,
  formatPublished,
  monogramColor,
  citationTypeMeta,
  citationTypeLabel,
  citationSourceVisual,
} from './index.js';
declare const displayCitation: DisplayCitation;
const meta = citationTypeMeta(displayCitation);
// @ts-expect-error Metadata records are readonly.
meta.type = 'changed';
const visual = citationSourceVisual(displayCitation);
if (visual.kind === 'image') {
  const image: CitationImageVisual = visual;
  // @ts-expect-error Image descriptors are readonly.
  image.iconUrl = 'changed';
  // @ts-expect-error Image descriptors do not have monograms.
  void visual.monogram;
} else if (visual.kind === 'type-icon') {
  const icon: CitationTypeIconVisual = visual;
  // @ts-expect-error Type icon descriptors are readonly.
  icon.label = null;
  // @ts-expect-error Type icons do not have image URLs.
  void visual.iconUrl;
} else {
  const monogram: CitationMonogramVisual = visual;
  // @ts-expect-error Monogram descriptors are readonly.
  monogram.color = 'changed';
  // @ts-expect-error Monograms do not have type icons.
  void visual.icon;
}
// @ts-expect-error Domain input must be a URL string.
deriveDomain(12);
// @ts-expect-error Publication accepts dates, numbers and strings only.
formatPublished({});
// @ts-expect-error Hue requires a string.
monogramHue();
for (const helper of [
  deriveSourceType,
  deriveMonogram,
  monogramColor,
  citationTypeMeta,
  citationTypeLabel,
  citationSourceVisual,
]) {
  // @ts-expect-error Citation helpers require a Citation.
  helper('source');
}
