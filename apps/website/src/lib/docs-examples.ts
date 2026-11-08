import {
  cockpitManifest,
  getFrontendCapabilityDescriptor,
  resolveDocsWorkspace,
  type DocsFramework,
} from '@threadplane/cockpit-registry';
import { getNarrativeDocuments } from './docs-catalog';
import { getLibraryConfig, type LibraryId } from './docs-config';

export interface DocsExample {
  href: string;
  title: string;
  description: string;
  framework: DocsFramework;
  library: string;
  libraryLabel: string;
}

/** Only publish destinations whose framework has an actual registered runtime. */
export function getDocsExamples(): DocsExample[] {
  const seen = new Set<string>();
  return getNarrativeDocuments()
    .flatMap((document) => {
      if (document.scope === 'shared') return [];
      const resolution = resolveDocsWorkspace(document.href, document.title);
      if (resolution.kind !== 'mapped') return [];
      const entry = cockpitManifest.find(
        (candidate) => candidate.id === resolution.identity.id
      );
      if (!entry) return [];
      const descriptor = getFrontendCapabilityDescriptor(entry, document.scope);
      if (!descriptor?.runtimeUrl) return [];
      const key = `${document.scope}:${descriptor.runtimeUrl}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [
        {
          href: `${document.href}?mode=run`,
          title: descriptor.title.replace(
            /\s*\((?:Python|React|Angular)\)$/u,
            ''
          ),
          description: document.description,
          framework: document.scope,
          library: document.library ?? resolution.identity.product,
          libraryLabel:
            getLibraryConfig(document.library as LibraryId)?.title ??
            resolution.identity.product,
        },
      ];
    })
    .sort(
      (a, b) =>
        a.library.localeCompare(b.library) || a.title.localeCompare(b.title)
    );
}
