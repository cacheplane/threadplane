import { getNarrativeDocuments } from '../docs-catalog';
import 'server-only';
import { createHash } from 'node:crypto';
import { apiPagePaths, readApiIndex } from '../api-reference';
import { getAllSlugs } from '../blog';
import { specialDocsPages } from '../docs-config';
import type { WebsiteCatalog, WebsiteTopic } from './website-metadata';

let cached: WebsiteCatalog | undefined;
export function websiteContentCatalog(): WebsiteCatalog {
  if (cached) return cached;
  const catalog: Record<string, { contentId: string; topic: WebsiteTopic }> =
    {};
  const add = (
    path: string,
    topic: WebsiteTopic,
    contentId = path === '/' ? 'home' : path.slice(1).toLowerCase()
  ) => {
    if (/^[a-z0-9][a-z0-9_/-]{0,119}$/u.test(contentId))
      catalog[path] = { contentId, topic };
  };
  for (const path of [
    '/',
    '/docs',
    '/docs/api',
    '/contact',
    '/blog',
    '/langgraph',
    '/chat',
    '/render',
    '/ag-ui',
  ])
    add(path, 'getting_started');
  add('/pricing', 'pricing');
  add('/privacy', 'security');
  for (const page of getNarrativeDocuments()) {
    add(page.href, page.section === 'getting-started' ? 'getting_started' : page.slug.includes('deploy') ? 'deployment' : 'architecture');
  }
  for (const path of apiPagePaths(readApiIndex())) {
    if (path === '/docs/api') continue;
    // Export identities are case-sensitive; collection IDs must be lowercase.
    const prefix = path
      .slice(1)
      .toLowerCase()
      .replace(/[^a-z0-9_/-]/gu, '-')
      .slice(0, 106);
    const identity = createHash('sha256')
      .update(path)
      .digest('hex')
      .slice(0, 12);
    add(path, 'architecture', `${prefix}-${identity}`);
  }
  for (const page of specialDocsPages) add(page.path, 'comparison');
  for (const slug of getAllSlugs()) add(`/blog/${slug}`, 'architecture');
  cached = Object.freeze(catalog);
  return cached;
}
export function isKnownWebsiteContent(
  contentId: string,
  topic: string
): boolean {
  return Object.values(websiteContentCatalog()).some(
    (content) => content.contentId === contentId && content.topic === topic
  );
}
