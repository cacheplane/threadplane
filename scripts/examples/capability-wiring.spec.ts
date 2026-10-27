import {
  capabilities,
  capabilityModules,
  cockpitManifest,
} from '@threadplane/cockpit-registry';
import {
  auditRuntimeTargetSource,
  hasExactImportBinding,
  inspectRuntimeTargetSource,
  type AngularProviderRecord,
  type BootstrapCallRecord,
  type CanonicalProviderCall,
  type ExactImportBinding,
  type ProviderRegistrationOwner,
} from './runtime-wiring-audit';
import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import * as ts from 'typescript';
import { fileURLToPath } from 'node:url';

const cockpitRoot = fileURLToPath(new URL('../../cockpit/', import.meta.url));

function angularSourceFiles(projectRoot: string): string[] {
  const visit = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const entryPath = resolve(directory, entry.name);
      if (entry.isDirectory()) return visit(entryPath);
      return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : [];
    });

  if (!projectRoot.endsWith('/deep-agents/memory/angular'))
    return visit(resolve(projectRoot, 'src'));
  // App excludes remove test roots, but an import makes an excluded file runtime.
  const configPath = resolve(projectRoot, 'tsconfig.app.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    projectRoot
  );
  if (config.error || parsed.errors.length)
    throw Error('Invalid Memory app tsconfig');
  const files = new Set(
    parsed.fileNames.filter((name) =>
      name.startsWith(resolve(projectRoot, 'src') + '/')
    )
  );
  for (const name of files) {
    for (const imported of ts.preProcessFile(
      readFileSync(name, 'utf8'),
      true,
      true
    ).importedFiles) {
      const resolved = ts.resolveModuleName(
        imported.fileName,
        name,
        parsed.options,
        ts.sys
      ).resolvedModule?.resolvedFileName;
      if (resolved?.startsWith(resolve(projectRoot, 'src') + '/'))
        files.add(resolved);
    }
  }
  return [...files];
}

interface ExpectedRuntimeWiring {
  project: string;
  rootComponent: string;
  providerSource: string;
  assistantId?: string;
  sharedUrl?: string;
  agentRef?: string;
  retainedProviderProperties?: Readonly<Record<string, string>>;
}

const persistenceOnThreadIdExpression = `(id: string) => {
          activeThreadIdState.set(id);

          // Only add if not already tracked
          const existing = threadsState();
          if (!existing.some((t) => t.id === id)) {
            threadCounter++;
            threadsState.set([
              ...existing,
              { id, label: \`Thread \${threadCounter}\` },
            ]);
          }
        }`;

/**
 * Audited against the pre-runtime-target HEAD entrypoints and provider calls.
 * Keeping this explicit is intentional: a permissive `environment.*` matcher
 * allowed assistant IDs and typed refs to be silently swapped between demos.
 */
const expectedRuntimeWiring: ExpectedRuntimeWiring[] = [
  {
    project: 'cockpit-langgraph-streaming-angular',
    rootComponent: 'StreamingComponent',
    providerSource: 'src/app/app.config.ts',
    assistantId: 'environment.streamingAssistantId',
    agentRef: 'STREAMING_AGENT',
  },
  {
    project: 'cockpit-langgraph-persistence-angular',
    rootComponent: 'PersistenceComponent',
    providerSource: 'src/app/persistence.component.ts',
    assistantId: 'environment.streamingAssistantId',
    retainedProviderProperties: {
      onThreadId: persistenceOnThreadIdExpression,
    },
  },
  {
    project: 'cockpit-langgraph-interrupts-angular',
    rootComponent: 'InterruptsComponent',
    providerSource: 'src/app/app.config.ts',
    assistantId: 'environment.streamingAssistantId',
  },
  {
    project: 'cockpit-langgraph-memory-angular',
    rootComponent: 'MemoryComponent',
    providerSource: 'src/app/app.config.ts',
    assistantId: 'environment.streamingAssistantId',
  },
  {
    project: 'cockpit-langgraph-durable-execution-angular',
    rootComponent: 'DurableExecutionComponent',
    providerSource: 'src/app/app.config.ts',
    assistantId: 'environment.streamingAssistantId',
  },
  {
    project: 'cockpit-langgraph-subgraphs-angular',
    rootComponent: 'SubgraphsComponent',
    providerSource: 'src/app/app.config.ts',
    assistantId: 'environment.streamingAssistantId',
    agentRef: 'SUBGRAPHS_AGENT',
    retainedProviderProperties: {
      transcriptNodeNames: "['answer']",
    },
  },
  {
    project: 'cockpit-langgraph-time-travel-angular',
    rootComponent: 'TimeTravelComponent',
    providerSource: 'src/app/app.config.ts',
    assistantId: 'environment.streamingAssistantId',
  },
  {
    project: 'cockpit-langgraph-deployment-runtime-angular',
    rootComponent: 'DeploymentRuntimeComponent',
    providerSource: 'src/app/app.config.ts',
    assistantId: 'environment.deploymentRuntimeAssistantId',
  },
  {
    project: 'cockpit-langgraph-client-tools-angular',
    rootComponent: 'ClientToolsComponent',
    providerSource: 'src/app/app.config.ts',
    assistantId: 'environment.clientToolsAssistantId',
    agentRef: 'CLIENT_TOOLS_AGENT_REF',
  },
  {
    project: 'cockpit-deep-agents-planning-angular',
    rootComponent: 'PlanningComponent',
    providerSource: 'src/app/app.config.ts',
    assistantId: 'environment.streamingAssistantId',
  },
  {
    project: 'cockpit-deep-agents-filesystem-angular',
    rootComponent: 'FilesystemComponent',
    providerSource: 'src/app/app.config.ts',
    assistantId: 'environment.streamingAssistantId',
  },
  {
    project: 'cockpit-deep-agents-subagents-angular',
    rootComponent: 'SubagentsComponent',
    providerSource: 'src/app/app.config.ts',
    assistantId: 'environment.streamingAssistantId',
    retainedProviderProperties: {
      subagentToolNames: "['task']",
    },
  },
  {
    project: 'cockpit-deep-agents-memory-angular',
    rootComponent: 'MemoryComponent',
    providerSource: 'src/app/app.config.ts',
    assistantId: 'environment.streamingAssistantId',
  },
  {
    project: 'cockpit-deep-agents-skills-angular',
    rootComponent: 'SkillsComponent',
    providerSource: 'src/app/app.config.ts',
    assistantId: 'environment.streamingAssistantId',
  },
  {
    project: 'cockpit-chat-messages-angular',
    rootComponent: 'MessagesComponent',
    providerSource: 'src/app/app.config.ts',
    assistantId: 'environment.streamingAssistantId',
    agentRef: 'MESSAGES_AGENT',
  },
  {
    project: 'cockpit-chat-input-angular',
    rootComponent: 'InputComponent',
    providerSource: 'src/app/app.config.ts',
    assistantId: 'environment.streamingAssistantId',
  },
  {
    project: 'cockpit-chat-interrupts-angular',
    rootComponent: 'InterruptsComponent',
    providerSource: 'src/app/app.config.ts',
    assistantId: 'environment.streamingAssistantId',
  },
  {
    project: 'cockpit-chat-tool-calls-angular',
    rootComponent: 'ToolCallsComponent',
    providerSource: 'src/app/app.config.ts',
    assistantId: 'environment.streamingAssistantId',
  },
  {
    project: 'cockpit-chat-subagents-angular',
    rootComponent: 'SubagentsComponent',
    providerSource: 'src/app/app.config.ts',
    assistantId: 'environment.streamingAssistantId',
    retainedProviderProperties: {
      subagentToolNames: "['task']",
    },
  },
  {
    project: 'cockpit-chat-threads-angular',
    rootComponent: 'ThreadsComponent',
    providerSource: 'src/app/threads.component.ts',
    assistantId: 'environment.streamingAssistantId',
    retainedProviderProperties: {
      threadId: 'activeThreadIdState',
      onThreadId: '(id: string) => activeThreadIdState.set(id)',
    },
  },
  {
    project: 'cockpit-chat-timeline-angular',
    rootComponent: 'TimelineComponent',
    providerSource: 'src/app/app.config.ts',
    assistantId: 'environment.streamingAssistantId',
  },
  {
    project: 'cockpit-chat-generative-ui-angular',
    rootComponent: 'GenerativeUiComponent',
    providerSource: 'src/app/app.config.ts',
    assistantId: 'environment.generativeUiAssistantId',
  },
  {
    project: 'cockpit-chat-debug-angular',
    rootComponent: 'DebugPageComponent',
    providerSource: 'src/app/app.config.ts',
    assistantId: 'environment.streamingAssistantId',
  },
  {
    project: 'cockpit-chat-theming-angular',
    rootComponent: 'ThemingComponent',
    providerSource: 'src/app/app.config.ts',
    assistantId: 'environment.streamingAssistantId',
  },
  {
    project: 'cockpit-chat-a2ui-angular',
    rootComponent: 'A2uiComponent',
    providerSource: 'src/app/app.config.ts',
    assistantId: 'environment.a2uiAssistantId',
  },
  ...[
    ['cockpit-ag-ui-interrupts-angular', 'InterruptsComponent'],
    ['cockpit-ag-ui-streaming-angular', 'StreamingComponent'],
    ['cockpit-ag-ui-tool-views-angular', 'ToolViewsComponent'],
    ['cockpit-ag-ui-json-render-angular', 'JsonRenderComponent'],
    ['cockpit-ag-ui-client-tools-angular', 'ClientToolsComponent'],
    ['cockpit-ag-ui-a2ui-angular', 'A2uiComponent'],
    ['cockpit-ag-ui-subagents-angular', 'SubagentsComponent'],
    [
      'cockpit-runtimes-microsoft-agent-framework-angular',
      'MicrosoftAgentFrameworkComponent',
    ],
    ['cockpit-runtimes-aws-strands-angular', 'AwsStrandsComponent'],
    ['cockpit-runtimes-mastra-angular', 'MastraComponent'],
  ].map(([project, rootComponent]) => ({
    project,
    rootComponent,
    providerSource: 'src/app/app.config.ts',
    sharedUrl: "new URL('agent', document.baseURI).pathname",
  })),
];
const expectedRuntimeWiringByProject = new Map(
  expectedRuntimeWiring.map((expected) => [expected.project, expected])
);

const expectedRootImportSourceByProject = new Map<string, string>([
  ['cockpit-langgraph-streaming-angular', './app/streaming.component'],
  ['cockpit-langgraph-persistence-angular', './app/persistence.component'],
  ['cockpit-langgraph-interrupts-angular', './app/interrupts.component'],
  ['cockpit-langgraph-memory-angular', './app/memory.component'],
  [
    'cockpit-langgraph-durable-execution-angular',
    './app/durable-execution.component',
  ],
  ['cockpit-langgraph-subgraphs-angular', './app/subgraphs.component'],
  ['cockpit-langgraph-time-travel-angular', './app/time-travel.component'],
  [
    'cockpit-langgraph-deployment-runtime-angular',
    './app/deployment-runtime.component',
  ],
  ['cockpit-langgraph-client-tools-angular', './app/client-tools.component'],
  ['cockpit-deep-agents-planning-angular', './app/planning.component'],
  ['cockpit-deep-agents-filesystem-angular', './app/filesystem.component'],
  ['cockpit-deep-agents-subagents-angular', './app/subagents.component'],
  ['cockpit-deep-agents-memory-angular', './app/memory.component'],
  ['cockpit-deep-agents-skills-angular', './app/skills.component'],
  ['cockpit-chat-messages-angular', './app/messages.component'],
  ['cockpit-chat-input-angular', './app/input.component'],
  ['cockpit-chat-interrupts-angular', './app/interrupts.component'],
  ['cockpit-chat-tool-calls-angular', './app/tool-calls.component'],
  ['cockpit-chat-subagents-angular', './app/subagents.component'],
  ['cockpit-chat-threads-angular', './app/threads.component'],
  ['cockpit-chat-timeline-angular', './app/timeline.component'],
  ['cockpit-chat-generative-ui-angular', './app/generative-ui.component'],
  ['cockpit-chat-debug-angular', './app/debug.component'],
  ['cockpit-chat-theming-angular', './app/theming.component'],
  ['cockpit-chat-a2ui-angular', './app/a2ui.component'],
  ['cockpit-ag-ui-interrupts-angular', './app/interrupts.component'],
  ['cockpit-ag-ui-streaming-angular', './app/streaming.component'],
  ['cockpit-ag-ui-tool-views-angular', './app/tool-views.component'],
  ['cockpit-ag-ui-json-render-angular', './app/json-render.component'],
  ['cockpit-ag-ui-client-tools-angular', './app/client-tools.component'],
  ['cockpit-ag-ui-a2ui-angular', './app/a2ui.component'],
  ['cockpit-ag-ui-subagents-angular', './app/subagents.component'],
  [
    'cockpit-runtimes-microsoft-agent-framework-angular',
    './app/microsoft-agent-framework.component',
  ],
  ['cockpit-runtimes-aws-strands-angular', './app/aws-strands.component'],
  ['cockpit-runtimes-mastra-angular', './app/mastra.component'],
]);

