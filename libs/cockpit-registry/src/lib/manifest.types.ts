export type CockpitProduct =
  | 'deep-agents'
  | 'langgraph'
  | 'ag-ui'
  | 'render'
  | 'chat'
  /**
   * The one-capability-many-runtimes axis (`cockpit/runtimes/<runtime>/`):
   * non-LangGraph AG-UI backends measured against the same Agent contract.
   */
  | 'runtimes';

export type CockpitSection = 'getting-started' | 'core-capabilities';

export type CockpitPageId =
  | 'overview'
  | 'build'
  | 'prompts'
  | 'code'
  | 'testing';

export type CockpitLanguage = 'python' | 'typescript';

/** UI implementation, independent of backend language and runtime adapter. */
export type CockpitFrontend = 'angular' | 'react';

export type RuntimeAdapter = 'langgraph' | 'ag-ui' | 'none';

export type WorkspaceMode = 'Docs' | 'Run' | 'Code' | 'API';

export interface WorkspaceIdentity {
  id: string;
  product: CockpitProduct;
  section: string;
  topic: string;
  page: string;
  language: CockpitLanguage;
  title: string;
  docsPath: string;
  runtimeAdapter: RuntimeAdapter;
  availableModes: readonly WorkspaceMode[];
}

export type WorkspaceResolution =
  | { kind: 'mapped'; identity: WorkspaceIdentity }
  | {
      kind: 'docs-only';
      docsPath: string;
      title: string;
      unavailableReason: 'no-workspace-capability';
    };

export type CockpitEntryKind = 'docs-only' | 'capability';

export type CockpitRuntimeClass =
  | 'docs-only'
  | 'browser'
  | 'local-service'
  | 'secret-gated'
  | 'deployed-service';

export type CockpitLifecycleStatus =
  | 'planned'
  | 'implemented'
  | 'docs-authored'
  | 'cockpit-integrated'
  | 'smoke-tested'
  | 'integration-tested'
  | 'deployed';

export type CockpitIntegrationMode = 'none' | 'local' | 'secret-gated';

export interface CockpitTestingContract {
  smokeTarget: string | null;
  integrationTarget: string | null;
  integrationMode: CockpitIntegrationMode;
  deploySmokePath: string;
}

export interface CockpitManifestIdentity {
  product: CockpitProduct;
  section: CockpitSection;
  topic: string;
  page: CockpitPageId;
  language: CockpitLanguage;
}

export interface CockpitManifestEntry extends CockpitManifestIdentity {
  id: string;
  capabilityId: string;
  title: string;
  summary: string;
  officialDocsId: string;
  canonicalLanguage: CockpitLanguage;
  supportedLanguages: CockpitLanguage[];
  equivalentPages: Partial<Record<CockpitLanguage, CockpitManifestIdentity>>;
  fallbackTarget: CockpitManifestIdentity;
  entryKind: CockpitEntryKind;
  runtimeClass: CockpitRuntimeClass;
  docsPath: string;
  runtimeAdapter: RuntimeAdapter;
  availableModes: readonly WorkspaceMode[];
  promptAssetPaths: string[];
  codeAssetPaths: string[];
  implementationStatus: CockpitLifecycleStatus;
  docsStatus: CockpitLifecycleStatus;
  testStatus: CockpitLifecycleStatus;
  deploymentStatus: CockpitLifecycleStatus;
  testingContract: CockpitTestingContract;
}
