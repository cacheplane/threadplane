import {
  capabilities,
  capabilityModules,
  cockpitManifest,
} from '@threadplane/cockpit-registry';
import {
  agentProviderModule,
  auditRuntimeTargetSource,
  contextDevelopmentKey,
  defaultDeprecatedReporterOptionNames,
  defaultDirectoryReporterOptionNames,
  defaultReporterOptionNames,
  hasExactImportBinding,
  inspectRuntimeTargetSource,
  operationReporterToken,
  providerContextKeys,
  type AngularProviderRecord,
  type BootstrapCallRecord,
  type CanonicalProviderCall,
  type CompatibleRuntimeAdapter,
  type ExactImportBinding,
  type ProviderRegistrationOwner,
  type ReporterOptionNames,
  type RuntimeWiringAuditIssue,
  type ThreadDirectoryProviderRecord,
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
const libsRoot = fileURLToPath(new URL('../../libs/', import.meta.url));

/**
 * The names of every member an options type declares, read from a library's
 * source by syntax: the named interface or alias, what it extends, and the
 * types an alias is built from. Read-only; the audit never edits a library.
 */
function declaredOptionMembers(
  directory: string,
  rootName: string,
  include: 'all' | 'current' | 'deprecated' = 'all'
): string[] {
  const interfaces = new Map<string, ts.InterfaceDeclaration[]>();
  const aliases = new Map<string, ts.TypeAliasDeclaration>();
  const visitDirectory = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = resolve(current, entry.name);
      if (entry.isDirectory()) {
        visitDirectory(entryPath);
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !/\.(?:spec|type-test|d)\.ts$/.test(entry.name)
      ) {
        const sourceFile = ts.createSourceFile(
          entryPath,
          readFileSync(entryPath, 'utf8'),
          ts.ScriptTarget.Latest,
          true
        );
        for (const statement of sourceFile.statements) {
          if (ts.isInterfaceDeclaration(statement)) {
            interfaces.set(statement.name.text, [
              ...(interfaces.get(statement.name.text) ?? []),
              statement,
            ]);
          } else if (ts.isTypeAliasDeclaration(statement)) {
            aliases.set(statement.name.text, statement);
          }
        }
      }
    }
  };
  visitDirectory(directory);

  const names = new Set<string>();
  const seen = new Set<string>();
  const addMembers = (members: ts.NodeArray<ts.TypeElement>): void => {
    for (const member of members) {
      if (!member.name || !ts.isIdentifier(member.name)) continue;
      // A member marked `@deprecated` is still declared, and still read by
      // the library, but it is not a name new wiring may use.
      const deprecated = ts.getJSDocDeprecatedTag(member) !== undefined;
      if (
        include === 'all' ||
        (include === 'deprecated') === deprecated
      ) {
        names.add(member.name.text);
      }
    }
  };
  const visitType = (node: ts.Node): void => {
    if (ts.isTypeLiteralNode(node)) addMembers(node.members);
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      visitName(node.typeName.text);
    }
    if (
      ts.isExpressionWithTypeArguments(node) &&
      ts.isIdentifier(node.expression)
    ) {
      visitName(node.expression.text);
    }
    ts.forEachChild(node, visitType);
  };
  const visitName = (name: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    for (const declaration of interfaces.get(name) ?? []) {
      addMembers(declaration.members);
      for (const clause of declaration.heritageClauses ?? []) {
        for (const type of clause.types) visitType(type);
      }
    }
    const alias = aliases.get(name);
    if (alias) visitType(alias.type);
  };
  visitName(rootName);
  return [...names].sort();
}

const sessionOptionMembers: Record<CompatibleRuntimeAdapter, string[]> = {
  langgraph: declaredOptionMembers(
    resolve(libsRoot, 'langgraph/src/runtime'),
    'SessionOptions'
  ),
  'ag-ui': declaredOptionMembers(
    resolve(libsRoot, 'ag-ui/src/runtime'),
    'SessionOptions'
  ),
};

const sessionOptionSources: Record<CompatibleRuntimeAdapter, string> = {
  langgraph: resolve(libsRoot, 'langgraph/src/runtime'),
  'ag-ui': resolve(libsRoot, 'ag-ui/src/runtime'),
};
const reporterNamesOf = (
  adapter: CompatibleRuntimeAdapter,
  include: 'current' | 'deprecated'
): string[] =>
  declaredOptionMembers(
    sessionOptionSources[adapter],
    'SessionOptions',
    include
  ).filter((name) => /OperationFailure$/.test(name));

/**
 * The option each backend's session takes the operation-failure reporter
 * under, read from the session option interfaces rather than assumed, so a
 * rename in a library is followed without an edit here. Both sessions take it
 * as `reportOperationFailure`. A name the interface still declares but marks
 * `@deprecated` (the LangGraph session's `onOperationFailure`) is read apart:
 * it works, and the audit rejects it so no application is left on a name that
 * is going away.
 */
const reporterOptionNames: ReporterOptionNames = {
  langgraph: reporterNamesOf('langgraph', 'current'),
  'ag-ui': reporterNamesOf('ag-ui', 'current'),
};
const deprecatedReporterOptionNames: ReporterOptionNames = {
  langgraph: reporterNamesOf('langgraph', 'deprecated'),
  'ag-ui': reporterNamesOf('ag-ui', 'deprecated'),
};
const directoryOptionMembers = declaredOptionMembers(
  resolve(libsRoot, 'langgraph/src/runtime'),
  'LangGraphThreadDirectoryOptions'
);
/**
 * The same for the thread directory, which takes the reporter as
 * `reportOperationFailure`. The audit requires it because this list is not
 * empty; were the option removed, the requirement would go with it.
 */
const directoryReporterOptionNames = directoryOptionMembers.filter((name) =>
  /OperationFailure$/.test(name)
);
const auditOptions = {
  reporterOptionNames,
  deprecatedReporterOptionNames,
  directoryReporterOptionNames,
};

/** Fixture source in the canonical wiring, for the positive and negative cases. */
const fixtureImports: Record<CompatibleRuntimeAdapter, string> = {
  langgraph: `
    import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';
    import { provideAgent } from '@threadplane/angular';
    import { createSession } from '@threadplane/langgraph';
  `,
  'ag-ui': `
    import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';
    import { provideAgent } from '@threadplane/angular';
    import { createSession } from '@threadplane/ag-ui';
  `,
};
const fixtureSessionOptions: Record<CompatibleRuntimeAdapter, string> = {
  langgraph: `apiUrl: connection.apiUrl,
        assistantId: connection.assistantId,
        clientOptions: connection.clientOptions,
        threadId: context.threadId,
        onThreadId: context.onThreadId,
        ${defaultReporterOptionNames.langgraph[0]}: context.reportOperationFailure,
        developmentRuntime: context.developmentRuntime,`,
  'ag-ui': `url: connection.url,
        threadId: context.threadId,
        onThreadId: context.onThreadId,
        ${defaultReporterOptionNames['ag-ui'][0]}: context.reportOperationFailure,
        developmentRuntime: context.developmentRuntime,`,
};
const fixtureSessionMember = (
  adapter: CompatibleRuntimeAdapter,
  options = fixtureSessionOptions[adapter]
): string => `createSession: async (context) => createSession({ ${options} })`;
const fixtureFactory = (
  adapter: CompatibleRuntimeAdapter,
  body = `return { ${fixtureSessionMember(adapter)} };`
): string => `() => {
      const connection = injectCockpitRuntimeConnection();
      if (connection.adapter !== '${adapter}') {
        throw new Error('incompatible runtime');
      }
      ${body}
    }`;
const fixtureProvider = (
  adapter: CompatibleRuntimeAdapter,
  options = fixtureSessionOptions[adapter]
): string =>
  `provideAgent(${fixtureFactory(
    adapter,
    `return { ${fixtureSessionMember(adapter, options)} };`
  )})`;
