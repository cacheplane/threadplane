import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIN_READABLE_PX } from './tokens';
import { DEMO_META, SOCIAL_CARD_SIZE } from '../../lib/demo-meta';

const CARD_FILE = join(__dirname, 'demo-card.tsx');
const CHROME_FILE = join(__dirname, 'chrome.tsx');
const ROUTES = ['langgraph', 'ag-ui'].map((key) => join(__dirname, '..', 'demo-card', key, 'route.tsx'));

function fontSizes(source: string): number[] {
  return [...source.matchAll(/fontSize:\s*(\d+)/gu)].map((m) => Number(m[1]));
}

describe('demo cards', () => {
  it('render at the Open Graph feed size the demos advertise', () => {
    expect(SOCIAL_CARD_SIZE).toEqual({ width: 1200, height: 630 });
    expect(readFileSync(CARD_FILE, 'utf8')).toContain('SOCIAL_CARD_SIZE');
  });

  /**
   * Timelines and unfurls downscale this image hard. Below the floor a glyph
   * stops being read and becomes texture. The Itinerary chrome is scanned
   * too, because its rows are new; the rest of chrome.tsx (the frame's
   * decorative 16px address pill) predates this card and is not re-litigated.
   */
  it('set no type below the readable floor', () => {
    const chrome = readFileSync(CHROME_FILE, 'utf8');
    const itineraryStart = chrome.indexOf('export function Itinerary');
    expect(itineraryStart).toBeGreaterThan(-1);
    for (const source of [readFileSync(CARD_FILE, 'utf8'), chrome.slice(itineraryStart)]) {
      const sizes = fontSizes(source);
      expect(sizes.length).toBeGreaterThan(0);
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(MIN_READABLE_PX);
    }
  });

  /**
   * Inlining copy into a route is how a brand asset ends up asserting a title
   * that was replaced months ago. The routes take everything from demo-meta.
   */
  it.each(ROUTES)('%s takes its copy from demo-meta, not literals', (route) => {
    const source = readFileSync(route, 'utf8');
    expect(source).toContain("from '../../../lib/demo-meta'");
    expect(source).toContain("export const dynamic = 'force-static'");
    for (const meta of DEMO_META) {
      expect(source).not.toContain(meta.title);
      expect(source).not.toContain(meta.description);
    }
  });

  it('frames each demo under its own host', () => {
    const source = readFileSync(CARD_FILE, 'utf8');
    expect(source).toContain('new URL(meta.origin).host');
    expect(source).toContain('<Itinerary />');
    expect(source).toContain('<Conversation />');
  });
});
