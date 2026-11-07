import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { capabilityModules, frontendCapabilityModules } from '@threadplane/cockpit-registry';
import entrypoints from '../../content/api/entrypoints.json';
import { specialDocsPages } from './docs-config';
import {
  documentCatalog,
  getDocumentVariant,
  getFrameworkDocuments,
  getNarrativeDocuments,
  resolveNarrativeDocument,
} from './docs-catalog';

const contentRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../content/docs');

describe('explicit narrative document catalog', () => {
  it('routes every authored MDX file through the catalog or a special docs page', () => {
    const authored = fs.readdirSync(contentRoot, { recursive: true })
      .map(String)
      .filter(file => file.endsWith('.mdx'))
      .map(file => file.split(path.sep).join('/'))
      .sort();
    const routed = [
      ...getNarrativeDocuments().map(doc => doc.source),
      ...specialDocsPages.map(page => page.contentPath),
    ].sort();

    // The forward check below catches missing files; this inverse check also
    // catches articles left on disk after their navigation/route is removed.
    expect(authored).toEqual(routed);
  });

  it('keeps logical identities and canonical variant destinations unique', () => {
    expect(documentCatalog).toHaveLength(118);
    expect(new Set(documentCatalog.map(doc => doc.id)).size).toBe(documentCatalog.length);
    const variants = getNarrativeDocuments();
    expect(variants).toHaveLength(161);
    expect(new Set(variants.map(doc => doc.href)).size).toBe(variants.length);
    expect(new Set(variants.map(doc => doc.source)).size).toBe(variants.length);
  });

  it('resolves exact framework variants without substituting Angular for missing React', () => {
    expect(getDocumentVariant('langgraph/guides/streaming', 'react')).toMatchObject({
      scope: 'react', source: 'react/langgraph/guides/streaming.mdx',
      href: '/docs/react/langgraph/guides/streaming',
    });
    expect(getDocumentVariant('langgraph/getting-started/installation', 'react')).toBeUndefined();
    expect(resolveNarrativeDocument('/docs/react/langgraph/getting-started/installation')).toBeUndefined();
    expect(resolveNarrativeDocument('/docs/langgraph/guides/streaming?frontend=react')).toBeUndefined();
    expect(resolveNarrativeDocument('/docs/angular/langgraph/guides/streaming?frontend=react')?.scope).toBe('angular');
  });

  it('exposes shared middleware once and includes it in each framework inventory', () => {
    const shared = getNarrativeDocuments('shared');
    expect(shared).toHaveLength(4);
    for (const doc of shared) {
      expect(doc.library).toBe('middleware');
      expect(doc.href).toBe(`/docs/shared/${doc.id}`);
      expect(getDocumentVariant(doc.id, 'angular')).toBeUndefined();
      expect(getDocumentVariant(doc.id, 'react')).toBeUndefined();
    }
    for (const framework of ['angular', 'react'] as const) {
      const docs = getFrameworkDocuments(framework);
      expect(docs.filter(doc => doc.scope === 'shared')).toEqual(shared);
      expect(docs.every(doc => doc.scope === framework || doc.scope === 'shared')).toBe(true);
      expect(new Set(docs.map(doc => doc.id)).size).toBe(docs.length);
    }
  });

  it('gives every variant a real source, complete metadata and deterministic navigation order', () => {
    for (const doc of getNarrativeDocuments()) {
      expect(doc.title.trim(), doc.id).not.toBe('');
      expect(doc.description.trim(), doc.id).not.toBe('');
      expect(Number.isInteger(doc.order), doc.id).toBe(true);
      expect(doc.source, doc.id).toBe(`${doc.scope}/${doc.id}.mdx`);
      expect(fs.existsSync(path.join(contentRoot, doc.source)), doc.source).toBe(true);
      expect(resolveNarrativeDocument(doc.href)).toEqual(doc);
    }
  });

  it('has honest framework landing guides independently of runnable capabilities', () => {
    for (const framework of ['angular', 'react'] as const) {
      const doc = getDocumentVariant('getting-started/introduction', framework)!;
      expect(doc.library).toBeNull();
      expect(doc.href).toBe(`/docs/${framework}/getting-started/introduction`);
      expect(doc).not.toHaveProperty('capabilityId');
      const source = fs.readFileSync(path.join(contentRoot, doc.source), 'utf8');
      expect(source).toContain(`/docs/${framework}/langgraph/guides/streaming`);
      if (framework === 'react') {
        expect(source).toMatch(/private.*source.build/i);
        expect(source).not.toMatch(/npm (?:install|i) @threadplane\/react/);
      }
    }
  });

  it('offers the same workbench journey in each framework with honest runnable links', () => {
    for (const framework of ['angular', 'react'] as const) {
      const doc = getDocumentVariant('getting-started/workbench', framework)!;
      expect(doc?.href).toBe(`/docs/${framework}/getting-started/workbench`);
      expect(doc.lessonId).toBeUndefined();
      const source = fs.readFileSync(path.join(contentRoot, doc.source), 'utf8');
      expect(source).toContain(`<LearningWorkbench framework="${framework}"`);
      expect(source).toContain(`<DocsDemoVideo demo="streaming" frontend="${framework}"`);
      expect(source.indexOf('<DocsDemoVideo')).toBeLessThan(source.indexOf('<LearningWorkbench'));
      expect(source).toContain(`/docs/${framework}/langgraph/guides/streaming`);
      expect(source).toContain('fixture');
      const introduction = getDocumentVariant('getting-started/introduction', framework)!;
      expect(fs.readFileSync(path.join(contentRoot, introduction.source), 'utf8')).toContain(doc.href);
    }
  });
});


it('validates optional lesson and API associations without requiring a lesson', () => {
  const lessons = [...capabilityModules, ...frontendCapabilityModules];
  for (const doc of getNarrativeDocuments()) {
    if (doc.lessonId) {
      const lesson = lessons.find(lesson => lesson.id === doc.lessonId);
      expect(lesson, doc.href).toBeDefined();
      expect(lesson?.docsPath, doc.href).toBe(doc.href);
      expect(lesson?.frontend ?? 'angular', doc.href).toBe(doc.scope);
    }
    for (const id of doc.apiEntrypointIds ?? []) {
      const api = entrypoints.find(entry => entry.id === id);
      expect(api, doc.href).toBeDefined();
      expect([doc.scope, 'shared'], doc.href).toContain(api?.framework);
    }
  }
  expect(getDocumentVariant('getting-started/introduction', 'react')?.lessonId).toBeUndefined();
});