type SemanticBindingInspection = ExactImportBinding;
const hasExactSemanticBinding = hasExactImportBinding;

function auditEntrypointMetadata(
  bootstrap: BootstrapCallRecord | undefined,
  expected: ExpectedRuntimeWiring,
  adapter: 'ag-ui' | 'langgraph'
): string[] {
  const mismatches: string[] = [];
  if (!bootstrap) return ['executable bootstrap call'];
  if (bootstrap.rootComponent !== expected.rootComponent) {
    mismatches.push(`root ${expected.rootComponent}`);
  }
  const bindingBootstrap = bootstrap as BootstrapCallRecord & {
    rootComponentBinding?: SemanticBindingInspection;
    environmentBindings?: readonly SemanticBindingInspection[];
    operationReporterBinding?: SemanticBindingInspection;
  };
  const rootImportSource = expectedRootImportSourceByProject.get(
    expected.project
  );
  if (
    !rootImportSource ||
    !hasExactSemanticBinding(
      bindingBootstrap.rootComponentBinding,
      rootImportSource,
      expected.rootComponent
    )
  ) {
    mismatches.push(`root import ${expected.rootComponent} from ${rootImportSource}`);
  }
  if (
    bootstrap.appConfigArgument !== 'appConfig' ||
    !bootstrap.hasCanonicalAppConfigBinding
  ) {
    mismatches.push('canonical appConfig import argument');
  }
  if (!bootstrap.hasCanonicalHarnessBinding) {
    mismatches.push('canonical bootstrap harness import');
  }
  if (!bootstrap.hasCanonicalCallOwner) {
    mismatches.push('sole top-level bootstrap owner');
  }
  const runtimeBootstrap = bootstrap as BootstrapCallRecord & {
    hasCanonicalRuntimeOptions?: boolean;
    hasPristineAgUrlGlobals?: boolean;
  };
  if (!runtimeBootstrap.hasCanonicalRuntimeOptions) {
    mismatches.push('canonical runtime options grammar');
  }
  if (bootstrap.runtimeProperties['adapter'] !== `'${adapter}'`) {
    mismatches.push(`adapter '${adapter}'`);
  }
  if (adapter === 'langgraph') {
    if (
      bindingBootstrap.environmentBindings?.length !== 2 ||
      !bindingBootstrap.environmentBindings.every((binding) =>
        hasExactSemanticBinding(
          binding,
          './environments/environment',
          'environment'
        )
      )
    ) {
      mismatches.push('environment import from ./environments/environment');
    }
    if (
      !hasExactSemanticBinding(
        bindingBootstrap.operationReporterBinding,
        '@threadplane/langgraph',
        'ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER'
      )
    ) {
      mismatches.push('LangGraph operation reporter import');
    }
    if (
      bootstrap.runtimeProperties['sharedApiUrl'] !==
      'environment.langGraphApiUrl'
    ) {
      mismatches.push('sharedApiUrl environment.langGraphApiUrl');
    }
    if (bootstrap.runtimeProperties['assistantId'] !== expected.assistantId) {
      mismatches.push(`assistantId ${expected.assistantId}`);
    }
    if (
      bootstrap.runtimeProperties['operationReporterToken'] !==
      'ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER'
    ) {
      mismatches.push(
        'operationReporterToken ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER'
      );
    }
  } else {
    if (!runtimeBootstrap.hasPristineAgUrlGlobals) {
      mismatches.push('pristine URL/document globals');
    }
    if (
      !hasExactSemanticBinding(
        bindingBootstrap.operationReporterBinding,
        '@threadplane/ag-ui',
        'ɵAG_UI_RUNTIME_OPERATION_REPORTER'
      )
    ) {
      mismatches.push('AG-UI operation reporter import');
    }
    if (bootstrap.runtimeProperties['sharedUrl'] !== expected.sharedUrl) {
      mismatches.push(`sharedUrl ${expected.sharedUrl}`);
    }
    if (
      bootstrap.runtimeProperties['operationReporterToken'] !==
      'ɵAG_UI_RUNTIME_OPERATION_REPORTER'
    ) {
      mismatches.push(
        'operationReporterToken ɵAG_UI_RUNTIME_OPERATION_REPORTER'
      );
    }
  }
  if (!bootstrap.hasRedactedCatch) mismatches.push('redacted catch owner');
  return mismatches;
}

function hasExpectedProviderProperties(
  providerCalls: CanonicalProviderCall[],
  expected: Readonly<Record<string, string>>
): boolean {
  return providerCalls.some((call) =>
    Object.entries(expected).every(
      ([property, expression]) => call.properties[property] === expression
    )
  );
}

function auditProviderProvenance(
  sources: ReadonlyArray<{
    relativeFileName: string;
    providerCalls: readonly CanonicalProviderCall[];
  }>,
  expectedSource: string,
  expectedOwner: ProviderRegistrationOwner
): string[] {
  const actual = sources
    .filter(({ providerCalls }) => providerCalls.length > 0)
    .map(({ relativeFileName, providerCalls }) => ({
      relativeFileName,
      count: providerCalls.length,
      owners: providerCalls.map(({ owner }) => owner),
    }));
  return actual.length === 1 &&
    actual[0].relativeFileName === expectedSource &&
    actual[0].count === 1 &&
    JSON.stringify(actual[0].owners) === JSON.stringify([expectedOwner])
    ? []
    : [
        `Agent provider provenance ${JSON.stringify(
          actual
        )}; expected exactly one in ${expectedSource}`,
      ];
}

function expectedProviderOwner(
  expected: ExpectedRuntimeWiring
): ProviderRegistrationOwner {
  return expected.providerSource === 'src/app/app.config.ts'
    ? { kind: 'appConfig' }
    : { kind: 'component', component: expected.rootComponent };
}

function auditThreadsRootProviders(
  sources: ReadonlyArray<{
    relativeFileName: string;
    angularProviders: readonly AngularProviderRecord[];
  }>
): string[] {
  const expectedFile = 'src/app/app.config.ts';
  const providers = sources.flatMap(({ relativeFileName, angularProviders }) =>
    angularProviders.map((provider) => ({ relativeFileName, provider }))
  );
  const mismatches: string[] = [];
  const assertOne = (
    token: string,
    valid: (provider: AngularProviderRecord) => boolean
  ): void => {
    const matches = providers.filter(
      ({ provider }) => provider.provideToken === token
    );
    if (
      matches.length !== 1 ||
      matches[0].relativeFileName !== expectedFile ||
      !valid(matches[0].provider)
    ) {
      mismatches.push(`${token} canonical provider in ${expectedFile}`);
    }
  };
  const canonicalConnection = (provider: AngularProviderRecord): boolean =>
    provider.canonicalFactory &&
    provider.connectionDeclaration ===
      'const connection = injectCockpitRuntimeConnection()' &&
    provider.connectionCallCount === 1 &&
    !provider.connectionWrites;
  const hasTokenBinding = (
    provider: AngularProviderRecord,
    token: string
  ): boolean =>
    hasExactSemanticBinding(
      (
        provider as AngularProviderRecord & {
          provideTokenBinding?: SemanticBindingInspection;
        }
      ).provideTokenBinding,
      '@threadplane/langgraph',
      token
    );

  assertOne(
    'LANGGRAPH_THREADS_CONFIG',
    (provider) =>
      hasTokenBinding(provider, 'LANGGRAPH_THREADS_CONFIG') &&
      canonicalConnection(provider) &&
      provider.returnExpression === '{ apiUrl: connection.apiUrl }' &&
      JSON.stringify(provider.returnedProperties) ===
        JSON.stringify({ apiUrl: 'connection.apiUrl' })
  );
  assertOne(
    'LANGGRAPH_CLIENT_OPTIONS',
    (provider) =>
      hasTokenBinding(provider, 'LANGGRAPH_CLIENT_OPTIONS') &&
      canonicalConnection(provider) &&
      provider.returnExpression === 'connection.clientOptions' &&
      Object.keys(provider.returnedProperties).length === 0
  );
  return mismatches;
}

/**
 * The cockpit site is assembled from three lists that nothing forced to agree:
 *
 *  - `libs/cockpit-registry/src/lib/capability-registry.ts` — what serve/build/deploy know about;
 *  - `libs/cockpit-registry` `cockpitManifest` — what the Next route can resolve;
 *  - registry-owned `capabilityModules` — what supplies a page's assets.
 *
 * When the `runtimes` product shipped, only the first list learned about it, so
 * `/runtimes/core-capabilities/<topic>/overview/<lang>` threw
 * "No manifest entry found …" and every runtime page 500'd in production while
 * the whole suite stayed green. These assertions are the missing coupling.
 */
