export type TemplateId = 'x-card' | 'og-card';

export interface CardInput {
  template: TemplateId;
  /** Headline. Required. Archivo Black, large. */
  title: string;
  /** Supporting line under the headline. Optional. */
  subtitle?: string;
  /** Kicker above the headline, under the rail. Optional, uppercased, mono.
   * Defaults to brand.defaultEyebrow. */
  eyebrow?: string;
  /** Bottom-left attribution. When present, replaces the trust pills. */
  author?: { name: string; role?: string };
}

export interface RenderedCard {
  png: Buffer;
  width: number;
  height: number;
  contentType: 'image/png';
}
