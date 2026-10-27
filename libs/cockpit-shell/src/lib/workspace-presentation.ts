import {
  getCapabilityDescriptor,
  getFrontendCapabilityDescriptor,
  resolveManifestLanguage,
  type CockpitLanguage,
  type CockpitFrontend,
  type CockpitManifestEntry,
  type CockpitManifestIdentity,
  type WorkspaceIdentity,
  type WorkspaceResolution,
} from '@threadplane/cockpit-registry';

export interface ResolveCockpitEntryOptions {
  manifest: CockpitManifestEntry[];
  product: CockpitManifestEntry['product'];
  section: CockpitManifestEntry['section'];
  topic: string;
  page: CockpitManifestEntry['page'];
  language: CockpitLanguage;
}

export interface NavigationSection {
  section: CockpitManifestEntry['section'];
  entries: CockpitManifestEntry[];
}

export interface NavigationProduct {
  product: CockpitManifestEntry['product'];
  sections: NavigationSection[];
}

export type CapabilityPresentation =
  | {
      kind: 'docs-only';
      entry: CockpitManifestEntry;
      docsPath: string;
    }
  | {
      kind: 'capability';
      entry: CockpitManifestEntry;
      docsPath: string;
      promptAssetPaths: string[];
      codeAssetPaths: string[];
      backendAssetPaths: string[];
      runtimeUrl?: string;
      devPort?: number;
    };

export type WorkspacePresentation =
  | {
      kind: 'docs-only';
      docsPath: string;
      title: string;
      runnable: false;
    }
  | {
      kind: 'capability';
      identity: WorkspaceIdentity;
      docsPath: string;
      promptAssetPaths: string[];
      codeAssetPaths: string[];
      backendAssetPaths: string[];
      runtimeUrl?: string;
      devPort?: number;
      runnable: boolean;
    };

const cloneEntry = (entry: CockpitManifestEntry): CockpitManifestEntry => ({
  ...entry,
  supportedLanguages: [...entry.supportedLanguages],
  equivalentPages: Object.fromEntries(
    Object.entries(entry.equivalentPages).map(([language, identity]) => [
      language,
      identity ? { ...identity } : identity,
    ])
  ) as CockpitManifestEntry['equivalentPages'],
  fallbackTarget: { ...entry.fallbackTarget },
  availableModes: [...entry.availableModes],
  promptAssetPaths: [...entry.promptAssetPaths],
  codeAssetPaths: [...entry.codeAssetPaths],
  testingContract: { ...entry.testingContract },
});

const cloneWorkspaceIdentity = (
  identity: WorkspaceIdentity
): WorkspaceIdentity => ({
  ...identity,
  availableModes: [...identity.availableModes],
});

export const toCockpitPath = (entry: CockpitManifestEntry): string =>
  `/${entry.product}/${entry.section}/${entry.topic}/${entry.page}/${entry.language}`;

export const resolveCockpitEntry = ({
  manifest,
  product,
  section,
  topic,
  page,
  language,
}: ResolveCockpitEntryOptions): CockpitManifestEntry => {
  const exactEntry = manifest.find(
    (entry) =>
      entry.product === product &&
      entry.section === section &&
      entry.topic === topic &&
      entry.page === page &&
      entry.language === language
  );

  if (exactEntry) {
    return exactEntry;
  }

  const canonicalEntry = manifest.find(
    (entry) =>
      entry.product === product &&
      entry.section === section &&
      entry.topic === topic &&
      entry.page === page
  );

  if (canonicalEntry) {
    return resolveManifestLanguage({
      manifest,
      entry: canonicalEntry,
      language,
    });
  }

  const fallbackOverview = manifest.find(
    (entry) =>
      entry.product === product &&
      entry.section === 'getting-started' &&
      entry.topic === 'overview' &&
      entry.page === 'overview' &&
      entry.language === 'python'
  );

  if (!fallbackOverview) {
    throw new Error(
      `No manifest entry found for ${product}/${section}/${topic}/${page}`
    );
  }

  return resolveManifestLanguage({
    manifest,
    entry: fallbackOverview,
    language,
  });
};

export const buildNavigationTree = (
  manifest: CockpitManifestEntry[]
): NavigationProduct[] => {
  const products: CockpitManifestEntry['product'][] = [
    'deep-agents',
    'langgraph',
    'ag-ui',
    'render',
    'chat',
    'runtimes',
  ];
  const sections: CockpitManifestEntry['section'][] = [
    'getting-started',
    'core-capabilities',
  ];
  const uniqueEntries = manifest.filter(
    (entry, index, entries) =>
      entries.findIndex(
        (candidate) =>
          candidate.product === entry.product &&
          candidate.section === entry.section &&
          candidate.topic === entry.topic &&
          candidate.page === entry.page
      ) === index
  );

  return products.map((product) => ({
    product,
    sections: sections.map((section) => ({
      section,
      entries: uniqueEntries
        .filter(
          (entry) => entry.product === product && entry.section === section
        )
        .map(cloneEntry),
    })),
  }));
};

export const getCapabilityPresentation = (
  entry: CockpitManifestEntry
): CapabilityPresentation => {
  if (entry.entryKind === 'docs-only') {
    return {
      kind: 'docs-only',
      entry: cloneEntry(entry),
      docsPath: entry.docsPath,
    };
  }

  // The registry lookup preserves the exact-language preference and the
  // single-lane fallback needed by runtimes/mastra.
  const module = getCapabilityDescriptor(entry);

  return {
    kind: 'capability',
    entry: cloneEntry(entry),
    docsPath: entry.docsPath,
    promptAssetPaths: [...(module?.promptAssetPaths ?? entry.promptAssetPaths)],
    codeAssetPaths: [...(module?.codeAssetPaths ?? entry.codeAssetPaths)],
    backendAssetPaths: [...(module?.backendAssetPaths ?? [])],
    runtimeUrl: module?.runtimeUrl,
    devPort: module?.devPort,
  };
};

/**
 * Shapes registry route resolution for server-side Website consumers without
 * importing either application. Descriptor-backed arrays are mutable clones.
 */
export const getWorkspacePresentation = (
  resolution: WorkspaceResolution,
  frontend: CockpitFrontend = 'angular'
): WorkspacePresentation => {
  if (resolution.kind === 'docs-only') {
    return {
      kind: 'docs-only',
      docsPath: resolution.docsPath,
      title: resolution.title,
      runnable: false,
    };
  }

  // WorkspaceIdentity is registry-derived from CockpitManifestIdentity, but
  // intentionally exposes string section/page fields to general consumers.
  const descriptor = getFrontendCapabilityDescriptor(
    resolution.identity as CockpitManifestIdentity,
    frontend
  );

  if (!descriptor) {
    return {
      kind: 'docs-only',
      docsPath: resolution.identity.docsPath,
      title: resolution.identity.title,
      runnable: false,
    };
  }

  return {
    kind: 'capability',
    identity: cloneWorkspaceIdentity(resolution.identity),
    docsPath: resolution.identity.docsPath,
    promptAssetPaths: [...descriptor.promptAssetPaths],
    codeAssetPaths: [...descriptor.codeAssetPaths],
    backendAssetPaths: [...(descriptor.backendAssetPaths ?? [])],
    runtimeUrl: descriptor.runtimeUrl,
    devPort: descriptor.devPort,
    runnable: Boolean(descriptor.runtimeUrl || descriptor.devPort),
  };
};