describe('cockpit capability wiring', () => {
  const manifestKey = (e: {
    product: string;
    section: string;
    topic: string;
  }) => `${e.product}/${e.section}/${e.topic}`;

  it('gives every registered capability a resolvable manifest entry', () => {
    const manifestKeys = new Set(cockpitManifest.map(manifestKey));

    const unroutable = capabilities
      .map(
        (capability) =>
          `${capability.product}/core-capabilities/${capability.topic}`
      )
      .filter((key) => !manifestKeys.has(key));

    expect(unroutable).toEqual([]);
  });

  it('gives every registered capability a registry-owned content descriptor', () => {
    const moduleKeys = new Set(
      capabilityModules.map((module) => manifestKey(module.manifestIdentity))
    );

    const unwired = capabilities
      .map(
        (capability) =>
          `${capability.product}/core-capabilities/${capability.topic}`
      )
      .filter((key) => !moduleKeys.has(key));

    expect(unwired).toEqual([]);
  });

  it('points every cockpit module at a capability that still exists', () => {
    const capabilityKeys = new Set(
      capabilities.map(
        (capability) =>
          `${capability.product}/core-capabilities/${capability.topic}`
      )
    );

    const orphans = capabilityModules
      .map((module) => manifestKey(module.manifestIdentity))
      .filter((key) => !capabilityKeys.has(key));

    expect(orphans).toEqual([]);
  });

  it('mirrors explicit runtime adapters for exactly 35 configurable and six static Angular applications', () => {
    const filesystemProjects = readdirSync(cockpitRoot, {
      withFileTypes: true,
    })
      .filter((product) => product.isDirectory())
      .flatMap((product) => {
        const productRoot = resolve(cockpitRoot, product.name);
        return readdirSync(productRoot, { withFileTypes: true })
          .filter((topic) => topic.isDirectory())
          .flatMap((topic) => {
            const projectPath = resolve(
              productRoot,
              topic.name,
              'angular/project.json'
            );
            if (!existsSync(projectPath)) return [];
            const project = JSON.parse(readFileSync(projectPath, 'utf8')) as {
              name: string;
            };
            return [project.name];
          });
      })
      .sort();
    const registryProjects = capabilities
      .map((capability) => capability.angularProject)
      .sort();
    const manifestByKey = new Map(
      cockpitManifest
        .filter((entry) => entry.entryKind === 'capability')
        .map((entry) => [manifestKey(entry), entry.runtimeAdapter])
    );
    const descriptorByKey = new Map(
      capabilityModules.map((descriptor) => [
        manifestKey(descriptor.manifestIdentity),
        descriptor.runtimeAdapter,
      ])
    );
    const registryAdapters = capabilities.map(
      (capability) => capability.runtimeAdapter
    );
    const mismatches = capabilities
      .map((capability) => {
        const key = `${capability.product}/core-capabilities/${capability.topic}`;
        return {
          key,
          registry: capability.runtimeAdapter,
          descriptor: descriptorByKey.get(key),
          manifest: manifestByKey.get(key),
        };
      })
      .filter(
        ({ registry, descriptor, manifest }) =>
          registry !== descriptor || registry !== manifest
      );

    expect(filesystemProjects).toEqual(registryProjects);
    expect(
      registryAdapters.filter((adapter) => adapter !== 'none')
    ).toHaveLength(35);
    expect(
      registryAdapters.filter((adapter) => adapter === 'none')
    ).toHaveLength(6);
    expect(registryAdapters).not.toContain(undefined);
    expect(mismatches).toEqual([]);
  });

  it('routes every configurable Angular application through the generation-scoped runtime connection', () => {
    const configurable = capabilities.filter(
      (
        capability
      ): capability is typeof capability & {
        runtimeAdapter: 'ag-ui' | 'langgraph';
      } => capability.runtimeAdapter !== 'none'
    );
    const unmigrated = configurable.flatMap((capability) => {
      const projectRoot = resolve(
        cockpitRoot,
        capability.product,
        capability.topic,
        'angular'
      );
      const entryPoints = ['main.ts', 'main.cockpit.ts'].map((fileName) => ({
        fileName,
        source: readFileSync(resolve(projectRoot, 'src', fileName), 'utf8'),
      }));
      const sourceFiles = angularSourceFiles(projectRoot)
        .map((fileName) => ({
          fileName,
          relativeFileName: fileName.slice(projectRoot.length + 1),
          source: readFileSync(fileName, 'utf8'),
        }))
        .filter(
          ({ relativeFileName }) =>
            !relativeFileName.startsWith('src/environments/')
        );
      const adapter = capability.runtimeAdapter;
      const missing: string[] = [];
      const expected = expectedRuntimeWiringByProject.get(
        capability.angularProject
      );

      for (const { fileName, source } of entryPoints) {
        const bootstrapCalls = inspectRuntimeTargetSource(
          source,
          fileName,
          adapter
        ).bootstrapCalls;
        if (bootstrapCalls.length !== 1) {
          missing.push(`${fileName}: exactly one executable bootstrap owner`);
          continue;
        }
        if (!expected) {
          missing.push(`${fileName}: audited runtime metadata table entry`);
          continue;
        }
        for (const mismatch of auditEntrypointMetadata(
          bootstrapCalls[0],
          expected,
          adapter
        )) {
          missing.push(`${fileName}: ${mismatch}`);
        }
      }

      const sourceAudits = sourceFiles.map((file) => ({
        ...file,
        inspection: inspectRuntimeTargetSource(
          file.source,
          file.relativeFileName,
          adapter,
          capability.angularProject
        ),
      }));
      if (expected) {
        missing.push(
          ...auditProviderProvenance(
            sourceAudits.map(({ relativeFileName, inspection }) => ({
              relativeFileName,
              providerCalls: inspection.providerCalls,
            })),
            expected.providerSource,
            expectedProviderOwner(expected)
          )
        );
      }
      if (capability.angularProject === 'cockpit-chat-threads-angular') {
        missing.push(
          ...auditThreadsRootProviders(
            sourceAudits.map(({ relativeFileName, inspection }) => ({
              relativeFileName,
              angularProviders: inspection.angularProviders,
            }))
          )
        );
      }
      for (const { relativeFileName, inspection } of sourceAudits) {
        for (const issue of inspection.issues) {
          missing.push(`${relativeFileName}: ${issue.kind} (${issue.detail})`);
        }
      }

      return missing.length === 0
        ? []
        : [{ project: capability.angularProject, missing }];
    });

    expect(configurable).toHaveLength(35);
    expect(unmigrated).toEqual([]);
  });

  it('audits excluded Memory tests when runtime source imports them', () => {
    const temporary = mkdtempSync(resolve(tmpdir(), 'memory-runtime-audit-'));
    const root = resolve(temporary, 'deep-agents/memory/angular');
    try {
      mkdirSync(resolve(root, 'src'), { recursive: true });
      writeFileSync(
        resolve(root, 'tsconfig.app.json'),
        JSON.stringify({
          files: ['src/main.ts'],
          include: ['src/**/*.ts'],
          exclude: ['src/**/*.spec.ts'],
        })
      );
      writeFileSync(resolve(root, 'src/main.ts'), 'export const app = true;');
      writeFileSync(
        resolve(root, 'src/secret.spec.ts'),
        "export const secret = window.localStorage.getItem('apiKey');"
      );
      expect(
        angularSourceFiles(root).some((name) => name.endsWith('secret.spec.ts'))
      ).toBe(false);
      for (const source of [
        "import { secret } from './secret.spec'; export const app = secret;",
        "export const app = import('./secret.spec');",
        "declare function require(path: string): unknown; export const app = require('./secret.spec');",
      ]) {
        writeFileSync(resolve(root, 'src/main.ts'), source);
        const runtime = angularSourceFiles(root);
        expect(runtime.some((name) => name.endsWith('secret.spec.ts'))).toBe(
          true
        );
        expect(
          runtime.flatMap((name) =>
            auditRuntimeTargetSource(readFileSync(name, 'utf8'), name)
          )
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ kind: 'browser-state-read' }),
          ])
        );
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it.each(['listener', 'block'])(
    'rejects a disconnected Memory %s control',
    (control) => {
      const scope = readFileSync(
        resolve(
          cockpitRoot,
          'deep-agents/memory/angular/src/app/memory-scope.ts'
        ),
        'utf8'
      );
      const changed =
        control === 'listener'
          ? scope.replace(
              "addEventListener('storage', onStorage)",
              "addEventListener('storage', () => {})"
            )
          : scope.replace(
              /const block = \(\) => \{[\s\S]*?\n {2}\};/,
              'const block = () => {};'
            );
      expect(changed).not.toBe(scope);
      expect(
        inspectRuntimeTargetSource(
          changed,
          'src/app/memory-scope.ts',
          'langgraph',
          'cockpit-deep-agents-memory-angular'
        ).issues
      ).not.toEqual([]);
    }
  );

  it('audits the scoped Memory provider and production browser scope without exempting other projects', () => {
    const project = 'cockpit-deep-agents-memory-angular';
    const root = resolve(cockpitRoot, 'deep-agents/memory/angular');
    const provider = readFileSync(
      resolve(root, 'src/app/app.config.ts'),
      'utf8'
    );
    const scope = readFileSync(
      resolve(root, 'src/app/memory-scope.ts'),
      'utf8'
    );
    const inspect = (source: string, path: string, owner = project) =>
      inspectRuntimeTargetSource(source, path, 'langgraph', owner).issues;
    expect(inspect(provider, 'src/app/app.config.ts')).toEqual([]);
    expect(inspect(scope, 'src/app/memory-scope.ts')).toEqual([]);
    expect(
      inspect(
        provider,
        'src/app/app.config.ts',
        'cockpit-langgraph-memory-angular'
      )
    ).not.toEqual([]);
    expect(inspect(scope, 'src/app/other.ts')).not.toEqual([]);
    expect(
      angularSourceFiles(root).some((name) => name.endsWith('.spec.ts'))
    ).toBe(false);
    for (const changed of [
      provider.replace('const scope =', 'mutate(connection); const scope ='),
      provider.replace('connection.apiUrl,', "'/unsafe',"),
      provider.replace('maxRetries: 0', 'maxRetries: 1'),
      provider.replace('...connection.clientOptions', '...unsafeOptions'),
      provider.replace(
        'clientOptions,\n        threadId,',
        'clientOptions, secret: window.runtimeApiKey,\n        threadId,'
      ),
      provider.replace(
        'import { MemoryScope }',
        'import { UnsafeScope as MemoryScope }'
      ),
      provider.replace('inject, signal', 'inject, signal as unsafeSignal'),
      provider.replace('transport,', '...unsafeOverrides, transport,'),
    ])
      expect(inspect(changed, 'src/app/app.config.ts')).not.toEqual([]);
    for (const changed of [
      scope.replace('window.localStorage', 'window.sessionStorage'),
      scope.replace('  InjectionToken,', '  InjectionToken as UnsafeToken,'),
      scope + '\nconst InjectionToken = UnsafeToken;',
      scope.replace('scope.v1', 'runtime-target'),
      scope.replace('event.key !== SCOPE_KEY', 'false'),
      scope.replace('event.key !== SCOPE_KEY', 'false') +
        `
        function unused() {
          const onStorage = (event: ScopeEvent) => {
            if (disposed || (event.storageArea !== null && event.storageArea !== storage) || (event.key !== null && event.key !== SCOPE_KEY)) return;
            if (event.key === null || event.newValue !== scope) block();
          };
        }`,
      scope.replace("disposed || snapshot.status !== 'ready'", 'disposed'),
      scope.replace('storage?.getItem(SCOPE_KEY) !== scope', 'false'),
      scope.replace('storage.getItem(SCOPE_KEY)', "storage.getItem('apiKey')"),
      scope.replace(
        'storage?.getItem(SCOPE_KEY)',
        "storage?.getItem('runtime-target')"
      ),
      scope.replace(
        'window.crypto.randomUUID()',
        "window.localStorage.getItem('apiKey')"
      ),
      scope +
        "\nexport const unsafe = () => window.localStorage.getItem('runtime-target');",
    ])
      expect(inspect(changed, 'src/app/memory-scope.ts')).not.toEqual([]);
  });

  it.each([
    [
      'helper storage alias',
      `const targetCache = window.localStorage;\nexport const readTarget = () => targetCache.getItem('runtime-target');`,
      'browser-state-read',
    ],
    [
      'dot global key',
      `export const key = globalThis.runtimeApiKey;`,
      'global-runtime-secret-read',
    ],
    [
      'session storage bracket alias',
      `const cache = window['session' + 'Storage'];\nexport const read = () => cache.getItem('target');`,
      'browser-state-read',
    ],
    [
      'IndexedDB dot alias',
      `const database = globalThis.indexedDB;\nexport const read = () => database.open('runtime');`,
      'browser-state-read',
    ],
    [
      'bracket global target',
      `export const target = window['runtimeTarget'];`,
      'global-runtime-secret-read',
    ],
    [
      'aliased global key',
      `const browserGlobal = globalThis;\nexport const key = browserGlobal.runtimeApiKey;`,
      'browser-state-read',
    ],
    [
      'reverse-ordered global alias bracket endpoint',
      `const earlierAlias = laterAlias;\nconst laterAlias = globalThis;\nexport const endpoint = earlierAlias['runtimeEndpoint'];`,
      'browser-state-read',
    ],
    [
      'location href',
      `export const endpoint = new URL(location.href).searchParams.get('endpoint');`,
      'browser-state-read',
    ],
    [
      'location shorthand',
      `export const runtimeInput = { location };`,
      'browser-state-read',
    ],
    [
      'location read outside an unrelated shadowing scope',
      `function render(location: string) { return { location }; }\nexport const runtimeInput = { location };`,
      'browser-state-read',
    ],
    [
      'history state',
      `export const target = history.state.runtimeTarget;`,
      'browser-state-read',
    ],
    [
      'cookie bracket access',
      `export const key = document['cookie'];`,
      'browser-state-read',
    ],
    [
      'destructured cookie access',
      `const { cookie: runtimeCookie } = document;\nexport { runtimeCookie };`,
      'browser-state-read',
    ],
    [
      'query helper',
      `export const key = new URLSearchParams('?apiKey=x').get('apiKey');`,
      'browser-state-read',
    ],
    [
      'aliased provider with imported config',
      `import { provideAgent as wireAgent } from '@threadplane/langgraph';\nimport { runtimeConfig } from './runtime-config';\nexport const providers = [wireAgent(runtimeConfig)];`,
      'noncanonical-provider-wiring',
    ],
    [
      'namespace provider with direct config',
      `import * as agentApi from '@threadplane/ag-ui';\nconst config = { url: '/agent' };\nexport const providers = [agentApi.provideAgent(config)];`,
      'noncanonical-provider-wiring',
    ],
    [
      'locally aliased provider with direct config',
      `import { provideAgent } from '@threadplane/ag-ui';\nconst wire = provideAgent;\nexport const providers = [wire({ url: '/agent' })];`,
      'noncanonical-provider-wiring',
    ],
    [
      'factory returning imported config',
      `import { provideAgent } from '@threadplane/langgraph';\nimport { runtimeConfig } from './runtime-config';\nexport const providers = [provideAgent(() => runtimeConfig)];`,
      'noncanonical-provider-wiring',
    ],
    [
      'aliased direct Agent construction',
      `import { Agent as RuntimeAgent } from '@threadplane/ag-ui';\nexport const agent = new RuntimeAgent({ url: '/agent' });`,
      'direct-agent-construction',
    ],
    [
      'imported key helper',
      `import { runtimeApiKey as key } from './runtime-target';\nexport { key };`,
      'imported-runtime-secret',
    ],
    [
      'module-global target cache',
      `let runtimeTargetCache: { url: string } | undefined;\nexport const read = () => runtimeTargetCache;`,
      'module-global-runtime-cache',
    ],
    [
      'module-global API key',
      `let apiKey: string | undefined;\nexport const read = () => apiKey;`,
      'module-global-runtime-cache',
    ],
    [
      'helper target logging',
      `export function debug(runtimeTarget: unknown) { console.info('target', runtimeTarget); }`,
      'runtime-secret-log',
    ],
    [
      'aliased helper target logging',
      `export function debug(runtimeTarget: unknown) { const payload = runtimeTarget; console.info(payload); }`,
      'runtime-secret-log',
    ],
  ])('catches the adversarial %s bypass', (_label, source, expectedKind) => {
    expect(
      auditRuntimeTargetSource(source, 'src/app/runtime-helper.ts').map(
        ({ kind }) => kind
      )
    ).toContain(expectedKind);
  });

  it('rejects aliased provider and connection imports even when their factory is otherwise valid', () => {
    const source = `
      import { provideAgent as wireAgent } from '@threadplane/langgraph';
      import { injectCockpitRuntimeConnection as useConnection } from '@threadplane/cockpit-telemetry';
      export const providers = [wireAgent(() => {
        const connection = useConnection();
        if (connection.adapter !== 'langgraph') throw new Error('incompatible runtime');
        return {
          apiUrl: connection.apiUrl,
          assistantId: connection.assistantId,
          clientOptions: connection.clientOptions,
        };
      })];
    `;

    expect(
      auditRuntimeTargetSource(source, 'src/app/app.config.ts').map(
        ({ kind }) => kind
      )
    ).toContain('noncanonical-provider-wiring');
  });

  it.each([
    [
      'helper-return environment config',
      `import { environment } from '../environments/environment';\nexport const makeConfig = () => ({ apiUrl: environment.langGraphApiUrl });`,
      'environment-config-outside-entrypoint',
    ],
    [
      'runtime connection typed cache',
      `let value: CockpitRuntimeConnection | undefined;\nexport const read = () => value;`,
      'module-global-runtime-cache',
    ],
    [
      'structurally typed key cache',
      `let value: { apiKey: string } | undefined;\nexport const read = () => value;`,
      'module-global-runtime-cache',
    ],
    [
      'structurally typed endpoint cache',
      `let value: { endpoint: string } | undefined;\nexport const read = () => value;`,
      'module-global-runtime-cache',
    ],
    [
      'runtime target initializer cache',
      `const value = { runtimeTarget: '/agent' };\nexport const read = () => value;`,
      'module-global-runtime-cache',
    ],
    [
      'runtime session typed cache',
      `let value: RuntimeTargetSession | undefined;\nexport const read = () => value;`,
      'module-global-runtime-cache',
    ],
    [
      'destructured provider',
      `import * as agentApi from '@threadplane/ag-ui';\nconst { provideAgent } = agentApi;\nexport const providers = [provideAgent(() => ({ url: '/agent' }))];`,
      'noncanonical-provider-wiring',
    ],
    [
      'reverse provider alias',
      `import { provideAgent as wireAgent } from '@threadplane/ag-ui';\nconst provideAgent = wireAgent;\nexport const providers = [provideAgent(() => ({ url: '/agent' }))];`,
      'noncanonical-provider-wiring',
    ],
    [
      'computed connection field',
      `import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';\nimport { provideAgent } from '@threadplane/ag-ui';\nexport const providers = [provideAgent(() => { const connection = injectCockpitRuntimeConnection(); return { ['url']: connection.url }; })];`,
      'noncanonical-provider-wiring',
    ],
    [
      'spread connection fields',
      `import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';\nimport { provideAgent } from '@threadplane/ag-ui';\nexport const providers = [provideAgent(() => { const connection = injectCockpitRuntimeConnection(); return { ...connection }; })];`,
      'noncanonical-provider-wiring',
    ],
    [
      'shorthand connection field',
      `import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';\nimport { provideAgent } from '@threadplane/ag-ui';\nexport const providers = [provideAgent(() => { const connection = injectCockpitRuntimeConnection(); const url = connection.url; return { url }; })];`,
      'noncanonical-provider-wiring',
    ],
    [
      'mutable connection declaration',
      `import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';\nimport { provideAgent } from '@threadplane/ag-ui';\nexport const providers = [provideAgent(() => { let connection = injectCockpitRuntimeConnection(); return { url: connection.url }; })];`,
      'noncanonical-provider-wiring',
    ],
    [
      'connection reassignment',
      `import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';\nimport { provideAgent } from '@threadplane/ag-ui';\nexport const providers = [provideAgent(() => { const connection = injectCockpitRuntimeConnection(); connection = injectCockpitRuntimeConnection(); return { url: connection.url }; })];`,
      'noncanonical-provider-wiring',
    ],
    [
      'return before canonical connection declaration',
      `import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';\nimport { provideAgent } from '@threadplane/ag-ui';\nexport const providers = [provideAgent(() => { return { url: connection.url }; const connection = injectCockpitRuntimeConnection(); if (connection.adapter !== 'ag-ui') { throw new Error('incompatible runtime'); } })];`,
      'noncanonical-provider-wiring',
    ],
    [
      'unreachable statement before canonical connection declaration',
      `import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';\nimport { provideAgent } from '@threadplane/ag-ui';\nexport const providers = [provideAgent(() => { throw new Error('unreachable'); const connection = injectCockpitRuntimeConnection(); if (connection.adapter !== 'ag-ui') { throw new Error('incompatible runtime'); } return { url: connection.url }; })];`,
      'noncanonical-provider-wiring',
    ],
    [
      'nested alternate Agent return',
      `import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';\nimport { provideAgent } from '@threadplane/ag-ui';\nexport const providers = [provideAgent(() => { const connection = injectCockpitRuntimeConnection(); if (connection.adapter !== 'ag-ui') { throw new Error('incompatible runtime'); } if (flag) return { url: connection.url }; return { url: connection.url }; })];`,
      'noncanonical-provider-wiring',
    ],
    [
      'connection passed to mutating helper',
      `import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';\nimport { provideAgent } from '@threadplane/ag-ui';\nexport const providers = [provideAgent(() => { const connection = injectCockpitRuntimeConnection(); if (connection.adapter !== 'ag-ui') { throw new Error('incompatible runtime'); } mutate(connection); return { url: connection.url }; })];`,
      'noncanonical-provider-wiring',
    ],
    [
      'Object.assign connection mutation',
      `import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';\nimport { provideAgent } from '@threadplane/ag-ui';\nexport const providers = [provideAgent(() => { const connection = injectCockpitRuntimeConnection(); if (connection.adapter !== 'ag-ui') { throw new Error('incompatible runtime'); } Object.assign(connection, { url: '/wrong' }); return { url: connection.url }; })];`,
      'noncanonical-provider-wiring',
    ],
    [
      'provider element alias declaration',
      `import * as api from '@threadplane/ag-ui';\nconst wire = api['provideAgent'];\nexport const providers = [wire(() => ({ url: '/agent' }))];`,
      'noncanonical-provider-wiring',
    ],
    [
      'provider renamed destructuring declaration',
      `import * as api from '@threadplane/ag-ui';\nconst { provideAgent: wire } = api;\nexport const providers = [wire(() => ({ url: '/agent' }))];`,
      'noncanonical-provider-wiring',
    ],
    [
      'window alias declaration',
      `const browser = window;\nexport const value = browser.localStorage;`,
      'browser-state-read',
    ],
    [
      'document alias declaration',
      `const doc = document;\nexport const value = doc.cookie;`,
      'browser-state-read',
    ],
    [
      'self alias declaration',
      `const browser = self;\nexport const value = browser.location;`,
      'browser-state-read',
    ],
    [
      'function-local window alias',
      `export function read() { const w = window; return w.localStorage; }`,
      'browser-state-read',
    ],
    [
      'function-local document alias',
      `export function read() { const d = document; return d.cookie; }`,
      'browser-state-read',
    ],
    [
      'function-local destructured session storage',
      `export function read() { const { sessionStorage: cache } = window; return cache; }`,
      'browser-state-read',
    ],
    [
      'function-local reverse browser alias chain',
      `export function read() { const w = browser; const browser = globalThis; return w.localStorage; }`,
      'browser-state-read',
    ],
    [
      'storage from a window parent alias',
      `const parentWindow = window.parent;\nexport const cache = parentWindow.localStorage;`,
      'browser-state-read',
    ],
    [
      'cookie destructured from an arbitrary helper result',
      `const { cookie } = readHeaders();\nexport { cookie };`,
      'browser-state-read',
    ],
    [
      'runtime key in a default parameter',
      `export function read(config = { apiKey: 'secret' }) { return config; }`,
      'global-runtime-secret-read',
    ],
    [
      'runtime target returned from a helper argument',
      `export function read(config: { runtimeTarget: string }) { return config.runtimeTarget; }`,
      'global-runtime-secret-read',
    ],
    [
      'authorization assignment on an arbitrary base',
      `export function write(headers: Record<string, string>) { headers.authorization = 'secret'; }`,
      'global-runtime-secret-read',
    ],
    [
      'computed API key read on an arbitrary base',
      `export function read(config: Record<string, string>) { return config['api' + 'Key']; }`,
      'global-runtime-secret-read',
    ],
    [
      'sensitive member on a shadowed browser parameter',
      `export function read(window: { localStorage: unknown }) { return window.localStorage; }`,
      'browser-state-read',
    ],
    [
      'location href through a parent alias',
      `const parentWindow = window.parent;\nexport const endpoint = parentWindow.location.href;`,
      'browser-state-read',
    ],
    [
      'history state through an arbitrary helper',
      `export const target = helper.history.state;`,
      'browser-state-read',
    ],
  ])('rejects the canonical-policy bypass: %s', (_label, source, kind) => {
    expect(
      auditRuntimeTargetSource(source, 'src/app/runtime-helper.ts').map(
        (issue) => issue.kind
      )
    ).toContain(kind);
  });

  it.each([
    [
      'imported location',
      `import { location } from './schema';\nexport const schema = { location };`,
    ],
    [
      'local location',
      `export function schema(location: string) { return { location }; }`,
    ],
    ['parent window handle', `export const parentWindow = window['parent'];`],
    ['literal console', `console.info('component mounted');`],
    [
      'non-sensitive compound identifiers',
      `export const linkTarget = '_blank';\nexport const sessionLabel = 'one';\nexport const connectionStatus = 'ready';\nexport const endpointCount = 2;\nexport const keyboardNavigation = true;`,
    ],
    [
      'non-sensitive console tokens',
      `console.info('keyboard navigation', { connectionStatus: 'ready', endpointCount: 2 });`,
    ],
  ])('allows harmless source: %s', (_label, source) => {
    expect(auditRuntimeTargetSource(source, 'src/app/component.ts')).toEqual(
      []
    );
  });

  it('rejects Agent providers copied to orphan files, moved to the wrong file, or duplicated', () => {
    const canonicalSource = `
      import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';
      import { provideAgent } from '@threadplane/ag-ui';
      export const appConfig = { providers: [provideAgent(() => {
        const connection = injectCockpitRuntimeConnection();
        if (connection.adapter !== 'ag-ui') {
          throw new Error('incompatible runtime');
        }
        return { url: connection.url };
      })] };
    `;
    const source = (relativeFileName: string) => ({
      relativeFileName,
      providerCalls: inspectRuntimeTargetSource(
        canonicalSource,
        relativeFileName,
        'ag-ui'
      ).providerCalls,
    });
    const expected = source('src/app/app.config.ts');
    const orphan = source('src/app/orphan.ts');

    expect(
      auditProviderProvenance([expected], expected.relativeFileName, {
        kind: 'appConfig',
      })
    ).toEqual([]);
    expect(
      auditProviderProvenance([orphan], expected.relativeFileName, {
        kind: 'appConfig',
      })
    ).not.toEqual([]);
    expect(
      auditProviderProvenance([expected, orphan], expected.relativeFileName, {
        kind: 'appConfig',
      })
    ).not.toEqual([]);
    expect(
      auditProviderProvenance(
        [
          {
            relativeFileName: expected.relativeFileName,
            providerCalls: [
              ...expected.providerCalls,
              ...expected.providerCalls,
            ],
          },
        ],
        expected.relativeFileName,
        { kind: 'appConfig' }
      )
    ).not.toEqual([]);
  });

  it('pins provideAgent calls to their executable Angular registration owner', () => {
    const preamble = `
      import { Component } from '@angular/core';
      import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';
      import { provideAgent } from '@threadplane/langgraph';
    `;
    const providerCall = `provideAgent(() => {
      const connection = injectCockpitRuntimeConnection();
      if (connection.adapter !== 'langgraph') {
        throw new Error('incompatible runtime');
      }
      return {
        apiUrl: connection.apiUrl,
        assistantId: connection.assistantId,
        clientOptions: connection.clientOptions,
      };
    })`;
    const inspect = (source: string) =>
      inspectRuntimeTargetSource(
        `${preamble}\n${source}`,
        'src/app/app.config.ts',
        'langgraph'
      );
    const rejected = (source: string): boolean =>
      inspect(source).issues.some(
        ({ kind }) => kind === 'noncanonical-provider-wiring'
      );

    const appConfig = inspect(
      `export const appConfig = { providers: [${providerCall}] };`
    );
    expect(appConfig.issues).toEqual([]);
    expect(appConfig.providerCalls[0]?.owner).toEqual({ kind: 'appConfig' });
    const typeOnlyAppConfigReference = inspect(
      `export const appConfig = { providers: [${providerCall}] }; type AppConfigShape = typeof appConfig;`
    );
    expect(typeOnlyAppConfigReference.issues).toEqual([]);
    expect(typeOnlyAppConfigReference.providerCalls[0]?.owner).toEqual({
      kind: 'appConfig',
    });

    const component = inspect(`
      @Component({ providers: [${providerCall}], template: '' })
      export class PersistenceComponent {}
    `);
    expect(component.issues).toEqual([]);
    expect(component.providerCalls[0]?.owner).toEqual({
      kind: 'component',
      component: 'PersistenceComponent',
    });

    expect(rejected(`${providerCall};`)).toBe(true);
    expect(
      rejected(`const appConfig = { providers: [${providerCall}] };`)
    ).toBe(true);
    expect(
      rejected(
        `export let appConfig = { providers: [${providerCall}] }; appConfig = { providers: [] };`
      )
    ).toBe(true);
    expect(
      rejected(
        `export const appConfig = { providers: [${providerCall}] }; appConfig.providers = [];`
      )
    ).toBe(true);
    expect(
      rejected(
        `export const appConfig = { providers: [${providerCall}] }; appConfig.providers.splice(0, 1);`
      )
    ).toBe(true);
    expect(
      rejected(
        `export const appConfig = { providers: [${providerCall}] }; appConfig.providers.pop();`
      )
    ).toBe(true);
    expect(
      rejected(
        `export const appConfig = { providers: [${providerCall}] }; registerProviders(appConfig);`
      )
    ).toBe(true);
    expect(
      rejected(
        `export const appConfig = { providers: [${providerCall}] }; Object.defineProperty(appConfig, 'providers', { value: [] });`
      )
    ).toBe(true);
    expect(
      rejected(
        `export const appConfig = { providers: [${providerCall}], mutate: () => appConfig.providers.pop() };`
      )
    ).toBe(true);
    expect(
      rejected(
        `export const appConfig = { providers: [${providerCall}] }; export const appConfig = { providers: [] };`
      )
    ).toBe(true);
    expect(
      rejected(
        `const deadProviders = [${providerCall}]; export const appConfig = { providers: [] };`
      )
    ).toBe(true);
    const wrongComponent = inspect(
      `@Component({ providers: [${providerCall}], template: '' }) export class WrongComponent {}`
    );
    expect(wrongComponent.issues).toEqual([]);
    expect(
      auditProviderProvenance(
        [
          {
            relativeFileName: 'src/app/persistence.component.ts',
            providerCalls: wrongComponent.providerCalls,
          },
        ],
        'src/app/persistence.component.ts',
        { kind: 'component', component: 'PersistenceComponent' }
      )
    ).not.toEqual([]);
    expect(
      rejected(
        `export const appConfig = { providers: [...baseProviders, ${providerCall}] };`
      )
    ).toBe(true);
    expect(
      rejected(
        `const providers = [${providerCall}]; export const appConfig = { providers };`
      )
    ).toBe(true);
    expect(
      rejected(`export const appConfig = { ['providers']: [${providerCall}] };`)
    ).toBe(true);
    expect(
      rejected(
        `export const appConfig = { providers: [${providerCall}], providers: [] };`
      )
    ).toBe(true);
    expect(
      rejected(
        `export const appConfig = { providers: [${providerCall}], ...override };`
      )
    ).toBe(true);
    expect(
      rejected(
        `@Component({ providers: [...baseProviders, ${providerCall}], template: '' }) export class PersistenceComponent {}`
      )
    ).toBe(true);
    expect(
      rejected(
        `@Component({ ['providers']: [${providerCall}], template: '' }) export class PersistenceComponent {}`
      )
    ).toBe(true);
    const inspectWithoutComponentImport = (source: string) =>
      inspectRuntimeTargetSource(
        `${preamble.replace(
          "import { Component } from '@angular/core';",
          ''
        )}\n${source}`,
        'src/app/persistence.component.ts',
        'langgraph'
      );
    const rejectsRawComponentOwner = (source: string): boolean =>
      inspectWithoutComponentImport(source).issues.some(
        ({ kind }) => kind === 'noncanonical-provider-wiring'
      );
    expect(
      rejectsRawComponentOwner(
        `function Component(_metadata: unknown) { return () => undefined; }
         @Component({ providers: [${providerCall}], template: '' }) export class PersistenceComponent {}`
      )
    ).toBe(true);
    expect(
      rejectsRawComponentOwner(
        `import { Component as NgComponent } from '@angular/core';
         @NgComponent({ providers: [${providerCall}], template: '' }) export class PersistenceComponent {}`
      )
    ).toBe(true);
    expect(
      rejected(
        `const Component = fakeComponent;
         @Component({ providers: [${providerCall}], template: '' }) export class PersistenceComponent {}`
      )
    ).toBe(true);
    expect(
      rejected(
        `Component = fakeComponent;
         @Component({ providers: [${providerCall}], template: '' }) export class PersistenceComponent {}`
      )
    ).toBe(true);
  });

  it('rejects comment-only, wrong, helper-indirected, and duplicate Threads root providers', () => {
    const inspect = (
      source: string,
      relativeFileName = 'src/app/app.config.ts'
    ) => {
      const inspection = inspectRuntimeTargetSource(
        source,
        relativeFileName,
        'langgraph'
      );
      return {
        relativeFileName,
        angularProviders: inspection.angularProviders,
        issues: inspection.issues,
      };
    };
    const factory = (body: string) => `() => {
      const connection = injectCockpitRuntimeConnection();
      if (connection.adapter !== 'langgraph') {
        throw new Error('incompatible runtime');
      }
      ${body}
    }`;
    const validSource = `
      import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';
      import { LANGGRAPH_CLIENT_OPTIONS, LANGGRAPH_THREADS_CONFIG } from '@threadplane/langgraph';
      export const appConfig = { providers: [
        { provide: LANGGRAPH_THREADS_CONFIG, useFactory: ${factory(
          'return { apiUrl: connection.apiUrl };'
        )} },
        { provide: LANGGRAPH_CLIENT_OPTIONS, useFactory: ${factory(
          'return connection.clientOptions;'
        )} },
      ] };
    `;

    expect(auditThreadsRootProviders([inspect(validSource)])).toEqual([]);
    expect(
      auditThreadsRootProviders([
        inspect(
          validSource.replace(
            "from '@threadplane/langgraph';",
            "from './fake-langgraph';"
          )
        ),
      ])
    ).not.toEqual([]);
    expect(
      auditThreadsRootProviders([
        inspect(
          validSource.replace(
            "import { LANGGRAPH_CLIENT_OPTIONS, LANGGRAPH_THREADS_CONFIG } from '@threadplane/langgraph';",
            'const LANGGRAPH_CLIENT_OPTIONS = fakeClientOptions; const LANGGRAPH_THREADS_CONFIG = fakeThreadsConfig;'
          )
        ),
      ])
    ).not.toEqual([]);
    expect(
      auditThreadsRootProviders([
        inspect(`
          // provide: LANGGRAPH_THREADS_CONFIG, useFactory: () => ({ apiUrl: connection.apiUrl })
          export const appConfig = { providers: [
            { provide: LANGGRAPH_CLIENT_OPTIONS, useFactory: ${factory(
              'return connection.clientOptions;'
            )} },
          ] };
        `),
      ])
    ).toContain(
      'LANGGRAPH_THREADS_CONFIG canonical provider in src/app/app.config.ts'
    );
    expect(
      auditThreadsRootProviders([inspect(validSource, 'src/app/orphan.ts')])
    ).toEqual([
      'LANGGRAPH_THREADS_CONFIG canonical provider in src/app/app.config.ts',
      'LANGGRAPH_CLIENT_OPTIONS canonical provider in src/app/app.config.ts',
    ]);
    expect(
      auditThreadsRootProviders([
        inspect(
          validSource.replace(
            'return { apiUrl: connection.apiUrl };',
            'return { apiUrl: other.apiUrl };'
          )
        ),
      ])
    ).toContain(
      'LANGGRAPH_THREADS_CONFIG canonical provider in src/app/app.config.ts'
    );
    expect(
      auditThreadsRootProviders([
        inspect(
          validSource.replace(
            `useFactory: ${factory('return connection.clientOptions;')}`,
            'useFactory: makeClientOptions'
          )
        ),
      ])
    ).toContain(
      'LANGGRAPH_CLIENT_OPTIONS canonical provider in src/app/app.config.ts'
    );
    expect(
      auditThreadsRootProviders([
        inspect(
          validSource.replace(
            '] };',
            `, { provide: LANGGRAPH_THREADS_CONFIG, useFactory: ${factory(
              'return { apiUrl: connection.apiUrl };'
            )} }] };`
          )
        ),
      ])
    ).toContain(
      'LANGGRAPH_THREADS_CONFIG canonical provider in src/app/app.config.ts'
    );
    const earlyThreadsFactory = `() => {
      return { apiUrl: connection.apiUrl };
      const connection = injectCockpitRuntimeConnection();
      if (connection.adapter !== 'langgraph') {
        throw new Error('incompatible runtime');
      }
    }`;
    expect(
      auditThreadsRootProviders([
        inspect(
          validSource.replace(
            factory('return { apiUrl: connection.apiUrl };'),
            earlyThreadsFactory
          )
        ),
      ])
    ).toContain(
      'LANGGRAPH_THREADS_CONFIG canonical provider in src/app/app.config.ts'
    );
    const nestedClientFactory = `() => {
      const connection = injectCockpitRuntimeConnection();
      if (connection.adapter !== 'langgraph') {
        throw new Error('incompatible runtime');
      }
      if (flag) return connection.clientOptions;
      return connection.clientOptions;
    }`;
    expect(
      auditThreadsRootProviders([
        inspect(
          validSource.replace(
            factory('return connection.clientOptions;'),
            nestedClientFactory
          )
        ),
      ])
    ).toContain(
      'LANGGRAPH_CLIENT_OPTIONS canonical provider in src/app/app.config.ts'
    );
    const rejectFactory = (
      validFactory: string,
      invalidFactory: string,
      token: 'LANGGRAPH_THREADS_CONFIG' | 'LANGGRAPH_CLIENT_OPTIONS'
    ): void => {
      expect(
        auditThreadsRootProviders([
          inspect(validSource.replace(validFactory, invalidFactory)),
        ])
      ).toContain(`${token} canonical provider in src/app/app.config.ts`);
    };
    const threadsReturn = 'return { apiUrl: connection.apiUrl };';
    const clientReturn = 'return connection.clientOptions;';
    rejectFactory(
      factory(threadsReturn),
      `() => {
        const connection = injectCockpitRuntimeConnection();
        throw new Error('unreachable');
        if (connection.adapter !== 'langgraph') { throw new Error('incompatible runtime'); }
        ${threadsReturn}
      }`,
      'LANGGRAPH_THREADS_CONFIG'
    );
    rejectFactory(
      factory(threadsReturn),
      `() => {
        const connection = injectCockpitRuntimeConnection();
        if (connection.adapter !== 'langgraph') { throw new Error('incompatible runtime'); }
        if (flag) ${threadsReturn}
        ${threadsReturn}
      }`,
      'LANGGRAPH_THREADS_CONFIG'
    );
    rejectFactory(
      factory(clientReturn),
      `() => {
        ${clientReturn}
        const connection = injectCockpitRuntimeConnection();
        if (connection.adapter !== 'langgraph') { throw new Error('incompatible runtime'); }
      }`,
      'LANGGRAPH_CLIENT_OPTIONS'
    );
    rejectFactory(
      factory(clientReturn),
      `() => {
        const connection = injectCockpitRuntimeConnection();
        throw new Error('unreachable');
        if (connection.adapter !== 'langgraph') { throw new Error('incompatible runtime'); }
        ${clientReturn}
      }`,
      'LANGGRAPH_CLIENT_OPTIONS'
    );
    rejectFactory(
      factory(threadsReturn),
      factory(`mutate(connection); ${threadsReturn}`),
      'LANGGRAPH_THREADS_CONFIG'
    );
    rejectFactory(
      factory(clientReturn),
      factory(`Reflect.set(connection, 'clientOptions', {}); ${clientReturn}`),
      'LANGGRAPH_CLIENT_OPTIONS'
    );
    rejectFactory(
      factory(threadsReturn),
      `(injectCockpitRuntimeConnection = fakeInjector) => {
        const connection = injectCockpitRuntimeConnection();
        if (connection.adapter !== 'langgraph') { throw new Error('incompatible runtime'); }
        ${threadsReturn}
      }`,
      'LANGGRAPH_THREADS_CONFIG'
    );
    rejectFactory(
      factory(clientReturn),
      `function injectCockpitRuntimeConnection() {
        const connection = injectCockpitRuntimeConnection();
        if (connection.adapter !== 'langgraph') { throw new Error('incompatible runtime'); }
        ${clientReturn}
      }`,
      'LANGGRAPH_CLIENT_OPTIONS'
    );
    const deadProviders = `
      export const appConfig = { providers: [] };
      ({ provide: LANGGRAPH_THREADS_CONFIG, useFactory: ${factory(
        'return { apiUrl: connection.apiUrl };'
      )} });
      ({ provide: LANGGRAPH_CLIENT_OPTIONS, useFactory: ${factory(
        'return connection.clientOptions;'
      )} });
    `;
    expect(auditThreadsRootProviders([inspect(deadProviders)])).not.toEqual([]);
    const trailingSpread = validSource.replace(
      '] };',
      ', ...runtimeProviderOverrides] };'
    );
    expect(auditThreadsRootProviders([inspect(trailingSpread)])).not.toEqual(
      []
    );
    expect(inspect(trailingSpread).issues.map(({ kind }) => kind)).toContain(
      'noncanonical-provider-wiring'
    );
    const computedProvider = validSource.replace(
      'provide: LANGGRAPH_THREADS_CONFIG',
      "['provide']: LANGGRAPH_THREADS_CONFIG"
    );
    expect(inspect(computedProvider).issues.map(({ kind }) => kind)).toContain(
      'noncanonical-provider-wiring'
    );
    const spreadProvider = validSource.replace(
      '{ provide: LANGGRAPH_THREADS_CONFIG',
      '{ ...override, provide: LANGGRAPH_THREADS_CONFIG'
    );
    expect(inspect(spreadProvider).issues.map(({ kind }) => kind)).toContain(
      'noncanonical-provider-wiring'
    );
    expect(
      inspect(
        `export const appConfig = { providers: [{ provide, useFactory }] };`
      ).issues.map(({ kind }) => kind)
    ).toContain('noncanonical-provider-wiring');
  });

  it('preserves the exact audited root, default, typed-ref, and provider-option metadata', () => {
    const configurable = capabilities.filter(
      (
        capability
      ): capability is typeof capability & {
        runtimeAdapter: 'ag-ui' | 'langgraph';
      } => capability.runtimeAdapter !== 'none'
    );
    const mismatches: Array<{ project: string; mismatch: string }> = [];

    expect(expectedRuntimeWiringByProject.size).toBe(35);
    expect(expectedRootImportSourceByProject.size).toBe(35);
    expect(
      expectedRuntimeWiring.filter(({ assistantId }) => assistantId)
    ).toHaveLength(25);
    expect(
      expectedRuntimeWiring.filter(({ sharedUrl }) => sharedUrl)
    ).toHaveLength(10);
    expect(
      expectedRuntimeWiring.filter(({ agentRef }) => agentRef)
    ).toHaveLength(4);
    expect([...expectedRuntimeWiringByProject.keys()].sort()).toEqual(
      configurable.map(({ angularProject }) => angularProject).sort()
    );
    expect([...expectedRootImportSourceByProject.keys()].sort()).toEqual(
      configurable.map(({ angularProject }) => angularProject).sort()
    );

    for (const capability of configurable) {
      const expected = expectedRuntimeWiringByProject.get(
        capability.angularProject
      );
      if (!expected) continue;
      const projectRoot = resolve(
        cockpitRoot,
        capability.product,
        capability.topic,
        'angular'
      );
      const entryPoints = ['main.ts', 'main.cockpit.ts'].map((fileName) => ({
        fileName,
        source: readFileSync(resolve(projectRoot, 'src', fileName), 'utf8'),
      }));
      const providerSources = angularSourceFiles(projectRoot)
        .filter((fileName) => !fileName.includes('/src/environments/'))
        .map((fileName) => {
          const relativeFileName = fileName.slice(projectRoot.length + 1);
          return {
            relativeFileName,
            providerCalls: inspectRuntimeTargetSource(
              readFileSync(fileName, 'utf8'),
              relativeFileName,
              capability.runtimeAdapter
            ).providerCalls,
          };
        });
      const providerCalls = providerSources.flatMap(
        ({ providerCalls }) => providerCalls
      );
      for (const mismatch of auditProviderProvenance(
        providerSources,
        expected.providerSource,
        expectedProviderOwner(expected)
      )) {
        mismatches.push({
          project: capability.angularProject,
          mismatch,
        });
      }

      for (const provider of providerCalls) {
        const bindingProvider = provider as CanonicalProviderCall & {
          provideAgentBinding?: SemanticBindingInspection;
          agentRefBinding?: SemanticBindingInspection;
        };
        const providerModule =
          capability.runtimeAdapter === 'ag-ui'
            ? '@threadplane/ag-ui'
            : '@threadplane/langgraph';
        if (
          !hasExactSemanticBinding(
            bindingProvider.provideAgentBinding,
            providerModule,
            'provideAgent'
          )
        ) {
          mismatches.push({
            project: capability.angularProject,
            mismatch: `provideAgent import from ${providerModule}`,
          });
        }
        if (
          expected.agentRef &&
          !hasExactSemanticBinding(
            bindingProvider.agentRefBinding,
            './agent-ref',
            expected.agentRef
          )
        ) {
          mismatches.push({
            project: capability.angularProject,
            mismatch: `typed ref ${expected.agentRef} import from ./agent-ref`,
          });
        }
      }

      for (const { fileName, source } of entryPoints) {
        const bootstrap = inspectRuntimeTargetSource(
          source,
          fileName,
          capability.runtimeAdapter
        ).bootstrapCalls[0];
        for (const mismatch of auditEntrypointMetadata(
          bootstrap,
          expected,
          capability.runtimeAdapter
        )) {
          mismatches.push({
            project: capability.angularProject,
            mismatch: `${fileName}: ${mismatch}`,
          });
        }
      }

      const actualAgentRefs = providerCalls
        .map(({ agentRef }) => agentRef)
        .filter((agentRef): agentRef is string => !!agentRef)
        .sort();
      const expectedAgentRefs = expected.agentRef ? [expected.agentRef] : [];
      if (
        JSON.stringify(actualAgentRefs) !== JSON.stringify(expectedAgentRefs)
      ) {
        mismatches.push({
          project: capability.angularProject,
          mismatch: `typed refs ${
            actualAgentRefs.join(', ') || '(none)'
          }; expected ${expectedAgentRefs.join(', ') || '(none)'}`,
        });
      }
      if (
        expected.retainedProviderProperties &&
        !hasExpectedProviderProperties(
          providerCalls,
          expected.retainedProviderProperties
        )
      ) {
        mismatches.push({
          project: capability.angularProject,
          mismatch: `retained provider properties ${JSON.stringify(
            expected.retainedProviderProperties
          )}`,
        });
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('rejects swapped roots, assistants, shared defaults, and typed refs', () => {
    const langGraphExpected: ExpectedRuntimeWiring = {
      project: 'fixture',
      rootComponent: 'StreamingComponent',
      providerSource: 'src/app/app.config.ts',
      assistantId: 'environment.streamingAssistantId',
      agentRef: 'STREAMING_AGENT',
    };
    const validLangGraph = `
      void bootstrapWithCockpitHarness(StreamingComponent, appConfig, {
        runtime: {
          adapter: 'langgraph',
          sharedApiUrl: environment.langGraphApiUrl,
          assistantId: environment.streamingAssistantId,
          operationReporterToken: ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER,
        },
      }).catch(() => undefined);
    `;
    const bootstrapRecord = (
      source: string,
      adapter: 'ag-ui' | 'langgraph'
    ): BootstrapCallRecord | undefined =>
      inspectRuntimeTargetSource(source, 'main.ts', adapter).bootstrapCalls[0];

    expect(
      auditEntrypointMetadata(
        bootstrapRecord(
          `${validLangGraph.replace(
            'StreamingComponent',
            'MessagesComponent'
          )}\n// Expected: bootstrapWithCockpitHarness(StreamingComponent, appConfig, ...)`,
          'langgraph'
        ),
        langGraphExpected,
        'langgraph'
      )
    ).toContain('root StreamingComponent');
    expect(
      auditEntrypointMetadata(
        bootstrapRecord(
          `${validLangGraph.replace(
            'environment.streamingAssistantId',
            'environment.clientToolsAssistantId'
          )}\n// assistantId: environment.streamingAssistantId`,
          'langgraph'
        ),
        langGraphExpected,
        'langgraph'
      )
    ).toContain('assistantId environment.streamingAssistantId');
    expect(
      auditEntrypointMetadata(
        bootstrapRecord(
          validLangGraph.replace(
            'environment.langGraphApiUrl',
            'environment.otherApiUrl'
          ),
          'langgraph'
        ),
        langGraphExpected,
        'langgraph'
      )
    ).toContain('sharedApiUrl environment.langGraphApiUrl');

    const agUiExpected: ExpectedRuntimeWiring = {
      project: 'fixture',
      rootComponent: 'StreamingComponent',
      providerSource: 'src/app/app.config.ts',
      sharedUrl: "new URL('agent', document.baseURI).pathname",
    };
    expect(
      auditEntrypointMetadata(
        bootstrapRecord(
          `void bootstrapWithCockpitHarness(StreamingComponent, appConfig, {
            runtime: {
              adapter: 'ag-ui',
              sharedUrl: '/wrong-agent',
              operationReporterToken: ɵAG_UI_RUNTIME_OPERATION_REPORTER,
            },
          }).catch(() => undefined);`,
          'ag-ui'
        ),
        agUiExpected,
        'ag-ui'
      )
    ).toContain("sharedUrl new URL('agent', document.baseURI).pathname");
    const canonicalProviderPreamble = `
      import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';
      import { provideAgent } from '@threadplane/langgraph';
    `;
    const executableWrongRef = `${canonicalProviderPreamble}
      provideAgent(MESSAGES_AGENT, () => {
        const connection = injectCockpitRuntimeConnection();
        return {
          apiUrl: connection.apiUrl,
          assistantId: connection.assistantId,
          clientOptions: connection.clientOptions,
        };
      });
    `;
    expect(
      inspectRuntimeTargetSource(
        executableWrongRef,
        'src/app/app.config.ts',
        'langgraph'
      ).providerCalls.map(({ agentRef }) => agentRef)
    ).toEqual(['MESSAGES_AGENT']);
    expect(
      inspectRuntimeTargetSource(
        `${canonicalProviderPreamble}// provideAgent(STREAMING_AGENT, () => ({}))`,
        'src/app/app.config.ts',
        'langgraph'
      ).providerCalls
    ).toEqual([]);
    const commentOnlyOption = `${canonicalProviderPreamble}
      provideAgent(() => {
        const connection = injectCockpitRuntimeConnection();
        return {
          apiUrl: connection.apiUrl,
          assistantId: connection.assistantId,
          clientOptions: connection.clientOptions,
          // subagentToolNames: ['task']
        };
      });
    `;
    expect(
      hasExpectedProviderProperties(
        inspectRuntimeTargetSource(
          commentOnlyOption,
          'src/app/app.config.ts',
          'langgraph'
        ).providerCalls,
        { subagentToolNames: "['task']" }
      )
    ).toBe(false);
  });

  it('requires bootstrap argument two to resolve to the canonical appConfig import', () => {
    type AppConfigBootstrapRecord = BootstrapCallRecord & {
      appConfigArgument?: string;
      hasCanonicalAppConfigBinding?: boolean;
      hasCanonicalHarnessBinding?: boolean;
      hasCanonicalCallOwner?: boolean;
    };
    const runtimeOptions = `{
      runtime: {
        adapter: 'langgraph',
        sharedApiUrl: environment.langGraphApiUrl,
        assistantId: environment.streamingAssistantId,
        operationReporterToken: ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER,
      },
    }`;
    const inspectBootstrap = (source: string): AppConfigBootstrapRecord =>
      inspectRuntimeTargetSource(source, 'main.ts', 'langgraph')
        .bootstrapCalls[0] as AppConfigBootstrapRecord;
    const call = (config: string) =>
      `void bootstrapWithCockpitHarness(StreamingComponent, ${config}, ${runtimeOptions}).catch(() => undefined);`;
    const canonicalImport =
      `import { bootstrapWithCockpitHarness } from '@threadplane/cockpit-telemetry';
       import { appConfig } from './app/app.config';`;

    expect(inspectBootstrap(`${canonicalImport}\n${call('appConfig')}`)).toMatchObject({
      appConfigArgument: 'appConfig',
      hasCanonicalAppConfigBinding: true,
      hasCanonicalHarnessBinding: true,
      hasCanonicalCallOwner: true,
    });
    expect(
      inspectBootstrap(
        `${canonicalImport}\ntype AppConfigShape = typeof appConfig;\n${call(
          'appConfig'
        )}`
      ).hasCanonicalAppConfigBinding
    ).toBe(true);
    expect(
      inspectBootstrap(
        `${canonicalImport}\nstrip(appConfig);\n${call('appConfig')}`
      ).hasCanonicalAppConfigBinding
    ).toBe(false);
    expect(
      inspectBootstrap(
        `${canonicalImport}\nconst configAlias = appConfig;\n${call(
          'appConfig'
        )}`
      ).hasCanonicalAppConfigBinding
    ).toBe(false);
    expect(
      inspectBootstrap(
        `${canonicalImport}\nvoid appConfig;\n${call('appConfig')}`
      ).hasCanonicalAppConfigBinding
    ).toBe(false);
    expect(
      inspectBootstrap(
        `${canonicalImport}\nqueueMicrotask(() => inspectConfig(appConfig));\n${call(
          'appConfig'
        )}`
      ).hasCanonicalAppConfigBinding
    ).toBe(false);
    expect(
      inspectBootstrap(`${canonicalImport}\n${call('{ providers: [] }')}`)
        .hasCanonicalAppConfigBinding
    ).toBe(false);
    expect(
      inspectBootstrap(`${canonicalImport}\n${call('otherConfig')}`)
        .hasCanonicalAppConfigBinding
    ).toBe(false);
    expect(
      inspectBootstrap(
        `import { bootstrapWithCockpitHarness } from '@threadplane/cockpit-telemetry';
         import { appConfig as config } from './app/app.config';\n${call(
          'config'
        )}`
      ).hasCanonicalAppConfigBinding
    ).toBe(false);
    expect(
      inspectBootstrap(
        `${canonicalImport}\nfunction start(appConfig: object) { ${call(
          'appConfig'
        )} }`
      ).hasCanonicalAppConfigBinding
    ).toBe(false);
    expect(
      inspectBootstrap(
        `${canonicalImport}\nappConfig = otherConfig;\n${call('appConfig')}`
      ).hasCanonicalAppConfigBinding
    ).toBe(false);
    expect(
      inspectBootstrap(`${canonicalImport}\n${call('{ ...appConfig }')}`)
        .hasCanonicalAppConfigBinding
    ).toBe(false);
    expect(
      inspectBootstrap(`${canonicalImport}\n${call('resolveConfig(appConfig)')}`)
        .hasCanonicalAppConfigBinding
    ).toBe(false);
    expect(
      inspectBootstrap(
        `import { bootstrapWithCockpitHarness } from '@threadplane/cockpit-telemetry';
         import { appConfig } from './app/not-app.config';\n${call(
          'appConfig'
        )}`
      ).hasCanonicalAppConfigBinding
    ).toBe(false);

    const fakeHarness = inspectBootstrap(
      `import { appConfig } from './app/app.config';
       const bootstrapWithCockpitHarness = fakeHarness;
       ${call('appConfig')}`
    );
    expect(fakeHarness.hasCanonicalHarnessBinding).toBe(false);
    expect(fakeHarness.hasCanonicalCallOwner).toBe(true);
    expect(
      inspectRuntimeTargetSource(
        `import { bootstrapWithCockpitHarness as bootstrap } from '@threadplane/cockpit-telemetry';
         import { appConfig } from './app/app.config';
         void bootstrap(StreamingComponent, appConfig, ${runtimeOptions}).catch(() => undefined);`,
        'main.ts',
        'langgraph'
      ).bootstrapCalls
    ).toEqual([]);
    expect(
      inspectBootstrap(
        `${canonicalImport}
         bootstrapWithCockpitHarness = fakeHarness;
         ${call('appConfig')}`
      ).hasCanonicalHarnessBinding
    ).toBe(false);

    const loopShadow = inspectBootstrap(
      `${canonicalImport}
       for (const bootstrapWithCockpitHarness of harnesses) {
         ${call('appConfig')}
       }`
    );
    expect(loopShadow.hasCanonicalHarnessBinding).toBe(false);
    expect(loopShadow.hasCanonicalCallOwner).toBe(false);
    const namedFunctionShadow = inspectBootstrap(
      `${canonicalImport}
       const start = function bootstrapWithCockpitHarness() {
         ${call('appConfig')}
       };`
    );
    expect(namedFunctionShadow.hasCanonicalHarnessBinding).toBe(false);
    expect(namedFunctionShadow.hasCanonicalCallOwner).toBe(false);
    const namedClassShadow = inspectBootstrap(
      `${canonicalImport}
       const Runner = class bootstrapWithCockpitHarness {
         static start() { ${call('appConfig')} }
       };`
    );
    expect(namedClassShadow.hasCanonicalHarnessBinding).toBe(false);
    expect(namedClassShadow.hasCanonicalCallOwner).toBe(false);
    const duplicateCalls = inspectRuntimeTargetSource(
      `${canonicalImport}\n${call('appConfig')}\n${call('appConfig')}`,
      'main.ts',
      'langgraph'
    ).bootstrapCalls;
    expect(duplicateCalls).toHaveLength(2);
    expect(
      duplicateCalls.every(
        (record) =>
          !(record as AppConfigBootstrapRecord).hasCanonicalCallOwner
      )
    ).toBe(true);
  });

  it('pins every semantic runtime identifier to its exact stable import', () => {
    type SemanticBootstrapRecord = BootstrapCallRecord & {
      rootComponentBinding?: SemanticBindingInspection;
      environmentBindings?: readonly SemanticBindingInspection[];
      operationReporterBinding?: SemanticBindingInspection;
    };
    type SemanticProviderCall = CanonicalProviderCall & {
      provideAgentBinding?: SemanticBindingInspection;
      agentRefBinding?: SemanticBindingInspection;
    };
    const runtimeOptions = `{
      runtime: {
        adapter: 'langgraph',
        sharedApiUrl: environment.langGraphApiUrl,
        assistantId: environment.streamingAssistantId,
        operationReporterToken: ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER,
      },
    }`;
    const bootstrapImports = `
      import { ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER } from '@threadplane/langgraph';
      import { bootstrapWithCockpitHarness } from '@threadplane/cockpit-telemetry';
      import { appConfig } from './app/app.config';
      import { StreamingComponent } from './app/streaming.component';
      import { environment } from './environments/environment';
    `;
    const bootstrapCall = `void bootstrapWithCockpitHarness(
      StreamingComponent,
      appConfig,
      ${runtimeOptions}
    ).catch(() => undefined);`;
    const inspectBootstrap = (source: string): SemanticBootstrapRecord =>
      inspectRuntimeTargetSource(source, 'main.ts', 'langgraph')
        .bootstrapCalls[0] as SemanticBootstrapRecord;
    const canonicalBootstrap = inspectBootstrap(
      `${bootstrapImports}\n${bootstrapCall}`
    );
    expect(
      hasExactSemanticBinding(
        canonicalBootstrap.rootComponentBinding,
        './app/streaming.component',
        'StreamingComponent'
      )
    ).toBe(true);
    expect(canonicalBootstrap.environmentBindings).toHaveLength(2);
    expect(
      canonicalBootstrap.environmentBindings?.every((binding) =>
        hasExactSemanticBinding(
          binding,
          './environments/environment',
          'environment'
        )
      )
    ).toBe(true);
    expect(
      hasExactSemanticBinding(
        canonicalBootstrap.operationReporterBinding,
        '@threadplane/langgraph',
        'ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER'
      )
    ).toBe(true);
    expect(
      hasExactSemanticBinding(
        inspectBootstrap(
          `${bootstrapImports.replace(
            "import { StreamingComponent } from './app/streaming.component';",
            "import { OtherComponent as StreamingComponent } from './app/wrong.component';"
          )}\n${bootstrapCall}`
        ).rootComponentBinding,
        './app/streaming.component',
        'StreamingComponent'
      )
    ).toBe(false);
    expect(
      hasExactSemanticBinding(
        inspectBootstrap(
          `${bootstrapImports.replace(
            "import { StreamingComponent } from './app/streaming.component';",
            'const StreamingComponent = FakeComponent;'
          )}\n${bootstrapCall}`
        ).rootComponentBinding,
        './app/streaming.component',
        'StreamingComponent'
      )
    ).toBe(false);
    expect(
      inspectBootstrap(
        `${bootstrapImports.replace(
          "import { environment } from './environments/environment';",
          'const environment = fakeEnvironment;'
        )}\n${bootstrapCall}`
      ).environmentBindings?.some((binding) => binding.canonical)
    ).toBe(false);
    expect(
      inspectBootstrap(
        `${bootstrapImports.replace(
          "import { environment } from './environments/environment';",
          "import { fakeEnvironment as environment } from './fake-environment';"
        )}\n${bootstrapCall}`
      ).environmentBindings?.some((binding) => binding.canonical)
    ).toBe(false);
    expect(
      hasExactSemanticBinding(
        inspectBootstrap(
          `${bootstrapImports.replace(
            "import { ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER } from '@threadplane/langgraph';",
            'const ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER = fakeReporter;'
          )}\n${bootstrapCall}`
        ).operationReporterBinding,
        '@threadplane/langgraph',
        'ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER'
      )
    ).toBe(false);
    const providerFactory = `() => {
      const connection = injectCockpitRuntimeConnection();
      if (connection.adapter !== 'langgraph') {
        throw new Error('incompatible runtime');
      }
      return {
        apiUrl: connection.apiUrl,
        assistantId: connection.assistantId,
        clientOptions: connection.clientOptions,
      };
    }`;
    const inspectProvider = (imports: string): SemanticProviderCall | undefined =>
      inspectRuntimeTargetSource(
        `${imports}
         import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';
         export const appConfig = { providers: [
           provideAgent(STREAMING_AGENT, ${providerFactory})
         ] };`,
        'src/app/app.config.ts',
        'langgraph'
      ).providerCalls[0] as SemanticProviderCall | undefined;
    const canonicalProvider = inspectProvider(`
      import { provideAgent } from '@threadplane/langgraph';
      import { STREAMING_AGENT } from './agent-ref';
    `);
    expect(
      hasExactSemanticBinding(
        canonicalProvider?.provideAgentBinding,
        '@threadplane/langgraph',
        'provideAgent'
      )
    ).toBe(true);
    expect(
      hasExactSemanticBinding(
        canonicalProvider?.agentRefBinding,
        './agent-ref',
        'STREAMING_AGENT'
      )
    ).toBe(true);
    expect(
      hasExactSemanticBinding(
        inspectProvider(`
          import { provideAgent } from './fake-agent';
          import { STREAMING_AGENT } from './agent-ref';
        `)?.provideAgentBinding,
        '@threadplane/langgraph',
        'provideAgent'
      )
    ).toBe(false);
    expect(
      hasExactSemanticBinding(
        inspectProvider(`
          const provideAgent = fakeProvideAgent;
          import { STREAMING_AGENT } from './agent-ref';
        `)?.provideAgentBinding,
        '@threadplane/langgraph',
        'provideAgent'
      )
    ).toBe(false);
    expect(
      hasExactSemanticBinding(
        inspectProvider(`
          import { provideAgent } from '@threadplane/langgraph';
          const STREAMING_AGENT = fakeAgentRef;
        `)?.agentRefBinding,
        './agent-ref',
        'STREAMING_AGENT'
      )
    ).toBe(false);
    expect(
      hasExactSemanticBinding(
        inspectProvider(`
          import { provideAgent } from '@threadplane/langgraph';
          import { STREAMING_AGENT } from './fake-agent-ref';
        `)?.agentRefBinding,
        './agent-ref',
        'STREAMING_AGENT'
      )
    ).toBe(false);
  });

  it('allows the LangGraph environment import only as the two runtime property roots', () => {
    const imports = `
      import { ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER } from '@threadplane/langgraph';
      import { bootstrapWithCockpitHarness } from '@threadplane/cockpit-telemetry';
      import { appConfig } from './app/app.config';
      import { StreamingComponent } from './app/streaming.component';
      import { environment } from './environments/environment';
    `;
    const bootstrapCall = `void bootstrapWithCockpitHarness(
      StreamingComponent,
      appConfig,
      {
        runtime: {
          adapter: 'langgraph',
          sharedApiUrl: environment.langGraphApiUrl,
          assistantId: environment.streamingAssistantId,
          operationReporterToken: ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER,
        },
      }
    ).catch(() => undefined);`;
    const inspectEnvironmentBindings = (extraSource = '') =>
      inspectRuntimeTargetSource(
        `${imports}\n${extraSource}\n${bootstrapCall}`,
        'main.ts',
        'langgraph'
      ).bootstrapCalls[0]?.environmentBindings ?? [];
    const hasCanonicalEnvironmentBindings = (extraSource = '') => {
      const bindings = inspectEnvironmentBindings(extraSource);
      return (
        bindings.length === 2 &&
        bindings.every((binding) =>
          hasExactSemanticBinding(
            binding,
            './environments/environment',
            'environment'
          )
        )
      );
    };

    expect(hasCanonicalEnvironmentBindings()).toBe(true);
    expect(
      hasCanonicalEnvironmentBindings(
        'type EnvironmentShape = typeof environment;'
      )
    ).toBe(true);
    expect(hasCanonicalEnvironmentBindings('retarget(environment);')).toBe(
      false
    );
    expect(
      hasCanonicalEnvironmentBindings('const environmentAlias = environment;')
    ).toBe(false);
    expect(hasCanonicalEnvironmentBindings('void environment;')).toBe(false);
    expect(
      hasCanonicalEnvironmentBindings(
        'queueMicrotask(() => retarget(environment));'
      )
    ).toBe(false);
    expect(
      hasCanonicalEnvironmentBindings(
        "environment.langGraphApiUrl = 'https://other.example';"
      )
    ).toBe(false);
  });

  it('requires exact runtime option objects and pristine AG URL globals', () => {
    type RuntimeBootstrapRecord = BootstrapCallRecord & {
      hasCanonicalRuntimeOptions?: boolean;
      hasPristineAgUrlGlobals?: boolean;
    };
    const imports = `
      import { ɵAG_UI_RUNTIME_OPERATION_REPORTER } from '@threadplane/ag-ui';
      import { bootstrapWithCockpitHarness } from '@threadplane/cockpit-telemetry';
      import { appConfig } from './app/app.config';
      import { StreamingComponent } from './app/streaming.component';
    `;
    const runtime = `{
      adapter: 'ag-ui',
      sharedUrl: new URL('agent', document.baseURI).pathname,
      operationReporterToken: ɵAG_UI_RUNTIME_OPERATION_REPORTER,
    }`;
    const call = (options: string) =>
      `void bootstrapWithCockpitHarness(StreamingComponent, appConfig, ${options}).catch(() => undefined);`;
    const inspectBootstrap = (source: string): RuntimeBootstrapRecord =>
      inspectRuntimeTargetSource(source, 'main.ts', 'ag-ui')
        .bootstrapCalls[0] as RuntimeBootstrapRecord;

    expect(inspectBootstrap(`${imports}\n${call(`{ runtime: ${runtime} }`)}`)).toMatchObject({
      hasCanonicalRuntimeOptions: true,
      hasPristineAgUrlGlobals: true,
    });
    expect(
      inspectBootstrap(
        `${imports}\n${call(`{ ...outerDefaults, runtime: ${runtime} }`)}`
      ).hasCanonicalRuntimeOptions
    ).toBe(false);
    expect(
      inspectBootstrap(
        `${imports}\n${call(`{ runtime: { ...runtimeDefaults,
          adapter: 'ag-ui',
          sharedUrl: new URL('agent', document.baseURI).pathname,
          operationReporterToken: ɵAG_UI_RUNTIME_OPERATION_REPORTER,
        } }`)}`
      ).hasCanonicalRuntimeOptions
    ).toBe(false);
    expect(
      inspectBootstrap(
        `${imports}\n${call(`{ runtime: ${runtime}, runtime: fakeRuntime }`)}`
      ).hasCanonicalRuntimeOptions
    ).toBe(false);
    expect(
      inspectBootstrap(
        `${imports}\n${call(`{ ['runtime']: ${runtime} }`)}`
      ).hasCanonicalRuntimeOptions
    ).toBe(false);
    expect(
      inspectBootstrap(
        `${imports}\n${call(`{ runtime: {
          adapter: 'ag-ui',
          sharedUrl: new URL('agent', document.baseURI).pathname,
          operationReporterToken: ɵAG_UI_RUNTIME_OPERATION_REPORTER,
          adapter: fakeAdapter,
        } }`)}`
      ).hasCanonicalRuntimeOptions
    ).toBe(false);
    expect(
      inspectBootstrap(
        `${imports}\n${call(`{ runtime: {
          adapter: 'ag-ui',
          sharedUrl,
          operationReporterToken: ɵAG_UI_RUNTIME_OPERATION_REPORTER,
        } }`)}`
      ).hasCanonicalRuntimeOptions
    ).toBe(false);
    expect(
      inspectBootstrap(
        `${imports}\n${call(`{ runtime: {
          adapter: 'ag-ui',
          sharedUrl: new URL('agent', document.baseURI).pathname,
          operationReporterToken,
        } }`)}`
      ).hasCanonicalRuntimeOptions
    ).toBe(false);
    expect(
      inspectBootstrap(
        `${imports}\n${call(`{ runtime: {
          adapter: 'ag-ui',
          sharedUrl: new URL('agent', document.baseURI).pathname,
          ['operationReporterToken']: ɵAG_UI_RUNTIME_OPERATION_REPORTER,
        } }`)}`
      ).hasCanonicalRuntimeOptions
    ).toBe(false);
    expect(
      inspectBootstrap(
        `${imports}\n${call(`{ runtime: {
          adapter: 'ag-ui',
          sharedUrl: new URL('agent', document.baseURI).pathname,
          operationReporterToken: ɵAG_UI_RUNTIME_OPERATION_REPORTER,
          harmlessExtra: true,
        } }`)}`
      ).hasCanonicalRuntimeOptions
    ).toBe(false);

    expect(
      inspectBootstrap(
        `${imports}\nconst URL = FakeURL;\n${call(`{ runtime: ${runtime} }`)}`
      ).hasPristineAgUrlGlobals
    ).toBe(false);
    expect(
      inspectBootstrap(
        `${imports}\nimport { URL } from './fake-url';\n${call(
          `{ runtime: ${runtime} }`
        )}`
      ).hasPristineAgUrlGlobals
    ).toBe(false);
    expect(
      inspectBootstrap(
        `${imports}\nimport document from './fake-document';\n${call(
          `{ runtime: ${runtime} }`
        )}`
      ).hasPristineAgUrlGlobals
    ).toBe(false);
    expect(
      inspectBootstrap(
        `${imports}\nconst document = fakeDocument;\n${call(
          `{ runtime: ${runtime} }`
        )}`
      ).hasPristineAgUrlGlobals
    ).toBe(false);
    expect(
      inspectBootstrap(
        `${imports}\nURL = FakeURL;\n${call(`{ runtime: ${runtime} }`)}`
      ).hasPristineAgUrlGlobals
    ).toBe(false);
    expect(
      inspectBootstrap(
        `${imports}\nObject.assign(document, fakeDocument);\n${call(
          `{ runtime: ${runtime} }`
        )}`
      ).hasPristineAgUrlGlobals
    ).toBe(false);
    expect(
      inspectBootstrap(
        `${imports}\nmutateGlobal(URL);\n${call(`{ runtime: ${runtime} }`)}`
      ).hasPristineAgUrlGlobals
    ).toBe(false);
    expect(
      inspectBootstrap(
        `${imports}\nmutateGlobal(document);\n${call(
          `{ runtime: ${runtime} }`
        )}`
      ).hasPristineAgUrlGlobals
    ).toBe(false);
    expect(
      inspectBootstrap(
        `${imports}\n${call(`{ runtime: {
          adapter: 'ag-ui',
          sharedUrl: new RuntimeURL('agent', document.baseURI).pathname,
          operationReporterToken: ɵAG_UI_RUNTIME_OPERATION_REPORTER,
        } }`)}`
      ).hasCanonicalRuntimeOptions
    ).toBe(false);
    expect(
      inspectBootstrap(
        `${imports}\nfunction start(URL: typeof globalThis.URL) {
          ${call(`{ runtime: ${runtime} }`)}
        }`
      ).hasPristineAgUrlGlobals
    ).toBe(false);
    expect(
      inspectBootstrap(
        `${imports}\nfor (const document of documents) {
          ${call(`{ runtime: ${runtime} }`)}
        }`
      ).hasPristineAgUrlGlobals
    ).toBe(false);
    expect(
      inspectBootstrap(
        `${imports}\ntry { throw fakeDocument; } catch (document) {
          ${call(`{ runtime: ${runtime} }`)}
        }`
      ).hasPristineAgUrlGlobals
    ).toBe(false);
    expect(
      inspectBootstrap(
        `${imports}\nconst start = function URL() {
          ${call(`{ runtime: ${runtime} }`)}
        };`
      ).hasPristineAgUrlGlobals
    ).toBe(false);
  });

  it('preserves typed, option-bearing, and component-scoped provider patterns', () => {
    const read = (path: string): string =>
      readFileSync(resolve(cockpitRoot, path), 'utf8');
    const providerCalls = (path: string): CanonicalProviderCall[] =>
      inspectRuntimeTargetSource(read(path), path, 'langgraph').providerCalls;
    const typed = providerCalls(
      'langgraph/streaming/angular/src/app/app.config.ts'
    );
    const subagents = providerCalls(
      'chat/subagents/angular/src/app/app.config.ts'
    );
    const subgraphs = providerCalls(
      'langgraph/subgraphs/angular/src/app/app.config.ts'
    );
    const persistenceConfig = providerCalls(
      'langgraph/persistence/angular/src/app/app.config.ts'
    );
    const persistenceComponent = providerCalls(
      'langgraph/persistence/angular/src/app/persistence.component.ts'
    );
    const threadsConfig = inspectRuntimeTargetSource(
      read('chat/threads/angular/src/app/app.config.ts'),
      'src/app/app.config.ts',
      'langgraph'
    ).angularProviders;
    const threadsComponent = providerCalls(
      'chat/threads/angular/src/app/threads.component.ts'
    );

    expect(typed.map(({ agentRef }) => agentRef)).toEqual(['STREAMING_AGENT']);
    expect(typed[0].properties['clientOptions']).toBe(
      'connection.clientOptions'
    );
    expect(subagents[0].properties['subagentToolNames']).toBe("['task']");
    expect(subgraphs[0].properties['transcriptNodeNames']).toBe("['answer']");

    expect(persistenceConfig).toEqual([]);
    expect(persistenceComponent).toHaveLength(1);
    expect(persistenceComponent[0].properties['onThreadId']).toBe(
      persistenceOnThreadIdExpression
    );

    expect(threadsComponent).toHaveLength(1);
    expect(threadsComponent[0].properties['threadId']).toBe(
      'activeThreadIdState'
    );
    expect(threadsComponent[0].properties['onThreadId']).toBe(
      '(id: string) => activeThreadIdState.set(id)'
    );
    expect(
      auditThreadsRootProviders([
        {
          relativeFileName: 'src/app/app.config.ts',
          angularProviders: threadsConfig,
        },
      ])
    ).toEqual([]);
  });

  it('preserves required non-connection entrypoint behavior while migrating bootstrap ownership', () => {
    const timelineCockpit = readFileSync(
      resolve(cockpitRoot, 'chat/timeline/angular/src/main.cockpit.ts'),
      'utf8'
    );

    expect(timelineCockpit).toContain(
      "import { installEmbeddedTheme } from '@threadplane/example-layouts';"
    );
    expect(
      timelineCockpit.match(/installEmbeddedTheme\s*\(\s*\)\s*;/g)
    ).toHaveLength(1);
    expect(timelineCockpit.indexOf('installEmbeddedTheme();')).toBeLessThan(
      timelineCockpit.indexOf('bootstrapWithCockpitHarness(')
    );
  });

  it('keeps Render Angular applications static and outside adapter reporter graphs', () => {
    const staticCapabilities = capabilities.filter(
      (capability) => capability.runtimeAdapter === 'none'
    );
    const violations = staticCapabilities.flatMap((capability) => {
      const projectRoot = resolve(
        cockpitRoot,
        capability.product,
        capability.topic,
        'angular'
      );
      const source = angularSourceFiles(projectRoot)
        .map((fileName) => readFileSync(fileName, 'utf8'))
        .join('\n');
      const forbidden = [
        'injectCockpitRuntimeConnection',
        'ɵAG_UI_RUNTIME_OPERATION_REPORTER',
        'ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER',
        "from '@threadplane/ag-ui'",
        "from '@threadplane/langgraph'",
        "adapter: 'ag-ui'",
        "adapter: 'langgraph'",
      ].filter((needle) => source.includes(needle));
      return forbidden.length === 0
        ? []
        : [{ project: capability.angularProject, forbidden }];
    });

    expect(staticCapabilities).toHaveLength(6);
    expect(violations).toEqual([]);
  });

  it('keeps every registry product inside the CockpitProduct union', () => {
    // `cockpitManifest` is typed `CockpitManifestEntry[]`, so a product that is
    // not in the union cannot appear here — the runtime check is that the
    // registry's products are all representable in the manifest.
    const manifestProducts = new Set<string>(
      cockpitManifest.map((entry) => entry.product)
    );
    const registryProducts = [...new Set(capabilities.map((c) => c.product))];

    expect(registryProducts.filter((p) => !manifestProducts.has(p))).toEqual(
      []
    );
  });
});

it('keeps Skills Angular and React on one canonical shared backend capability', () => {
  const skills = capabilities.filter(cap => cap.id === 'da-skills');
  expect(skills).toHaveLength(1);
  expect(skills[0]).toMatchObject({
    angularProject: 'cockpit-deep-agents-skills-angular', port: 4314,
    react: { project: 'cockpit-deep-agents-skills-react', port: 4631 },
    pythonDir: 'cockpit/deep-agents/skills/python', graphName: 'da-skills', pythonPort: 5314,
  });
  const canonical = capabilityModules.find(entry => entry.id === 'deep-agents-skills-python')!;
  expect(canonical.backendAssetPaths).toEqual(['src/graph.py', 'src/skills_readonly.py', 'skills/runway-analysis/SKILL.md', 'skills/runway-analysis/reference/margins.md', 'skills/weather-brief/SKILL.md'].map(file => `cockpit/deep-agents/skills/python/${file}`));
  const component = readFileSync(resolve(cockpitRoot, 'deep-agents/skills/angular/src/app/skills.component.ts'), 'utf8');
  expect(component).toContain('Requested read_file paths, without validating completion or returned content.');
});
