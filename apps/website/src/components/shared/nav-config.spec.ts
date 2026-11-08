import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NAV_TRIGGERS, navItems } from './nav-config';
import { resolveNarrativeDocument } from '../../lib/docs-catalog';
import { getAllSolutionSlugs } from '../../lib/solutions-data';

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app');
const TAXONOMY = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', '..', '..',
  'docs', 'gtm', 'taxonomy.md',
);

/**
 * `/docs/:library/:section/:slug` is a dynamic route, so a page file cannot
 * prove it exists. `docsConfig` is what the route renders from, so that is
 * what a docs href has to be checked against.
 */
function docsHrefResolves(href: string): boolean {
  if (href === '/docs') return true;
  return Boolean(resolveNarrativeDocument(href)) || existsSync(join(APP_ROOT, ...href.split('/').filter(Boolean), 'page.tsx'));
}

function staticHrefResolves(href: string): boolean {
  return existsSync(join(APP_ROOT, ...href.split('/').filter(Boolean), 'page.tsx'));
}

/**
 * `/solutions/:slug` is a dynamic route, so — like docs — a page file cannot
 * prove it exists. `getAllSolutionSlugs()` is what `generateStaticParams`
 * renders from, so that is what a solutions href has to be checked against.
 */
function solutionsHrefResolves(href: string): boolean {
  if (href === '/solutions') return true;
  const [, , slug] = href.split('/');
  return Boolean(slug) && getAllSolutionSlugs().includes(slug);
}

describe('nav-config', () => {
  it('points every internal link at a route that exists', () => {
    const unresolved = navItems()
      .filter((item) => !item.external)
      .filter((item) => {
        if (item.href.startsWith('/docs')) return !docsHrefResolves(item.href);
        if (item.href.startsWith('/solutions')) return !solutionsHrefResolves(item.href);
        return !staticHrefResolves(item.href);
      })
      .map((item) => `${item.label} → ${item.href}`);

    expect(unresolved).toEqual([]);
  });

  it('sends every external link somewhere over https', () => {
    const bad = navItems()
      .filter((item) => item.external)
      .filter((item) => !item.href.startsWith('https://'))
      .map((item) => item.label);

    expect(bad).toEqual([]);
  });

  it('gives every destination a unique analytics id', () => {
    const ids = navItems().map((item) => item.ctaId);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every panel item a label and a description', () => {
    const thin = navItems()
      .filter((item) => !item.label.trim() || !item.description.trim())
      .map((item) => item.ctaId);

    expect(thin).toEqual([]);
  });

  it('gives demos their own top-level dropdown', () => {
    expect(NAV_TRIGGERS.map((trigger) => trigger.label)).toEqual([
      'Libraries',
      'Docs',
      'Demos',
      'Solutions',
      'Pricing',
    ]);
    const demos = NAV_TRIGGERS.find((trigger) => trigger.id === 'demos');
    const docs = NAV_TRIGGERS.find((trigger) => trigger.id === 'docs');
    expect(demos?.kind === 'panel' && demos.panel.columns.flatMap((column) => column.items).map((item) => item.href)).toEqual([
      'https://demo.threadplane.ai',
      'https://ag-ui.threadplane.ai',
    ]);
    expect(docs?.kind === 'panel' && docs.panel.columns.flatMap((column) => column.items).some((item) => item.external)).toBe(false);
  });

  /**
   * The GTM taxonomy is the register analytics work reads to know which
   * `cta_id`s exist. It is hand-maintained prose, and it had silently drifted
   * before the navbar rebuild — it still listed `nav_get_started`, `nav_npm`
   * and `nav_cockpit`, none of which the nav emitted any more.
   *
   * The nav's ids are data, so the doc can be checked against them instead of
   * trusted. Only the `nav_` surface is asserted: `mobile_nav_` is the same
   * list with a different prefix, applied by `trackNavItem`, and the doc says
   * so once rather than duplicating twenty entries.
   */
  it('documents every nav cta_id in the GTM taxonomy', () => {
    const taxonomy = readFileSync(TAXONOMY, 'utf8');
    const undocumented = navItems()
      .map((item) => `nav_${item.ctaId}`)
      .filter((id) => !taxonomy.includes(id));

    expect(undocumented).toEqual([]);
  });
});
