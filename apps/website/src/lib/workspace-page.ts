import {
  cockpitManifest,
  deriveAvailableModes,
  getFrontendCapabilityDescriptor,
  type CockpitManifestIdentity,
  resolveDocsWorkspace,
  parseDocsNarrativePath,
  docsNarrativeHref,
  type WorkspaceResolution,
} from '@threadplane/cockpit-registry';
import {
  buildNavigationTree,
  getContentBundle,
  getWorkspacePresentation,
  type ContentBundle,
  type NavigationProduct,
  type WorkspacePresentation,
} from '@threadplane/cockpit-shell';
import { resolveNarrativeDocument } from './docs-catalog';
import type { ExampleCodeContext } from './example-code';

export interface WebsiteWorkspaceVariant {
  readonly resolution: WorkspaceResolution;
  readonly presentation: WorkspacePresentation;
  readonly contentBundle: ContentBundle;
}

export interface WebsiteWorkspacePageModel extends WebsiteWorkspaceVariant {
  readonly navigationTree: NavigationProduct[];
}

export function getWebsiteDocumentResolution(options: {
  docsPath: string;
  title: string;
}): WorkspaceResolution {
  let resolution = resolveDocsWorkspace(options.docsPath, options.title);
  const document = parseDocsNarrativePath(options.docsPath);
  const frontend =
    document?.scope === 'framework' ? document.framework : 'angular';
  if (resolution.kind === 'mapped') {
    const descriptor = getFrontendCapabilityDescriptor(
      resolution.identity as CockpitManifestIdentity,
      frontend
    );
    if (descriptor) {
      resolution = {
        ...resolution,
        identity: {
          ...resolution.identity,
          id:
            frontend === 'react'
              ? `${resolution.identity.id}:react`
              : resolution.identity.id,
          title:
            frontend === 'react' ? descriptor.title : resolution.identity.title,
          availableModes: [
            ...deriveAvailableModes({
              docsPath: options.docsPath,
              descriptor,
            }),
          ],
        },
      };
    } else if (frontend === 'react') {
      resolution = {
        kind: 'docs-only',
        docsPath: options.docsPath,
        title: options.title,
        unavailableReason: 'no-workspace-capability',
      };
    }
  }
  return resolution;
}

export async function getWebsiteWorkspacePage(options: {
  docsPath: string;
  title: string;
}): Promise<WebsiteWorkspacePageModel> {
  const resolution = getWebsiteDocumentResolution(options);
  const document = parseDocsNarrativePath(options.docsPath);
  const frontend =
    document?.scope === 'framework' ? document.framework : 'angular';
  const presentation = getWorkspacePresentation(resolution, frontend);

  return {
    resolution,
    presentation,
    contentBundle: await getContentBundle(presentation),
    navigationTree: buildNavigationTree(cockpitManifest).map((product) => ({
      ...product,
      sections: product.sections.map((section) => ({
        ...section,
        entries: section.entries.flatMap((entry) => {
          const target = parseDocsNarrativePath(entry.docsPath);
          const descriptor = getFrontendCapabilityDescriptor(entry, frontend);
          const href =
            target?.scope === 'framework'
              ? docsNarrativeHref({ ...target, framework: frontend })
              : entry.docsPath;
          if (!resolveNarrativeDocument(href)) return [];
          if (frontend === 'react' && !descriptor) return [];
          return [
            {
              ...entry,
              id: frontend === 'react' ? `${entry.id}:react` : entry.id,
              docsPath:
                target?.scope === 'framework'
                  ? docsNarrativeHref({ ...target, framework: frontend })
                  : entry.docsPath,
            },
          ];
        }),
      })),
    })),
  };
}

/**
 * The example a docs page may include code from. Null for docs-only pages and
 * for capabilities that declare no code assets, so `<ExampleCode>` on such a
 * page throws at build time instead of rendering nothing.
 */
export function getExampleCodeContext(
  model: WebsiteWorkspaceVariant
): ExampleCodeContext | null {
  const { presentation, contentBundle } = model;
  if (presentation.kind !== 'capability') return null;
  const assetPaths = [
    ...presentation.codeAssetPaths,
    ...presentation.backendAssetPaths,
  ];
  if (assetPaths.length === 0) return null;
  return {
    docsPath: presentation.docsPath,
    assetPaths,
    sources: contentBundle.codeSources,
  };
}
