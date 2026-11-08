import { cockpitManifest } from './manifest';
import { docsNarrativeHref, parseDocsNarrativePath } from './docs-routes';
import type {
  CockpitManifestEntry,
  WorkspaceIdentity,
  WorkspaceMode,
  WorkspaceResolution,
} from './manifest.types';

export const toWorkspaceIdentity = (
  entry: CockpitManifestEntry
): WorkspaceIdentity => ({
  id: entry.id,
  product: entry.product,
  section: entry.section,
  topic: entry.topic,
  page: entry.page,
  language: entry.language,
  title: entry.title,
  docsPath: entry.docsPath,
  runtimeAdapter: entry.runtimeAdapter,
  availableModes: entry.availableModes,
});

export const getWorkspaceDestinationPath = (
  identity: Pick<WorkspaceIdentity, 'id' | 'docsPath'>
): string => {
  if (!identity.docsPath) {
    throw new Error(`Manifest entry without a docs path: ${identity.id}`);
  }
  return identity.docsPath;
};

const mapped = (entry: CockpitManifestEntry): WorkspaceResolution => ({
  kind: 'mapped',
  identity: toWorkspaceIdentity(entry),
});

export const resolveDocsWorkspace = (
  docsPath: string,
  title: string,
  manifest: readonly CockpitManifestEntry[] = cockpitManifest
): WorkspaceResolution => {
  const document = parseDocsNarrativePath(docsPath);
  const lookupPath =
    document?.scope === 'framework'
      ? docsNarrativeHref({ ...document, framework: 'angular' })
      : docsPath;
  const matches = manifest.filter((entry) => entry.docsPath === lookupPath);
  if (matches.length === 1) {
    const resolution = mapped(matches[0]);
    return resolution.kind === 'mapped'
      ? { ...resolution, identity: { ...resolution.identity, docsPath } }
      : resolution;
  }
  if (matches.length > 1) {
    throw new Error(
      `Docs path ${docsPath} is published by ${matches.length} manifest entries`
    );
  }

  return {
    kind: 'docs-only',
    docsPath,
    title,
    unavailableReason: 'no-workspace-capability',
  };
};

export const getRouteDefaultMode = (
  _resolution: WorkspaceResolution | null
): WorkspaceMode => 'Docs';

export const getCanonicalWebsiteWorkspaceHref = (
  resolution: WorkspaceResolution,
  mode: WorkspaceMode
): string => {
  const destinationPath =
    resolution.kind === 'mapped'
      ? getWorkspaceDestinationPath(resolution.identity)
      : resolution.docsPath;
  const canonicalDocsRoute =
    destinationPath === '/docs' || destinationPath.startsWith('/docs/');

  return mode === 'Docs' && canonicalDocsRoute
    ? destinationPath
    : `${destinationPath}?mode=${mode.toLowerCase()}`;
};