const fixtureStatements = {
  declaration: 'const connection = injectCockpitRuntimeConnection();',
  guard:
    "if (connection.adapter !== 'ag-ui') { throw new Error('incompatible runtime'); }",
  result: `return { ${fixtureSessionMember('ag-ui')} };`,
};
const fixtureAppConfig = (
  adapter: CompatibleRuntimeAdapter,
  provider = fixtureProvider(adapter),
  imports = fixtureImports[adapter]
): string =>
  `${imports}\nexport const appConfig = { providers: [${provider}] };`;

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
  /** Members of the agent config that must survive, by exact source text. */
  retainedProviderProperties?: Readonly<Record<string, string>>;
  /** Options of the backend session that must survive, by exact source text. */
  retainedSessionProperties?: Readonly<Record<string, string>>;
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
    retainedSessionProperties: {
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
    retainedSessionProperties: {
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
    retainedSessionProperties: {
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
  ...(
    [
      [
        'cockpit-ag-ui-interrupts-angular',
        'InterruptsComponent',
        // Answers both the protocol's interrupt outcome and the legacy notice.
        { interruptTransport: "'auto'" },
      ],
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
      [
        'cockpit-runtimes-mastra-angular',
        'MastraComponent',
        // This runtime resumes a pause only through its own command.
        { interruptTransport: "'mastra-command'" },
      ],
    ] as ReadonlyArray<
      readonly [string, string, Readonly<Record<string, string>>?]
    >
  ).map(([project, rootComponent, retainedSessionProperties]) => ({
    project,
    rootComponent,
    providerSource: 'src/app/app.config.ts',
    sharedUrl: "new URL('agent', document.baseURI).pathname",
    ...(retainedSessionProperties ? { retainedSessionProperties } : {}),
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
      bootstrap.runtimeProperties['sharedApiUrl'] !==
      'environment.langGraphApiUrl'
    ) {
      mismatches.push('sharedApiUrl environment.langGraphApiUrl');
    }
    if (bootstrap.runtimeProperties['assistantId'] !== expected.assistantId) {
      mismatches.push(`assistantId ${expected.assistantId}`);
    }
  } else {
    if (!runtimeBootstrap.hasPristineAgUrlGlobals) {
      mismatches.push('pristine URL/document globals');
    }
    if (bootstrap.runtimeProperties['sharedUrl'] !== expected.sharedUrl) {
      mismatches.push(`sharedUrl ${expected.sharedUrl}`);
    }
  }
  // Both backends report through the one token the Angular agent reads. A
  // different token is provided to nobody, so no failure reaches the host.
  if (
    !hasExactSemanticBinding(
      bindingBootstrap.operationReporterBinding,
      agentProviderModule,
      operationReporterToken
    )
  ) {
    mismatches.push(`operation reporter import from ${agentProviderModule}`);
  }
  if (
    bootstrap.runtimeProperties['operationReporterToken'] !==
    operationReporterToken
  ) {
    mismatches.push(`operationReporterToken ${operationReporterToken}`);
  }
  if (!bootstrap.hasRedactedCatch) mismatches.push('redacted catch owner');
  return mismatches;
}

function hasExpectedProviderProperties(
  providerCalls: readonly CanonicalProviderCall[],
  expected: Readonly<Record<string, string>>,
  members: 'properties' | 'sessionProperties' = 'properties'
): boolean {
  return providerCalls.some((call) =>
    Object.entries(expected).every(
      ([property, expression]) => call[members][property] === expression
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

/**
 * The thread list must be read from the deployment its agent talks to, with
 * the same developer key. It may take the client options straight from the
 * connection, or from the provider context when the app provides
 * AGENT_CLIENT_OPTIONS from the connection in the same place.
 */
function auditThreadsRootProviders(
  sources: ReadonlyArray<{
    relativeFileName: string;
    angularProviders: readonly AngularProviderRecord[];
    threadDirectoryProviders: readonly ThreadDirectoryProviderRecord[];
  }>
): string[] {
  const expectedFile = 'src/app/app.config.ts';
  const mismatches: string[] = [];
  const directories = sources.flatMap(
    ({ relativeFileName, threadDirectoryProviders }) =>
      threadDirectoryProviders.map((provider) => ({
        relativeFileName,
        provider,
      }))
  );
  const directory =
    directories.length === 1 && directories[0].relativeFileName === expectedFile
      ? directories[0].provider
      : undefined;
  if (
    !directory ||
    !directory.canonical ||
    JSON.stringify(directory.owner) !== JSON.stringify({ kind: 'appConfig' }) ||
    !hasExactSemanticBinding(
      directory.provideBinding,
      agentProviderModule,
      'provideThreadDirectory'
    ) ||
    !hasExactSemanticBinding(
      directory.createDirectoryBinding,
      '@threadplane/langgraph',
      'createLangGraphThreadDirectory'
    ) ||
    directory.directoryProperties['apiUrl'] !== 'connection.apiUrl' ||
    !directory.clientOptionsSource
  ) {
    mismatches.push(`provideThreadDirectory canonical provider in ${expectedFile}`);
  }

  const clientOptions = sources.flatMap(
    ({ relativeFileName, angularProviders }) =>
      angularProviders
        .filter((provider) => provider.provideToken === 'AGENT_CLIENT_OPTIONS')
        .map((provider) => ({ relativeFileName, provider }))
  );
  const canonicalClientOptions = (provider: AngularProviderRecord): boolean =>
    hasExactSemanticBinding(
      provider.provideTokenBinding,
      agentProviderModule,
      'AGENT_CLIENT_OPTIONS'
    ) &&
    provider.canonicalFactory &&
    provider.connectionDeclaration ===
      'const connection = injectCockpitRuntimeConnection()' &&
    provider.connectionCallCount === 1 &&
    !provider.connectionWrites &&
    provider.returnExpression === 'connection.clientOptions' &&
    Object.keys(provider.returnedProperties).length === 0;
  if (
    clientOptions.length > 1 ||
    (directory?.clientOptionsSource === 'context' &&
      clientOptions.length !== 1) ||
    clientOptions.some(
      ({ relativeFileName, provider }) =>
        relativeFileName !== expectedFile || !canonicalClientOptions(provider)
    )
  ) {
    mismatches.push(`AGENT_CLIENT_OPTIONS canonical provider in ${expectedFile}`);
  }
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
          capability.angularProject,
          auditOptions
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
              threadDirectoryProviders: inspection.threadDirectoryProviders,
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
    for (const mutated of [
      changed(provider, 'const scope =', 'mutate(connection); const scope ='),
      changed(provider, 'connection.apiUrl,', "'/unsafe',"),
      changed(provider, 'maxRetries: 0', 'maxRetries: 1'),
      changed(provider, '...connection.clientOptions', '...unsafeOptions'),
      changed(
        provider,
        'onThreadId: context.onThreadId,',
        'onThreadId: context.onThreadId, secret: window.runtimeApiKey,'
      ),
      changed(
        provider,
        'import { MemoryScope }',
        'import { UnsafeScope as MemoryScope }'
      ),
      changed(provider, 'ApplicationConfig, inject', 'ApplicationConfig, inject as unsafeInject'),
      changed(provider, 'transport: new', '...unsafeOverrides, transport: new'),
      // The transport is what reports a refused request for this session.
      changed(provider, 'context.reportOperationFailure', 'undefined'),
      // The transport replaces the connection, not the development relay.
      changed(provider, 'developmentRuntime: context.developmentRuntime,', ''),
      changed(provider, /clientOptions,(\s+)context\./, '{},$1context.'),
      changed(provider, 'threadId: context.threadId,', "threadId: 'fixed',"),
      changed(provider, 'onThreadId: context.onThreadId,', ''),
      changed(
        provider,
        'assistantId: connection.assistantId',
        "assistantId: 'other-graph'"
      ),
      changed(
        provider,
        "import { createSession } from '@threadplane/langgraph';",
        "import { createSession } from './fake-langgraph';"
      ),
      changed(
        provider,
        "import { MemoryTransport } from './memory-transport';",
        "import { MemoryTransport } from './other-transport';"
      ),
      changed(provider, '(context) =>', '() =>'),
    ])
      expect(inspect(mutated, 'src/app/app.config.ts')).not.toEqual([]);
    for (const mutated of [
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
    ]) {
      expect(mutated).not.toBe(scope);
      expect(inspect(mutated, 'src/app/memory-scope.ts')).not.toEqual([]);
    }
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
      `import { provideAgent as wireAgent } from '@threadplane/angular';\nimport { runtimeConfig } from './runtime-config';\nexport const providers = [wireAgent(runtimeConfig)];`,
      'noncanonical-provider-wiring',
    ],
    [
      'namespace provider with direct config',
      `import * as agentApi from '@threadplane/angular';\nconst config = { url: '/agent' };\nexport const providers = [agentApi.provideAgent(config)];`,
      'noncanonical-provider-wiring',
    ],
    [
      'locally aliased provider with direct config',
      `import { provideAgent } from '@threadplane/angular';\nconst wire = provideAgent;\nexport const providers = [wire({ url: '/agent' })];`,
      'noncanonical-provider-wiring',
    ],
    [
      'factory returning imported config',
      `import { provideAgent } from '@threadplane/angular';\nimport { runtimeConfig } from './runtime-config';\nexport const providers = [provideAgent(() => runtimeConfig)];`,
      'noncanonical-provider-wiring',
    ],
    [
      'aliased direct Agent construction',
      `import { HttpAgent as RuntimeAgent } from '@ag-ui/client';\nexport const agent = new RuntimeAgent({ url: '/agent' });`,
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
    const valid = fixtureAppConfig('langgraph');
    expect(
      auditRuntimeTargetSource(valid, 'src/app/app.config.ts', 'langgraph')
    ).toEqual([]);
    for (const source of [
      changed(
        changed(valid, 'import { provideAgent }', 'import { provideAgent as wireAgent }'),
        'providers: [provideAgent(',
        'providers: [wireAgent('
      ),
      changed(
        changed(
          valid,
          'import { injectCockpitRuntimeConnection }',
          'import { injectCockpitRuntimeConnection as useConnection }'
        ),
        'const connection = injectCockpitRuntimeConnection();',
        'const connection = useConnection();'
      ),
      changed(
        changed(valid, 'import { createSession }', 'import { createSession as makeSession }'),
        '=> createSession(',
        '=> makeSession('
      ),
    ]) {
      expect(
        auditRuntimeTargetSource(source, 'src/app/app.config.ts', 'langgraph').map(
          ({ kind }) => kind
        )
      ).toContain('noncanonical-provider-wiring');
    }
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
      `import * as agentApi from '@threadplane/angular';\nconst { provideAgent } = agentApi;\nexport const providers = [provideAgent(() => ({ url: '/agent' }))];`,
      'noncanonical-provider-wiring',
    ],
    [
      'reverse provider alias',
      `import { provideAgent as wireAgent } from '@threadplane/angular';\nconst provideAgent = wireAgent;\nexport const providers = [provideAgent(() => ({ url: '/agent' }))];`,
      'noncanonical-provider-wiring',
    ],
    [
      'computed connection field',
      fixtureAppConfig(
        'ag-ui',
        fixtureProvider(
          'ag-ui',
          fixtureSessionOptions['ag-ui'].replace('url:', "['url']:")
        )
      ),
      'session-connection-wiring',
    ],
    [
      'spread connection fields',
      fixtureAppConfig(
        'ag-ui',
        fixtureProvider(
          'ag-ui',
          fixtureSessionOptions['ag-ui'].replace(
            'url: connection.url',
            '...connection'
          )
        )
      ),
      'session-connection-wiring',
    ],
    [
      'shorthand connection field',
      fixtureAppConfig(
        'ag-ui',
        `provideAgent(() => { ${fixtureStatements.declaration} ${
          fixtureStatements.guard
        } const url = connection.url; return { ${fixtureSessionMember(
          'ag-ui',
          fixtureSessionOptions['ag-ui'].replace('url: connection.url', 'url')
        )} }; })`
      ),
      'session-connection-wiring',
    ],
    [
      'mutable connection declaration',
      fixtureAppConfig(
        'ag-ui',
        `provideAgent(() => { let connection = injectCockpitRuntimeConnection(); ${fixtureStatements.guard} ${fixtureStatements.result} })`
      ),
      'noncanonical-provider-wiring',
    ],
    [
      'connection reassignment',
      fixtureAppConfig(
        'ag-ui',
        `provideAgent(() => { ${fixtureStatements.declaration} connection = injectCockpitRuntimeConnection(); ${fixtureStatements.result} })`
      ),
      'noncanonical-provider-wiring',
    ],
    [
      'return before canonical connection declaration',
      fixtureAppConfig(
        'ag-ui',
        `provideAgent(() => { ${fixtureStatements.result} ${fixtureStatements.declaration} ${fixtureStatements.guard} })`
      ),
      'noncanonical-provider-wiring',
    ],
    [
      'unreachable statement before canonical connection declaration',
      fixtureAppConfig(
        'ag-ui',
        `provideAgent(() => { throw new Error('unreachable'); ${fixtureStatements.declaration} ${fixtureStatements.guard} ${fixtureStatements.result} })`
      ),
      'noncanonical-provider-wiring',
    ],
    [
      'missing adapter guard',
      fixtureAppConfig(
        'ag-ui',
        `provideAgent(() => { ${fixtureStatements.declaration} ${fixtureStatements.result} })`
      ),
      'noncanonical-provider-wiring',
    ],
    [
      'adapter guard for the other backend',
      fixtureAppConfig(
        'ag-ui',
        `provideAgent(() => { ${
          fixtureStatements.declaration
        } ${fixtureStatements.guard.replace("'ag-ui'", "'langgraph'")} ${
          fixtureStatements.result
        } })`
      ),
      'noncanonical-provider-wiring',
    ],
    [
      'nested alternate Agent return',
      fixtureAppConfig(
        'ag-ui',
        `provideAgent(() => { ${fixtureStatements.declaration} ${fixtureStatements.guard} if (flag) ${fixtureStatements.result} ${fixtureStatements.result} })`
      ),
      'noncanonical-provider-wiring',
    ],
    [
      'connection passed to mutating helper',
      fixtureAppConfig(
        'ag-ui',
        `provideAgent(() => { ${fixtureStatements.declaration} ${fixtureStatements.guard} mutate(connection); ${fixtureStatements.result} })`
      ),
      'noncanonical-provider-wiring',
    ],
    [
      'Object.assign connection mutation',
      fixtureAppConfig(
        'ag-ui',
        `provideAgent(() => { ${fixtureStatements.declaration} ${fixtureStatements.guard} Object.assign(connection, { url: '/wrong' }); ${fixtureStatements.result} })`
      ),
      'noncanonical-provider-wiring',
    ],
    [
      'connection read inside a session option expression',
      fixtureAppConfig(
        'ag-ui',
        fixtureProvider(
          'ag-ui',
          fixtureSessionOptions['ag-ui'].replace(
            'url: connection.url',
            'url: rewrite(connection.url)'
          )
        )
      ),
      'session-connection-wiring',
    ],
    [
      'session built by a namespace import',
      `import * as langgraph from '@threadplane/langgraph';\nexport const make = () => langgraph.createSession({ assistantId: 'chat' });`,
      'direct-agent-construction',
    ],
    [
      'transport constructed by hand',
      `import { FetchStreamTransport } from '@threadplane/langgraph';\nexport const make = () => new FetchStreamTransport('https://deployment.example');`,
      'direct-agent-construction',
    ],
    [
      'agent built outside its provider',
      `import { createAgent } from '@threadplane/angular';\nexport const make = (config: never) => createAgent(config);`,
      'direct-agent-construction',
    ],
    [
      'aliased session factory import',
      `import { createSession as makeSession } from '@threadplane/langgraph';\nexport const make = makeSession;`,
      'noncanonical-provider-wiring',
    ],
    [
      'session factory destructured from a namespace',
      `import * as langgraph from '@threadplane/langgraph';\nconst { createSession } = langgraph;\nexport const make = () => createSession({ assistantId: 'chat' });`,
      'noncanonical-provider-wiring',
    ],
    [
      'provider imported from a backend package',
      `import { provideAgent } from '@threadplane/langgraph';\nexport const appConfig = { providers: [provideAgent(() => ({}))] };`,
      'noncanonical-provider-wiring',
    ],
    [
      'provider given a ready config instead of a factory',
      `import { provideAgent } from '@threadplane/angular';\nimport { runtimeConfig } from './runtime-config';\nexport const appConfig = { providers: [provideAgent(runtimeConfig)] };`,
      'direct-agent-provider-config',
    ],
    [
      'provider element alias declaration',
      `import * as api from '@threadplane/angular';\nconst wire = api['provideAgent'];\nexport const providers = [wire(() => ({ url: '/agent' }))];`,
      'noncanonical-provider-wiring',
    ],
    [
      'provider renamed destructuring declaration',
      `import * as api from '@threadplane/angular';\nconst { provideAgent: wire } = api;\nexport const providers = [wire(() => ({ url: '/agent' }))];`,
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
    const canonicalSource = fixtureAppConfig('ag-ui');
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
      ${fixtureImports.langgraph}
    `;
    const providerCall = fixtureProvider('langgraph');
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
      relativeFileName = 'src/app/app.config.ts',
      adapter: CompatibleRuntimeAdapter = 'langgraph'
    ) => {
      const inspection = inspectRuntimeTargetSource(
        source,
        relativeFileName,
        adapter
      );
      return {
        relativeFileName,
        angularProviders: inspection.angularProviders,
        threadDirectoryProviders: inspection.threadDirectoryProviders,
        issues: inspection.issues,
      };
    };
    const directoryMismatch =
      'provideThreadDirectory canonical provider in src/app/app.config.ts';
    const clientOptionsMismatch =
      'AGENT_CLIENT_OPTIONS canonical provider in src/app/app.config.ts';
    const factory = (body: string) => fixtureFactory('langgraph', body);
    const imports = `
      import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';
      import { AGENT_CLIENT_OPTIONS, provideThreadDirectory } from '@threadplane/angular';
      import { createLangGraphThreadDirectory, type LangGraphClientOptions } from '@threadplane/langgraph';
    `;
    const reporterOption =
      'reportOperationFailure: context.reportOperationFailure,';
    const contextOptions = `apiUrl: connection.apiUrl, clientOptions: context.clientOptions as LangGraphClientOptions | undefined, ${reporterOption}`;
    const connectionOptions = `apiUrl: connection.apiUrl, clientOptions: connection.clientOptions, ${reporterOption}`;
    const directoryReturn = (options: string) =>
      `return { createDirectory: (context) => createLangGraphThreadDirectory({ ${options} }) };`;
    const directoryProvider = (options: string) =>
      `provideThreadDirectory(${factory(directoryReturn(options))})`;
    const clientOptionsReturn = 'return connection.clientOptions;';
    const clientOptionsProvider = `{ provide: AGENT_CLIENT_OPTIONS, useFactory: ${factory(
      clientOptionsReturn
    )} }`;
    const appConfig = (...providers: string[]) =>
      `${imports}\nexport const appConfig = { providers: [\n${providers.join(
        ',\n'
      )}\n] };`;
    // The client options through the provider context, as the Threads
    // application has them, and straight from the connection.
    const validSource = appConfig(
      directoryProvider(contextOptions),
      clientOptionsProvider
    );
    const directSource = appConfig(directoryProvider(connectionOptions));
    const mismatches = (source: string, fileName?: string) =>
      auditThreadsRootProviders([inspect(source, fileName)]);
    const kinds = (source: string) =>
      inspect(source).issues.map(({ kind }) => kind);
    const details = (source: string) =>
      inspect(source)
        .issues.map(({ detail }) => detail)
        .join('\n');

    for (const source of [validSource, directSource]) {
      expect(mismatches(source)).toEqual([]);
      expect(inspect(source).issues).toEqual([]);
    }
    // Both forms together: the provider is optional but still has to be right.
    expect(
      mismatches(
        appConfig(directoryProvider(connectionOptions), clientOptionsProvider)
      )
    ).toEqual([]);

    // A directory pointed at a different backend than the agent.
    for (const apiUrl of [
      "'https://other-deployment.example'",
      'environment.langGraphApiUrl',
      'connection.assistantId',
    ]) {
      const source = changed(
        validSource,
        'apiUrl: connection.apiUrl',
        `apiUrl: ${apiUrl}`
      );
      expect(mismatches(source)).toContain(directoryMismatch);
      expect(kinds(source)).toContain('thread-directory-wiring');
      expect(details(source)).toMatch(
        /apiUrl must be an explicit apiUrl: connection\.apiUrl/
      );
    }
    // A directory that does not send the deployment key its agent sends.
    for (const source of [
      changed(
        validSource,
        'clientOptions: context.clientOptions as LangGraphClientOptions | undefined,',
        ''
      ),
      changed(directSource, 'connection.clientOptions', '{ maxRetries: 4 }'),
      changed(directSource, 'connection.clientOptions', 'context.reportOperationFailure'),
    ]) {
      expect(mismatches(source)).toContain(directoryMismatch);
      expect(details(source)).toMatch(
        /clientOptions must be connection\.clientOptions or the provider context's clientOptions/
      );
    }
    // The context's client options with nothing providing them: undefined.
    const unprovided = appConfig(directoryProvider(contextOptions));
    expect(mismatches(unprovided)).toEqual([
      directoryMismatch,
      clientOptionsMismatch,
    ]);
    expect(details(unprovided)).toMatch(
      /requires the canonical AGENT_CLIENT_OPTIONS provider in the same file/
    );
    // ...or provided from somewhere other than the connection.
    for (const source of [
      changed(validSource, clientOptionsReturn, 'return { maxRetries: 4 };'),
      changed(
        validSource,
        `useFactory: ${factory(clientOptionsReturn)}`,
        'useFactory: makeClientOptions'
      ),
      changed(validSource, clientOptionsReturn, `if (flag) ${clientOptionsReturn} ${clientOptionsReturn}`),
      changed(
        validSource,
        clientOptionsReturn,
        `Reflect.set(connection, 'clientOptions', {}); ${clientOptionsReturn}`
      ),
    ]) {
      expect(mismatches(source)).toContain(clientOptionsMismatch);
      expect(kinds(source)).toContain('session-connection-wiring');
    }
    const fakeToken = changed(
      validSource,
      'import { AGENT_CLIENT_OPTIONS, provideThreadDirectory }',
      "import { AGENT_CLIENT_OPTIONS } from './fake-tokens';\nimport { provideThreadDirectory }"
    );
    expect(mismatches(fakeToken)).toContain(clientOptionsMismatch);
    const duplicateToken = appConfig(
      directoryProvider(contextOptions),
      clientOptionsProvider,
      clientOptionsProvider
    );
    expect(mismatches(duplicateToken)).toContain(clientOptionsMismatch);
    expect(details(duplicateToken)).toMatch(
      /duplicate Angular provider token AGENT_CLIENT_OPTIONS/
    );

    // A ready client, a spread, or a helper can each replace the connection.
    for (const [options, reason] of [
      [`${connectionOptions} client: sharedClient,`, /option client replaces/],
      [`${connectionOptions} ...overrides,`, /may not contain spreads/],
      [`apiUrl: connection.apiUrl, ...context,`, /may not spread the provider context/],
      [`${connectionOptions} apiUrl: '/other',`, /apiUrl is given more than once/],
      [`${connectionOptions} titleFallback: label(context),`, /may only be read as the whole value of a directory option/],
    ] as const) {
      const source = appConfig(directoryProvider(options));
      expect(mismatches(source)).toContain(directoryMismatch);
      expect(kinds(source)).toContain('thread-directory-wiring');
      expect(details(source)).toMatch(reason);
    }
    for (const body of [
      'return { createDirectory: makeDirectory };',
      `return { createDirectory: () => createLangGraphThreadDirectory({ ${connectionOptions} }) };`,
      `return { createDirectory: (context) => wrap(createLangGraphThreadDirectory({ ${connectionOptions} })) };`,
      `return { createDirectory: (context) => createLangGraphThreadDirectory(directoryOptions) };`,
      `return { ...base, createDirectory: (context) => createLangGraphThreadDirectory({ ${connectionOptions} }) };`,
      `return { createDirectory: (context) => createLangGraphThreadDirectory({ ${connectionOptions} }), client: sharedClient };`,
      `mutate(connection); ${directoryReturn(connectionOptions)}`,
      `if (flag) ${directoryReturn(connectionOptions)} ${directoryReturn(
        connectionOptions
      )}`,
    ]) {
      const source = appConfig(`provideThreadDirectory(${factory(body)})`);
      expect(mismatches(source)).toContain(directoryMismatch);
      expect(inspect(source).issues).not.toEqual([]);
    }
    for (const provider of [
      'provideThreadDirectory(makeDirectoryConfig)',
      `provideThreadDirectory(${factory('return directoryConfig;')})`,
      `provideThreadDirectory(() => { ${directoryReturn(
        connectionOptions
      )} const connection = injectCockpitRuntimeConnection(); })`,
      `provideThreadDirectory(() => { const connection = injectCockpitRuntimeConnection(); ${directoryReturn(
        connectionOptions
      )} })`,
      `provideThreadDirectory((injectCockpitRuntimeConnection = fakeInjector) => {
        const connection = injectCockpitRuntimeConnection();
        if (connection.adapter !== 'langgraph') { throw new Error('incompatible runtime'); }
        ${directoryReturn(connectionOptions)}
      })`,
    ]) {
      const source = appConfig(provider);
      expect(mismatches(source)).toContain(directoryMismatch);
      expect(inspect(source).issues).not.toEqual([]);
    }

    // The provider or the directory factory from somewhere else.
    for (const source of [
      changed(
        directSource,
        'import { AGENT_CLIENT_OPTIONS, provideThreadDirectory }',
        "import { provideThreadDirectory } from './fake-angular';\nimport { AGENT_CLIENT_OPTIONS }"
      ),
      changed(
        directSource,
        "import { createLangGraphThreadDirectory, type LangGraphClientOptions } from '@threadplane/langgraph';",
        "import { createLangGraphThreadDirectory } from './fake-langgraph';"
      ),
      changed(
        directSource,
        'import { createLangGraphThreadDirectory,',
        'const createLangGraphThreadDirectory = fakeDirectory;\nimport {'
      ),
    ]) {
      expect(mismatches(source)).toContain(directoryMismatch);
      expect(inspect(source).issues).not.toEqual([]);
    }

    // Not registered, registered elsewhere, or registered twice.
    expect(
      mismatches(
        `${imports}
         // provideThreadDirectory(() => ({ createDirectory: () => createLangGraphThreadDirectory({ apiUrl: connection.apiUrl }) }))
         export const appConfig = { providers: [${clientOptionsProvider}] };`
      )
    ).toEqual([directoryMismatch]);
    const deadProvider = `${imports}
      export const appConfig = { providers: [] };
      ${directoryProvider(connectionOptions)};`;
    expect(mismatches(deadProvider)).toContain(directoryMismatch);
    expect(kinds(deadProvider)).toContain('thread-directory-wiring');
    expect(mismatches(validSource, 'src/app/orphan.ts')).toEqual([
      directoryMismatch,
      clientOptionsMismatch,
    ]);
    expect(
      mismatches(
        appConfig(
          directoryProvider(connectionOptions),
          directoryProvider(connectionOptions)
        )
      )
    ).toContain(directoryMismatch);

    // A LangGraph thread list beside an agent on another backend.
    expect(
      inspect(directSource, 'src/app/app.config.ts', 'ag-ui')
        .issues.map(({ detail }) => detail)
        .join('\n')
    ).toMatch(/a LangGraph thread directory cannot list the threads of an ag-ui agent/);

    // The directory's own refused requests. The directory takes the host's
    // reporter as `reportOperationFailure`, so a directory wired without it
    // is the mistake: its refused requests would never reach the cockpit.
    const withDirectoryReporter = (source: string, names: string[]) =>
      inspectRuntimeTargetSource(
        source,
        'src/app/app.config.ts',
        'langgraph',
        undefined,
        { directoryReporterOptionNames: names }
      );
    expect(inspect(directSource).issues).toEqual([]);
    expect(
      inspect(directSource).threadDirectoryProviders.map(
        ({ canonical }) => canonical
      )
    ).toEqual([true]);
    const silentSource = changed(directSource, reporterOption, '');
    for (const silent of [
      // The audit's default, and the name read from the directory's options.
      inspect(silentSource),
      withDirectoryReporter(silentSource, directoryReporterOptionNames),
    ]) {
      expect(silent.threadDirectoryProviders[0].canonical).toBe(false);
      expect(silent.issues).toEqual([
        {
          kind: 'thread-directory-wiring',
          detail:
            "createLangGraphThreadDirectory must be given the provider context's reportOperationFailure as reportOperationFailure",
        },
      ]);
    }
    expect(mismatches(silentSource)).toContain(directoryMismatch);
    expect(
      inspect(
        changed(
          directSource,
          'reportOperationFailure: context.reportOperationFailure',
          'reportOperationFailure: () => undefined'
        )
      ).issues.map(({ detail }) => detail)
    ).toEqual([
      "reportOperationFailure must be the provider context's reportOperationFailure",
    ]);
    expect(
      details(
        changed(directSource, 'reportOperationFailure:', 'onOperationFailure:')
      )
    ).toMatch(
      /passed as onOperationFailure, which the thread directory does not accept \(it takes reportOperationFailure\); the reporter is dropped/
    );
    // The audit follows the names it is told: a directory that declared no
    // reporter option could not be given one.
    expect(
      withDirectoryReporter(directSource, [])
        .issues.map(({ detail }) => detail)
        .join('\n')
    ).toMatch(
      /passed as reportOperationFailure, which the thread directory does not accept; the reporter is dropped/
    );
    expect(withDirectoryReporter(silentSource, []).issues).toEqual([]);

    // The registration array itself must stay explicit.
    const trailingSpread = changed(
      validSource,
      '\n] };',
      ', ...runtimeProviderOverrides\n] };'
    );
    expect(mismatches(trailingSpread)).not.toEqual([]);
    expect(kinds(trailingSpread)).toContain('noncanonical-provider-wiring');
    expect(
      kinds(
        changed(
          validSource,
          'provide: AGENT_CLIENT_OPTIONS',
          "['provide']: AGENT_CLIENT_OPTIONS"
        )
      )
    ).toContain('noncanonical-provider-wiring');
    expect(
      kinds(
        changed(
          validSource,
          '{ provide: AGENT_CLIENT_OPTIONS',
          '{ ...override, provide: AGENT_CLIENT_OPTIONS'
        )
      )
    ).toContain('noncanonical-provider-wiring');
    expect(
      kinds(`export const appConfig = { providers: [{ provide, useFactory }] };`)
    ).toContain('noncanonical-provider-wiring');
  });

  it('reads the session option names and the provider context members from the libraries', () => {
    // The session rules stand on these facts. They are read from the library
    // sources so that a rename is followed, and a removal is named here
    // rather than surfacing as 35 unexplained application failures.
    expect(reporterOptionNames.langgraph).toEqual(['reportOperationFailure']);
    expect(reporterOptionNames['ag-ui']).toEqual(['reportOperationFailure']);
    // Still declared, marked `@deprecated`: read apart so it is rejected.
    expect(deprecatedReporterOptionNames.langgraph).toEqual([
      'onOperationFailure',
    ]);
    expect(deprecatedReporterOptionNames['ag-ui']).toEqual([]);
    expect(sessionOptionMembers.langgraph).toContain('onOperationFailure');
    expect(sessionOptionMembers.langgraph).toEqual(
      expect.arrayContaining([
        'apiUrl',
        'assistantId',
        'clientOptions',
        'threadId',
        'onThreadId',
        'transport',
      ])
    );
    expect(sessionOptionMembers['ag-ui']).toEqual(
      expect.arrayContaining(['url', 'threadId', 'agent', 'fetch'])
    );
    // Both sessions take the context's development-install relay under the
    // context's own name, which is the one name the audit requires.
    expect(providerContextKeys.has(contextDevelopmentKey)).toBe(true);
    expect(sessionOptionMembers.langgraph).toContain(contextDevelopmentKey);
    expect(sessionOptionMembers['ag-ui']).toContain(contextDevelopmentKey);
    // The AG-UI session names a new conversation's thread and reports it
    // through `onThreadId`, which the audit's AG-UI contract requires.
    expect(sessionOptionMembers['ag-ui']).toContain('onThreadId');
    expect(
      declaredOptionMembers(
        resolve(libsRoot, 'angular/src'),
        'AgentSessionContext'
      )
    ).toEqual([...providerContextKeys].sort());
    expect(directoryOptionMembers).toEqual(
      expect.arrayContaining(['apiUrl', 'clientOptions', 'client'])
    );
    // The directory factory is offered the reporter too, and the directory
    // takes it: the name is read from its options, and the audit requires it.
    expect(directoryReporterOptionNames).toEqual(
      defaultDirectoryReporterOptionNames
    );
    expect(
      declaredOptionMembers(
        resolve(libsRoot, 'angular/src'),
        'ThreadDirectoryContext'
      )
    ).toEqual(['clientOptions', 'reportOperationFailure']);
  });

  const kindsOf = (issues: readonly RuntimeWiringAuditIssue[]): string[] =>
    [...new Set(issues.map(({ kind }) => kind))].sort();
  const sessionIssues = (
    adapter: CompatibleRuntimeAdapter,
    options: string,
    names?: ReporterOptionNames
  ): RuntimeWiringAuditIssue[] =>
    inspectRuntimeTargetSource(
      fixtureAppConfig(adapter, fixtureProvider(adapter, options)),
      'src/app/app.config.ts',
      adapter,
      undefined,
      names ? { reporterOptionNames: names } : undefined
    ).issues;
  const langGraphOptions = fixtureSessionOptions.langgraph;
  const agUiOptions = fixtureSessionOptions['ag-ui'];
  const langGraphReporter = defaultReporterOptionNames.langgraph[0];
  const agUiReporter = defaultReporterOptionNames['ag-ui'][0];
  const changed = (
    source: string,
    search: string | RegExp,
    replacement: string
  ): string => {
    const next = source.replace(search, replacement);
    // A mutation that changes nothing would pass every negative case.
    if (next === source) throw new Error(`fixture mutation missed: ${search}`);
    return next;
  };

  it('accepts every correct form of the session wiring', () => {
    expect(sessionIssues('langgraph', langGraphOptions)).toEqual([]);
    expect(sessionIssues('ag-ui', agUiOptions)).toEqual([]);
    // The AG-UI session takes `threadId: null` for a new conversation, so the
    // applications pass the context's value as it is. The `?? undefined` they
    // needed before that still reads as the context's thread.
    expect(
      sessionIssues(
        'ag-ui',
        changed(
          agUiOptions,
          'threadId: context.threadId,',
          'threadId: context.threadId ?? undefined,'
        )
      )
    ).toEqual([]);
    // Options that belong to the application, not to the connection.
    expect(
      sessionIssues(
        'langgraph',
        `${langGraphOptions} throttle: 16, historyState: true, stateType: type<State>(), transcriptNodeNames: ['answer'],`
      )
    ).toEqual([]);
    expect(
      sessionIssues('ag-ui', `${agUiOptions} interruptTransport: 'auto',`)
    ).toEqual([]);
    const inspect = (provider: string) =>
      inspectRuntimeTargetSource(
        fixtureAppConfig('langgraph', provider),
        'src/app/app.config.ts',
        'langgraph'
      ).issues;
    // The context destructured, with and without renaming.
    expect(
      inspect(
        `provideAgent(${fixtureFactory(
          'langgraph',
          `return { createSession: ({ threadId, onThreadId, reportOperationFailure, developmentRuntime }) => createSession({
            apiUrl: connection.apiUrl,
            assistantId: connection.assistantId,
            clientOptions: connection.clientOptions,
            threadId,
            onThreadId,
            ${langGraphReporter}: reportOperationFailure,
            developmentRuntime,
          }) };`
        )})`
      )
    ).toEqual([]);
    expect(
      inspect(
        `provideAgent(${fixtureFactory(
          'langgraph',
          `return { createSession: ({ threadId: thread, onThreadId: created, reportOperationFailure: report, developmentRuntime: relay }) => createSession({
            apiUrl: connection.apiUrl,
            assistantId: connection.assistantId,
            clientOptions: connection.clientOptions,
            threadId: thread,
            onThreadId: created,
            ${langGraphReporter}: report,
            developmentRuntime: relay,
          }) };`
        )})`
      )
    ).toEqual([]);
    // A block body whose only statement returns the session.
    expect(
      inspect(
        `provideAgent(${fixtureFactory(
          'langgraph',
          `return { createSession: (context) => { return createSession({ ${langGraphOptions} }); } };`
        )})`
      )
    ).toEqual([]);
    // Agent config beside the session factory.
    expect(
      inspect(
        `provideAgent(${fixtureFactory(
          'langgraph',
          `return { ${fixtureSessionMember(
            'langgraph'
          )}, threadId: activeThread, onThreadId: (id: string) => activeThread.set(id) };`
        )})`
      )
    ).toEqual([]);
  });

  it.each<
    [string, CompatibleRuntimeAdapter, () => string, string[], RegExp]
  >([
    [
      'a hard-coded deployment URL',
      'langgraph',
      () =>
        changed(
          langGraphOptions,
          'apiUrl: connection.apiUrl',
          "apiUrl: 'https://deployment.example'"
        ),
      ['session-connection-wiring'],
      /apiUrl must be an explicit apiUrl: connection\.apiUrl/,
    ],
    [
      'a hard-coded AG-UI endpoint',
      'ag-ui',
      () => changed(agUiOptions, 'url: connection.url', "url: '/agent'"),
      ['session-connection-wiring'],
      /url must be an explicit url: connection\.url/,
    ],
    [
      'a hard-coded assistant',
      'langgraph',
      () =>
        changed(
          langGraphOptions,
          'assistantId: connection.assistantId',
          "assistantId: 'another-graph'"
        ),
      ['session-connection-wiring'],
      /assistantId must be an explicit/,
    ],
    [
      'dropped cockpit client options',
      'langgraph',
      () =>
        changed(langGraphOptions, 'clientOptions: connection.clientOptions,', ''),
      ['session-connection-wiring'],
      /clientOptions must be an explicit/,
    ],
    [
      'client options replaced by a literal',
      'langgraph',
      () =>
        changed(
          langGraphOptions,
          'clientOptions: connection.clientOptions',
          'clientOptions: { maxRetries: 4 }'
        ),
      ['session-connection-wiring'],
      /clientOptions must be an explicit/,
    ],
    [
      "client options read from the context instead of the cockpit's connection",
      'langgraph',
      () =>
        changed(
          langGraphOptions,
          'clientOptions: connection.clientOptions',
          'clientOptions: context.clientOptions'
        ),
      ['session-connection-wiring'],
      /clientOptions must be an explicit/,
    ],
    [
      'connection values crossed',
      'langgraph',
      () =>
        changed(
          langGraphOptions,
          'apiUrl: connection.apiUrl',
          'apiUrl: connection.assistantId'
        ),
      ['noncanonical-provider-wiring', 'session-connection-wiring'],
      /apiUrl must be an explicit/,
    ],
    [
      'a connection value given twice',
      'langgraph',
      () => `${langGraphOptions} apiUrl: '/other',`,
      ['session-connection-wiring'],
      /option apiUrl is given more than once/,
    ],
    [
      'a spread that can replace a connection value',
      'langgraph',
      () => `${langGraphOptions} ...overrides,`,
      ['session-connection-wiring'],
      /options may not contain spreads/,
    ],
    [
      'a custom transport that replaces the connection',
      'langgraph',
      () => `${langGraphOptions} transport: customTransport,`,
      ['session-connection-wiring'],
      /option transport replaces the cockpit runtime connection/,
    ],
    [
      'a hand-built agent that replaces the endpoint',
      'ag-ui',
      () => `${agUiOptions} agent: customAgent,`,
      ['session-connection-wiring'],
      /option agent replaces the cockpit runtime connection/,
    ],
    [
      'a custom fetch that can reroute the endpoint',
      'ag-ui',
      () => `${agUiOptions} fetch: customFetch,`,
      ['session-connection-wiring'],
      /option fetch replaces the cockpit runtime connection/,
    ],
    [
      'a fixed thread',
      'langgraph',
      () =>
        changed(
          langGraphOptions,
          'threadId: context.threadId',
          "threadId: 'thread-1'"
        ),
      ['session-context-wiring'],
      /threadId must be the provider context's threadId/,
    ],
    [
      'a session that ignores the thread it is asked to open',
      'ag-ui',
      () => changed(agUiOptions, 'threadId: context.threadId,', ''),
      ['session-context-wiring'],
      /threadId must be the provider context's threadId/,
    ],
    [
      'an AG-UI session whose own thread id is never reported to the agent',
      'ag-ui',
      () => changed(agUiOptions, 'onThreadId: context.onThreadId,', ''),
      ['session-context-wiring'],
      /onThreadId must be the provider context's onThreadId: a session that does not report the thread it names or creates leaves the agent without a thread id/,
    ],
    [
      'an AG-UI thread callback that bypasses the agent',
      'ag-ui',
      () =>
        changed(
          agUiOptions,
          'onThreadId: context.onThreadId',
          'onThreadId: (id: string) => remember(id)'
        ),
      ['session-context-wiring'],
      /onThreadId must be the provider context's onThreadId/,
    ],
    [
      'a created thread that is never reported to the agent',
      'langgraph',
      () => changed(langGraphOptions, 'onThreadId: context.onThreadId,', ''),
      ['session-context-wiring'],
      /onThreadId must be the provider context's onThreadId/,
    ],
    [
      'a thread callback that bypasses the agent',
      'langgraph',
      () =>
        changed(
          langGraphOptions,
          'onThreadId: context.onThreadId',
          'onThreadId: (id: string) => remember(id)'
        ),
      ['session-context-wiring'],
      /onThreadId must be the provider context's onThreadId/,
    ],
    [
      'thread members crossed',
      'langgraph',
      () =>
        changed(
          langGraphOptions,
          'threadId: context.threadId',
          'threadId: context.clientOptions'
        ),
      ['session-context-wiring'],
      /threadId must be the provider context's threadId/,
    ],
    [
      'a context member that does not exist',
      'langgraph',
      () => `${langGraphOptions} signal: context.signal,`,
      ['session-context-wiring'],
      /the provider context has no member signal/,
    ],
    [
      'the context handed to a helper',
      'langgraph',
      () => `${langGraphOptions} extra: describe(context),`,
      ['session-context-wiring'],
      /may only be read as the whole value of a createSession option; found context/,
    ],
    [
      'a context member read inside an expression',
      'langgraph',
      () =>
        changed(
          langGraphOptions,
          'threadId: context.threadId',
          'threadId: context.threadId || fallbackThread'
        ),
      ['session-context-wiring'],
      /threadId must be the provider context's threadId/,
    ],
    [
      'a spread of the whole context',
      'langgraph',
      () =>
        `apiUrl: connection.apiUrl, assistantId: connection.assistantId, clientOptions: connection.clientOptions, ...context,`,
      [
        'development-runtime-wiring',
        'operation-reporter-wiring',
        'session-context-wiring',
      ],
      /options may not spread the provider context/,
    ],
    [
      'a dropped development runtime',
      'langgraph',
      () =>
        changed(
          langGraphOptions,
          'developmentRuntime: context.developmentRuntime,',
          ''
        ),
      ['development-runtime-wiring'],
      /createSession must be given the provider context's developmentRuntime as developmentRuntime/,
    ],
    [
      'a dropped AG-UI development runtime',
      'ag-ui',
      () =>
        changed(agUiOptions, 'developmentRuntime: context.developmentRuntime,', ''),
      ['development-runtime-wiring'],
      /createSession must be given the provider context's developmentRuntime as developmentRuntime/,
    ],
    [
      'the development runtime under an invented name',
      'langgraph',
      () => changed(langGraphOptions, 'developmentRuntime:', 'telemetryRuntime:'),
      ['development-runtime-wiring'],
      /passed as telemetryRuntime, which the langgraph session does not accept \(it takes developmentRuntime\); it is dropped/,
    ],
    [
      'a development runtime the host never sees',
      'ag-ui',
      () =>
        changed(
          agUiOptions,
          'context.developmentRuntime',
          '() => undefined'
        ),
      ['development-runtime-wiring'],
      /developmentRuntime must be the provider context's developmentRuntime/,
    ],
    [
      'the development runtime option given another context member',
      'langgraph',
      () =>
        changed(
          langGraphOptions,
          'context.developmentRuntime',
          'context.onThreadId'
        ),
      ['development-runtime-wiring'],
      /developmentRuntime must be the provider context's developmentRuntime/,
    ],
    [
      'a dropped operation reporter',
      'langgraph',
      () =>
        changed(
          langGraphOptions,
          `${langGraphReporter}: context.reportOperationFailure,`,
          ''
        ),
      ['operation-reporter-wiring'],
      /createSession must be given the provider context's reportOperationFailure as reportOperationFailure/,
    ],
    [
      'a dropped AG-UI operation reporter',
      'ag-ui',
      () =>
        changed(
          agUiOptions,
          `${agUiReporter}: context.reportOperationFailure,`,
          ''
        ),
      ['operation-reporter-wiring'],
      /createSession must be given the provider context's reportOperationFailure as reportOperationFailure/,
    ],
    [
      "the reporter under the LangGraph session's deprecated alias",
      'langgraph',
      () =>
        changed(langGraphOptions, `${langGraphReporter}:`, 'onOperationFailure:'),
      ['operation-reporter-wiring'],
      /passed as onOperationFailure, a deprecated alias of the langgraph session; pass it as reportOperationFailure/,
    ],
    [
      "the reporter under the LangGraph session's old name on an AG-UI session",
      'ag-ui',
      () => changed(agUiOptions, `${agUiReporter}:`, 'onOperationFailure:'),
      ['operation-reporter-wiring'],
      /passed as onOperationFailure, which the ag-ui session does not accept \(it takes reportOperationFailure\); the reporter is dropped/,
    ],
    [
      'the reporter under an invented name',
      'langgraph',
      () => changed(langGraphOptions, `${langGraphReporter}:`, 'onFailure:'),
      ['operation-reporter-wiring'],
      /passed as onFailure, which the langgraph session does not accept/,
    ],
    [
      'a reporter the host never sees',
      'langgraph',
      () =>
        changed(
          langGraphOptions,
          'context.reportOperationFailure',
          '() => undefined'
        ),
      ['operation-reporter-wiring'],
      /reportOperationFailure must be the provider context's reportOperationFailure/,
    ],
    [
      'the reporter option given another context member',
      'ag-ui',
      () =>
        changed(
          agUiOptions,
          'context.reportOperationFailure',
          'context.onThreadId'
        ),
      ['operation-reporter-wiring'],
      /reportOperationFailure must be the provider context's reportOperationFailure/,
    ],
  ])(
    'rejects %s',
    (_label, adapter, options, expectedKinds, expectedDetail) => {
      const issues = sessionIssues(adapter, options());
      expect(kindsOf(issues)).toEqual(expectedKinds);
      expect(issues.map(({ detail }) => detail).join('\n')).toMatch(
        expectedDetail
      );
    }
  );

  it('accepts the reporter option name the session interface declares and rejects a deprecated alias', () => {
    const alias = changed(
      langGraphOptions,
      `${langGraphReporter}:`,
      'onOperationFailure:'
    );
    const aliasIssue = {
      kind: 'operation-reporter-wiring',
      detail:
        'the operation reporter is passed as onOperationFailure, a deprecated alias of the langgraph session; pass it as reportOperationFailure',
    };
    // The audit's defaults are the libraries' names today: one current name
    // for both sessions, and the LangGraph session's old name as an alias it
    // still reads. The alias is delivered, so the only issue is its name.
    expect(sessionIssues('langgraph', langGraphOptions)).toEqual([]);
    expect(sessionIssues('langgraph', alias)).toEqual([aliasIssue]);
    // The names the applications are audited with are read from the session
    // option interfaces, `@deprecated` tags included, and give the same result.
    expect(reporterOptionNames).toEqual(defaultReporterOptionNames);
    expect(deprecatedReporterOptionNames).toEqual(
      defaultDeprecatedReporterOptionNames
    );
    const withLibraryNames = (options: string) =>
      inspectRuntimeTargetSource(
        fixtureAppConfig('langgraph', fixtureProvider('langgraph', options)),
        'src/app/app.config.ts',
        'langgraph',
        undefined,
        auditOptions
      ).issues;
    expect(withLibraryNames(langGraphOptions)).toEqual([]);
    expect(withLibraryNames(alias)).toEqual([aliasIssue]);
    // The AG-UI session never had the alias: there the reporter is dropped.
    expect(
      sessionIssues(
        'ag-ui',
        changed(agUiOptions, `${agUiReporter}:`, 'onOperationFailure:')
      ).map(({ detail }) => detail)
    ).toEqual([
      'the operation reporter is passed as onOperationFailure, which the ag-ui session does not accept (it takes reportOperationFailure); the reporter is dropped without an error',
      "createSession must be given the provider context's reportOperationFailure as reportOperationFailure",
    ]);
    // The audit follows whatever names it is told. A session that declared
    // only the old name would take it, and the new one would be dropped.
    const old: ReporterOptionNames = {
      langgraph: ['onOperationFailure'],
      'ag-ui': ['reportOperationFailure'],
    };
    expect(sessionIssues('langgraph', alias, old)).toEqual([]);
    expect(
      kindsOf(sessionIssues('langgraph', langGraphOptions, old))
    ).toEqual(['operation-reporter-wiring']);
    // A session that declared both as current would take either.
    const both: ReporterOptionNames = {
      langgraph: ['onOperationFailure', 'reportOperationFailure'],
      'ag-ui': ['reportOperationFailure'],
    };
    expect(sessionIssues('langgraph', alias, both)).toEqual([]);
    expect(sessionIssues('langgraph', langGraphOptions, both)).toEqual([]);
  });

  it('requires the agent config to build its session inline from the provider context', () => {
    const configIssues = (body: string, adapter: CompatibleRuntimeAdapter = 'langgraph') =>
      inspectRuntimeTargetSource(
        fixtureAppConfig(adapter, `provideAgent(${fixtureFactory(adapter, body)})`),
        'src/app/app.config.ts',
        adapter
      ).issues;
    const details = (issues: readonly RuntimeWiringAuditIssue[]): string =>
      issues.map(({ detail }) => detail).join('\n');
    const member = fixtureSessionMember('langgraph');
    expect(configIssues(`return { ${member} };`)).toEqual([]);

    const helper = configIssues('return { createSession: makeSession };');
    expect(kindsOf(helper)).toEqual(['noncanonical-provider-wiring']);
    expect(details(helper)).toMatch(/createSession must be an inline arrow/);

    const ignoresContext = configIssues(
      `return { createSession: () => createSession({ apiUrl: connection.apiUrl, assistantId: connection.assistantId, clientOptions: connection.clientOptions }) };`
    );
    expect(details(ignoresContext)).toMatch(
      /createSession must take exactly the provider context parameter/
    );

    const extraStatements = configIssues(
      `return { createSession: (context) => { prepare(); return createSession({ ${langGraphOptions} }); } };`
    );
    expect(details(extraStatements)).toMatch(
      /createSession must return a direct createSession\(\.\.\.\) call and nothing else/
    );

    const wrapped = configIssues(
      `return { createSession: (context) => decorate(createSession({ ${langGraphOptions} })) };`
    );
    expect(kindsOf(wrapped)).toEqual([
      'noncanonical-provider-wiring',
      'session-outside-provider-factory',
    ]);

    const indirectOptions = configIssues(
      `return { createSession: (context) => createSession(sessionOptions(context)) };`
    );
    expect(details(indirectOptions)).toMatch(
      /createSession must be given one inline options object/
    );

    const defaulted = configIssues(
      `return { createSession: (context = fallbackContext) => createSession({ ${langGraphOptions} }) };`
    );
    expect(details(defaulted)).toMatch(/may not have a default/);

    const missing = configIssues('return { threadId: activeThread };');
    expect(details(missing)).toMatch(
      /agent config requires an explicit createSession member/
    );

    const unknownMember = configIssues(
      `return { ${member}, transport: customTransport };`
    );
    expect(kindsOf(unknownMember)).toEqual(['noncanonical-provider-wiring']);
    expect(details(unknownMember)).toMatch(
      /agent config member transport is not part of the audited wiring/
    );

    const spreadConfig = configIssues(`return { ...baseConfig, ${member} };`);
    expect(details(spreadConfig)).toMatch(
      /agent config forbids spread, computed, method, and shorthand members/
    );

    const duplicate = configIssues(
      `return { ${member}, createSession: makeSession };`
    );
    expect(details(duplicate)).toMatch(
      /agent config member createSession is given more than once/
    );

    // A typed ref reached through anything but its own import.
    const refIssues = (ref: string, imports = '') =>
      inspectRuntimeTargetSource(
        fixtureAppConfig(
          'langgraph',
          `provideAgent(${ref}, ${fixtureFactory('langgraph')})`,
          `${fixtureImports.langgraph}\n${imports}`
        ),
        'src/app/app.config.ts',
        'langgraph'
      ).issues;
    expect(
      refIssues(
        'STREAMING_AGENT',
        "import { STREAMING_AGENT } from './agent-ref';"
      )
    ).toEqual([]);
    expect(details(refIssues('refs.STREAMING_AGENT'))).toMatch(
      /typed provider refs must be a direct identifier first argument/
    );
    expect(
      details(
        refIssues(
          'STREAMING_AGENT',
          "import { STREAMING_AGENT } from './other-ref';"
        )
      )
    ).toMatch(
      /typed provider ref STREAMING_AGENT requires its stable \.\/agent-ref import/
    );
  });

  it('rejects a session or directory built anywhere but its provider factory', () => {
    const outside = (source: string, fileName = 'src/app/session-helper.ts') =>
      inspectRuntimeTargetSource(source, fileName, 'langgraph').issues;
    // A component that builds its own session: it has no provider context, so
    // it ignores the agent's thread and reports no refused request.
    expect(
      kindsOf(
        outside(
          `import { createSession } from '@threadplane/langgraph';
           export function openSession(target: string) {
             return createSession({ apiUrl: target, assistantId: 'chat' });
           }`
        )
      )
    ).toEqual(['session-outside-provider-factory']);
    expect(
      kindsOf(
        outside(
          `import { createSession } from '@threadplane/ag-ui';
           export function openSession(target: string) {
             return createSession({ url: target });
           }`
        )
      )
    ).toEqual(['session-outside-provider-factory']);
    expect(
      kindsOf(
        outside(
          `import { createLangGraphThreadDirectory } from '@threadplane/langgraph';
           export function openDirectory(target: string) {
             return createLangGraphThreadDirectory({ apiUrl: target });
           }`
        )
      )
    ).toEqual(['session-outside-provider-factory']);

    const inFactory = (body: string) =>
      inspectRuntimeTargetSource(
        fixtureAppConfig(
          'langgraph',
          `provideAgent(${fixtureFactory('langgraph', body)})`
        ),
        'src/app/app.config.ts',
        'langgraph'
      ).issues;
    // One session hoisted out of the per-thread factory: every thread switch
    // would get the same session, opened without a thread.
    expect(
      kindsOf(
        inFactory(
          `const session = createSession({ apiUrl: connection.apiUrl, assistantId: connection.assistantId, clientOptions: connection.clientOptions });
           return { createSession: () => session };`
        )
      )
    ).toEqual([
      'noncanonical-provider-wiring',
      'session-outside-provider-factory',
    ]);
    // The session built by a helper the factory calls.
    expect(
      kindsOf(
        inFactory(
          `const makeSession = (context) => createSession({ ${langGraphOptions} });
           return { createSession: makeSession };`
        )
      )
    ).toEqual([
      'noncanonical-provider-wiring',
      'session-outside-provider-factory',
    ]);
    // The backend factory handed over as the config member: it would be called
    // with the provider context as its options.
    expect(kindsOf(inFactory('return { createSession };'))).toEqual([
      'noncanonical-provider-wiring',
      'session-outside-provider-factory',
    ]);
    expect(
      kindsOf(inFactory('return { createSession: createSession };'))
    ).toEqual([
      'noncanonical-provider-wiring',
      'session-outside-provider-factory',
    ]);
    // The canonical call is the only one that passes.
    expect(inFactory(`return { ${fixtureSessionMember('langgraph')} };`)).toEqual(
      []
    );
  });

  it('rejects a session from a backend other than the one the application declares', () => {
    const wrongBackend = (
      expected: CompatibleRuntimeAdapter,
      imported: CompatibleRuntimeAdapter
    ) =>
      inspectRuntimeTargetSource(
        fixtureAppConfig(
          expected,
          `provideAgent(${fixtureFactory(
            expected,
            `return { ${fixtureSessionMember(imported)} };`
          )})`,
          fixtureImports[imported]
        ),
        'src/app/app.config.ts',
        expected
      ).issues.map(({ detail }) => detail);
    expect(wrongBackend('langgraph', 'ag-ui')).toContain(
      'session adapter ag-ui does not match langgraph'
    );
    expect(wrongBackend('ag-ui', 'langgraph')).toContain(
      'session adapter langgraph does not match ag-ui'
    );
    expect(wrongBackend('langgraph', 'langgraph')).toEqual([]);
    // A look-alike factory from a local module is no backend at all.
    expect(
      inspectRuntimeTargetSource(
        fixtureAppConfig(
          'langgraph',
          fixtureProvider('langgraph'),
          changed(
            fixtureImports.langgraph,
            "from '@threadplane/langgraph'",
            "from './fake-langgraph'"
          )
        ),
        'src/app/app.config.ts',
        'langgraph'
      ).issues.map(({ detail }) => detail)
    ).toContain(
      'createSession requires its stable direct import from @threadplane/langgraph'
    );
  });

  it('keeps the host reporter token and the client options token in their one sanctioned place', () => {
    const issuesOf = (source: string, fileName: string) =>
      inspectRuntimeTargetSource(source, fileName, 'langgraph').issues;
    const entrypoint = `
      import { ɵAGENT_OPERATION_FAILURE_REPORTER } from '@threadplane/angular';
      import { bootstrapWithCockpitHarness } from '@threadplane/cockpit-telemetry';
      import { appConfig } from './app/app.config';
      import { StreamingComponent } from './app/streaming.component';
      import { environment } from './environments/environment';
      void bootstrapWithCockpitHarness(StreamingComponent, appConfig, {
        runtime: {
          adapter: 'langgraph',
          sharedApiUrl: environment.langGraphApiUrl,
          assistantId: environment.streamingAssistantId,
          operationReporterToken: ɵAGENT_OPERATION_FAILURE_REPORTER,
        },
      }).catch(() => undefined);
    `;
    expect(issuesOf(entrypoint, 'src/main.ts')).toEqual([]);
    // The application overriding the reporter the harness provides.
    const override = issuesOf(
      `import { ɵAGENT_OPERATION_FAILURE_REPORTER } from '@threadplane/angular';
       export const appConfig = { providers: [
         { provide: ɵAGENT_OPERATION_FAILURE_REPORTER, useFactory: () => () => undefined },
       ] };`,
      'src/app/app.config.ts'
    );
    expect(kindsOf(override)).toEqual(['operation-reporter-wiring']);
    expect(
      kindsOf(
        issuesOf(
          `import { inject } from '@angular/core';
           import { ɵAGENT_OPERATION_FAILURE_REPORTER } from '@threadplane/angular';
           export const read = () => inject(ɵAGENT_OPERATION_FAILURE_REPORTER);`,
          'src/app/reporter.ts'
        )
      )
    ).toEqual(['operation-reporter-wiring']);
    expect(
      kindsOf(
        issuesOf(
          `${entrypoint}\nregister(ɵAGENT_OPERATION_FAILURE_REPORTER);`,
          'src/main.ts'
        )
      )
    ).toEqual(['operation-reporter-wiring']);

    // Client options that do not come from the cockpit's connection.
    const fixedOptions = issuesOf(
      `import { AGENT_CLIENT_OPTIONS } from '@threadplane/angular';
       export const appConfig = { providers: [
         { provide: AGENT_CLIENT_OPTIONS, useFactory: () => ({ maxRetries: 4 }) },
       ] };`,
      'src/app/app.config.ts'
    );
    expect(kindsOf(fixedOptions)).toEqual(['session-connection-wiring']);
    expect(
      kindsOf(
        issuesOf(
          `import { AGENT_CLIENT_OPTIONS } from '@threadplane/angular';
           export const appConfig = { providers: [
             { provide: AGENT_CLIENT_OPTIONS, useValue: fixedOptions },
           ] };`,
          'src/app/app.config.ts'
        )
      )
    ).toEqual(['noncanonical-provider-wiring', 'session-connection-wiring']);
    expect(
      kindsOf(
        issuesOf(
          `import { provideAgentClientOptions } from '@threadplane/angular';
           export const appConfig = { providers: [provideAgentClientOptions(fixedOptions)] };`,
          'src/app/app.config.ts'
        )
      )
    ).toEqual(['session-connection-wiring']);
    expect(
      issuesOf(
        `import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';
         import { AGENT_CLIENT_OPTIONS } from '@threadplane/angular';
         export const appConfig = { providers: [
           { provide: AGENT_CLIENT_OPTIONS, useFactory: ${fixtureFactory(
             'langgraph',
             'return connection.clientOptions;'
           )} },
         ] };`,
        'src/app/app.config.ts'
      )
    ).toEqual([]);
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
        const sessionModule =
          capability.runtimeAdapter === 'ag-ui'
            ? '@threadplane/ag-ui'
            : '@threadplane/langgraph';
        if (
          !hasExactSemanticBinding(
            bindingProvider.provideAgentBinding,
            agentProviderModule,
            'provideAgent'
          )
        ) {
          mismatches.push({
            project: capability.angularProject,
            mismatch: `provideAgent import from ${agentProviderModule}`,
          });
        }
        // The backend the session comes from is the application's adapter.
        if (
          provider.adapter !== capability.runtimeAdapter ||
          !hasExactSemanticBinding(
            provider.createSessionBinding,
            sessionModule,
            'createSession'
          )
        ) {
          mismatches.push({
            project: capability.angularProject,
            mismatch: `createSession import from ${sessionModule}`,
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
      if (
        expected.retainedSessionProperties &&
        !hasExpectedProviderProperties(
          providerCalls,
          expected.retainedSessionProperties,
          'sessionProperties'
        )
      ) {
        mismatches.push({
          project: capability.angularProject,
          mismatch: `retained session options ${JSON.stringify(
            expected.retainedSessionProperties
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
          operationReporterToken: ɵAGENT_OPERATION_FAILURE_REPORTER,
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
              operationReporterToken: ɵAGENT_OPERATION_FAILURE_REPORTER,
            },
          }).catch(() => undefined);`,
          'ag-ui'
        ),
        agUiExpected,
        'ag-ui'
      )
    ).toContain("sharedUrl new URL('agent', document.baseURI).pathname");
    const canonicalProviderPreamble = fixtureImports.langgraph;
    const executableWrongRef = `${canonicalProviderPreamble}
      provideAgent(MESSAGES_AGENT, ${fixtureFactory('langgraph')});
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
    const sessionOption = (option: string): CanonicalProviderCall[] =>
      inspectRuntimeTargetSource(
        fixtureAppConfig(
          'langgraph',
          fixtureProvider(
            'langgraph',
            `${fixtureSessionOptions.langgraph}\n${option}`
          )
        ),
        'src/app/app.config.ts',
        'langgraph'
      ).providerCalls;
    expect(
      hasExpectedProviderProperties(
        sessionOption("// subagentToolNames: ['task']"),
        { subagentToolNames: "['task']" },
        'sessionProperties'
      )
    ).toBe(false);
    expect(
      hasExpectedProviderProperties(
        sessionOption("subagentToolNames: ['other'],"),
        { subagentToolNames: "['task']" },
        'sessionProperties'
      )
    ).toBe(false);
    expect(
      hasExpectedProviderProperties(
        sessionOption("subagentToolNames: ['task'],"),
        { subagentToolNames: "['task']" },
        'sessionProperties'
      )
    ).toBe(true);
    // A session option is not an agent config member, and the reverse.
    expect(
      hasExpectedProviderProperties(
        sessionOption("subagentToolNames: ['task'],"),
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
        operationReporterToken: ɵAGENT_OPERATION_FAILURE_REPORTER,
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
        operationReporterToken: ɵAGENT_OPERATION_FAILURE_REPORTER,
      },
    }`;
    const bootstrapImports = `
      import { ɵAGENT_OPERATION_FAILURE_REPORTER } from '@threadplane/angular';
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
        agentProviderModule,
        operationReporterToken
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
            "import { ɵAGENT_OPERATION_FAILURE_REPORTER } from '@threadplane/angular';",
            'const ɵAGENT_OPERATION_FAILURE_REPORTER = fakeReporter;'
          )}\n${bootstrapCall}`
        ).operationReporterBinding,
        agentProviderModule,
        operationReporterToken
      )
    ).toBe(false);
    // The reporter token of a backend package, or under a legacy name, is a
    // token nothing provides: no failure would ever reach the host.
    const streamingExpected = expectedRuntimeWiringByProject.get(
      'cockpit-langgraph-streaming-angular'
    ) as ExpectedRuntimeWiring;
    expect(
      auditEntrypointMetadata(canonicalBootstrap, streamingExpected, 'langgraph')
    ).toEqual([]);
    expect(
      auditEntrypointMetadata(
        inspectBootstrap(
          `${changed(
            bootstrapImports,
            "import { ɵAGENT_OPERATION_FAILURE_REPORTER } from '@threadplane/angular';",
            "import { ɵAGENT_OPERATION_FAILURE_REPORTER } from '@threadplane/langgraph';"
          )}\n${bootstrapCall}`
        ),
        streamingExpected,
        'langgraph'
      )
    ).toEqual([`operation reporter import from ${agentProviderModule}`]);
    expect(
      auditEntrypointMetadata(
        inspectBootstrap(
          `${bootstrapImports}\nimport { ɵLEGACY_REPORTER } from '@threadplane/angular';\n${changed(
            bootstrapCall,
            'operationReporterToken: ɵAGENT_OPERATION_FAILURE_REPORTER',
            'operationReporterToken: ɵLEGACY_REPORTER'
          )}`
        ),
        streamingExpected,
        'langgraph'
      )
    ).toEqual([
      'canonical runtime options grammar',
      `operation reporter import from ${agentProviderModule}`,
      `operationReporterToken ${operationReporterToken}`,
    ]);
    // An entrypoint with no reporter at all.
    expect(
      auditEntrypointMetadata(
        inspectBootstrap(
          `${bootstrapImports}\n${changed(
            bootstrapCall,
            'operationReporterToken: ɵAGENT_OPERATION_FAILURE_REPORTER,',
            ''
          )}`
        ),
        streamingExpected,
        'langgraph'
      )
    ).toEqual(
      expect.arrayContaining([
        'canonical runtime options grammar',
        `operationReporterToken ${operationReporterToken}`,
      ])
    );
    expect(
      hasExactSemanticBinding(
        inspectBootstrap(
          `${changed(
            bootstrapImports,
            "import { ɵAGENT_OPERATION_FAILURE_REPORTER } from '@threadplane/angular';",
            "import { ɵAGENT_OPERATION_FAILURE_REPORTER } from '@threadplane/langgraph';"
          )}\n${bootstrapCall}`
        ).operationReporterBinding,
        agentProviderModule,
        operationReporterToken
      )
    ).toBe(false);
    expect(
      hasExactSemanticBinding(
        inspectBootstrap(
          `${changed(
            bootstrapImports,
            'import { ɵAGENT_OPERATION_FAILURE_REPORTER }',
            'import { OTHER_REPORTER as ɵAGENT_OPERATION_FAILURE_REPORTER }'
          )}\n${bootstrapCall}`
        ).operationReporterBinding,
        agentProviderModule,
        operationReporterToken
      )
    ).toBe(false);
    const inspectProvider = (imports: string): SemanticProviderCall | undefined =>
      inspectRuntimeTargetSource(
        `${imports}
         import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';
         export const appConfig = { providers: [
           provideAgent(STREAMING_AGENT, ${fixtureFactory('langgraph')})
         ] };`,
        'src/app/app.config.ts',
        'langgraph'
      ).providerCalls[0] as SemanticProviderCall | undefined;
    const canonicalImports = `
      import { provideAgent } from '@threadplane/angular';
      import { createSession } from '@threadplane/langgraph';
      import { STREAMING_AGENT } from './agent-ref';
    `;
    const canonicalProvider = inspectProvider(canonicalImports);
    expect(
      hasExactSemanticBinding(
        canonicalProvider?.provideAgentBinding,
        agentProviderModule,
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
        canonicalProvider?.createSessionBinding,
        '@threadplane/langgraph',
        'createSession'
      )
    ).toBe(true);
    expect(canonicalProvider?.adapter).toBe('langgraph');
    for (const replacement of [
      "import { provideAgent } from './fake-agent';",
      "import { provideAgent } from '@threadplane/langgraph';",
      'const provideAgent = fakeProvideAgent;',
    ]) {
      expect(
        hasExactSemanticBinding(
          inspectProvider(
            changed(
              canonicalImports,
              "import { provideAgent } from '@threadplane/angular';",
              replacement
            )
          )?.provideAgentBinding,
          agentProviderModule,
          'provideAgent'
        )
      ).toBe(false);
    }
    for (const replacement of [
      'const STREAMING_AGENT = fakeAgentRef;',
      "import { STREAMING_AGENT } from './fake-agent-ref';",
    ]) {
      expect(
        hasExactSemanticBinding(
          inspectProvider(
            changed(
              canonicalImports,
              "import { STREAMING_AGENT } from './agent-ref';",
              replacement
            )
          )?.agentRefBinding,
          './agent-ref',
          'STREAMING_AGENT'
        )
      ).toBe(false);
    }
    for (const replacement of [
      "import { createSession } from './fake-session';",
      "import { createSession } from '@threadplane/ag-ui';",
      'const createSession = fakeCreateSession;',
    ]) {
      expect(
        hasExactSemanticBinding(
          inspectProvider(
            changed(
              canonicalImports,
              "import { createSession } from '@threadplane/langgraph';",
              replacement
            )
          )?.createSessionBinding,
          '@threadplane/langgraph',
          'createSession'
        )
      ).toBe(false);
    }
  });

  it('allows the LangGraph environment import only as the two runtime property roots', () => {
    const imports = `
      import { ɵAGENT_OPERATION_FAILURE_REPORTER } from '@threadplane/angular';
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
          operationReporterToken: ɵAGENT_OPERATION_FAILURE_REPORTER,
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
      import { ɵAGENT_OPERATION_FAILURE_REPORTER } from '@threadplane/angular';
      import { bootstrapWithCockpitHarness } from '@threadplane/cockpit-telemetry';
      import { appConfig } from './app/app.config';
      import { StreamingComponent } from './app/streaming.component';
    `;
    const runtime = `{
      adapter: 'ag-ui',
      sharedUrl: new URL('agent', document.baseURI).pathname,
      operationReporterToken: ɵAGENT_OPERATION_FAILURE_REPORTER,
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
          operationReporterToken: ɵAGENT_OPERATION_FAILURE_REPORTER,
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
          operationReporterToken: ɵAGENT_OPERATION_FAILURE_REPORTER,
          adapter: fakeAdapter,
        } }`)}`
      ).hasCanonicalRuntimeOptions
    ).toBe(false);
    expect(
      inspectBootstrap(
        `${imports}\n${call(`{ runtime: {
          adapter: 'ag-ui',
          sharedUrl,
          operationReporterToken: ɵAGENT_OPERATION_FAILURE_REPORTER,
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
          ['operationReporterToken']: ɵAGENT_OPERATION_FAILURE_REPORTER,
        } }`)}`
      ).hasCanonicalRuntimeOptions
    ).toBe(false);
    expect(
      inspectBootstrap(
        `${imports}\n${call(`{ runtime: {
          adapter: 'ag-ui',
          sharedUrl: new URL('agent', document.baseURI).pathname,
          operationReporterToken: ɵAGENT_OPERATION_FAILURE_REPORTER,
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
          operationReporterToken: ɵAGENT_OPERATION_FAILURE_REPORTER,
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
    const providerCalls = (
      path: string,
      adapter: CompatibleRuntimeAdapter = 'langgraph'
    ): CanonicalProviderCall[] =>
      inspectRuntimeTargetSource(
        read(path),
        path,
        adapter,
        undefined,
        auditOptions
      ).providerCalls;
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
    const threadsInspection = inspectRuntimeTargetSource(
      read('chat/threads/angular/src/app/app.config.ts'),
      'src/app/app.config.ts',
      'langgraph',
      undefined,
      auditOptions
    );
    const threadsComponent = providerCalls(
      'chat/threads/angular/src/app/threads.component.ts'
    );
    const agUi = providerCalls(
      'ag-ui/streaming/angular/src/app/app.config.ts',
      'ag-ui'
    );
    const mastra = providerCalls(
      'runtimes/mastra/angular/src/app/app.config.ts',
      'ag-ui'
    );

    expect(typed.map(({ agentRef }) => agentRef)).toEqual(['STREAMING_AGENT']);
    // Every connection value, the thread members and the reporter reach the
    // session; the reporter under a name this backend's session declares.
    expect(typed[0].sessionProperties).toMatchObject({
      apiUrl: 'connection.apiUrl',
      assistantId: 'connection.assistantId',
      clientOptions: 'connection.clientOptions',
      threadId: 'context.threadId',
      onThreadId: 'context.onThreadId',
    });
    expect(
      reporterOptionNames.langgraph.map(
        (name) => typed[0].sessionProperties[name]
      )
    ).toContain('context.reportOperationFailure');
    expect(agUi[0].sessionProperties).toMatchObject({
      url: 'connection.url',
      threadId: 'context.threadId',
      onThreadId: 'context.onThreadId',
    });
    expect(
      reporterOptionNames['ag-ui'].map((name) => agUi[0].sessionProperties[name])
    ).toContain('context.reportOperationFailure');
    expect(mastra[0].sessionProperties['interruptTransport']).toBe(
      "'mastra-command'"
    );
    expect(subagents[0].sessionProperties['subagentToolNames']).toBe(
      "['task']"
    );
    expect(subgraphs[0].sessionProperties['transcriptNodeNames']).toBe(
      "['answer']"
    );

    expect(persistenceConfig).toEqual([]);
    expect(persistenceComponent).toHaveLength(1);
    expect(persistenceComponent[0].properties['onThreadId']).toBe(
      persistenceOnThreadIdExpression
    );
    // The component's own callback sits beside the session's, not in place
    // of it: the session still reports its thread to the agent.
    expect(persistenceComponent[0].sessionProperties['onThreadId']).toBe(
      'context.onThreadId'
    );

    expect(threadsComponent).toHaveLength(1);
    expect(threadsComponent[0].properties['threadId']).toBe(
      'activeThreadIdState'
    );
    expect(threadsComponent[0].properties['onThreadId']).toBe(
      '(id: string) => activeThreadIdState.set(id)'
    );
    expect(threadsComponent[0].sessionProperties['threadId']).toBe(
      'context.threadId'
    );
    expect(threadsInspection.threadDirectoryProviders).toHaveLength(1);
    expect(
      threadsInspection.threadDirectoryProviders[0].directoryProperties['apiUrl']
    ).toBe('connection.apiUrl');
    expect(
      auditThreadsRootProviders([
        {
          relativeFileName: 'src/app/app.config.ts',
          angularProviders: threadsInspection.angularProviders,
          threadDirectoryProviders: threadsInspection.threadDirectoryProviders,
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
        operationReporterToken,
        'provideAgent(',
        'provideThreadDirectory(',
        'createSession(',
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
