import {
  cockpitManifest,
  deriveAvailableModes,
  getFrontendCapabilityDescriptor,
  type CockpitManifestIdentity,
  resolveDocsWorkspace,
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
import type { ExampleCodeContext } from './example-code';

export interface WebsiteWorkspaceVariant {
  readonly resolution: WorkspaceResolution;
  readonly presentation: WorkspacePresentation;
  readonly contentBundle: ContentBundle;
}

export interface WebsiteWorkspacePageModel extends WebsiteWorkspaceVariant {
  readonly frontendVariants?: { readonly react?: WebsiteWorkspaceVariant };
  readonly navigationTree: NavigationProduct[];
}

export async function getWebsiteWorkspacePage(options: {
  docsPath: string;
  title: string;
}): Promise<WebsiteWorkspacePageModel> {
  const resolution = resolveDocsWorkspace(options.docsPath, options.title);
  const presentation = getWorkspacePresentation(resolution);
  let react: WebsiteWorkspaceVariant | undefined;
  if (resolution.kind === 'mapped') {
    const descriptor = getFrontendCapabilityDescriptor(
      resolution.identity as CockpitManifestIdentity,
      'react'
    );
    if (descriptor) {
      const reactResolution: WorkspaceResolution = {
        ...resolution,
        identity: {
          ...resolution.identity,
          id: `${resolution.identity.id}:react`,
          title: descriptor.title,
          availableModes: [
            ...deriveAvailableModes({
              docsPath: descriptor.docsPath,
              descriptor,
            }),
          ],
        },
      };
      const reactPresentation = getWorkspacePresentation(
        reactResolution,
        'react'
      );
      react = {
        resolution: reactResolution,
        presentation: reactPresentation,
        contentBundle: await getContentBundle(reactPresentation),
      };
    }
  }

  return {
    resolution,
    presentation,
    contentBundle: await getContentBundle(presentation),
    navigationTree: buildNavigationTree(cockpitManifest),
    ...(react ? { frontendVariants: { react } } : {}),
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
