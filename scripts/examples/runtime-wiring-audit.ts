import * as ts from 'typescript';

/**
 * Syntax-tree audit of how a configurable cockpit Angular application wires
 * its agent to the cockpit's runtime connection.
 *
 * The wiring it pins (LangGraph; AG-UI passes `url` in place of the three
 * connection members, and the same context members):
 *
 *   provideAgent(() => {
 *     const connection = injectCockpitRuntimeConnection();
 *     if (connection.adapter !== 'langgraph') throw new Error('incompatible runtime');
 *     return { createSession: async (context) => createSession({
 *       apiUrl: connection.apiUrl, assistantId: connection.assistantId,
 *       clientOptions: connection.clientOptions,
 *       threadId: context.threadId, onThreadId: context.onThreadId,
 *       reportOperationFailure: context.reportOperationFailure,
 *       developmentRuntime: context.developmentRuntime }) };
 *   })
 *
 * What each issue kind catches:
 *
 * - `noncanonical-provider-wiring`: the provider, the connection injector or
 *   the session factory imported from the wrong place or aliased; a provider
 *   registered where Angular never runs it; a factory that does anything but
 *   read the connection, check its adapter and return; a session from a
 *   backend other than the one the application declares.
 * - `direct-agent-provider-config`: a provider given a ready config, which
 *   cannot have read the connection.
 * - `session-connection-wiring`: a deployment URL, assistant or client options
 *   that do not come from the connection (so the runtime switcher and the
 *   developer's key are ignored), or an option that replaces the connection.
 * - `session-context-wiring`: a session that does not take its thread from
 *   the provider context, or does not report the thread it creates; the
 *   context spread, copied or handed away.
 * - `operation-reporter-wiring`: the host's failure reporter dropped, passed
 *   under a name the session does not accept or under a deprecated alias
 *   (`onOperationFailure` on a LangGraph session), or its token used anywhere but
 *   the entrypoint, so a refused request never reaches the cockpit.
 * - `development-runtime-wiring`: the context's development-install relay
 *   dropped or passed under another name, so a development build of the
 *   application reports nothing where it used to report a session start.
 * - `session-outside-provider-factory`: a session or directory built anywhere
 *   but its provider factory, where there is no provider context at all.
 * - `thread-directory-wiring`: a thread list read from another deployment
 *   than the agent's, without the agent's client options, or without the
 *   host's failure reporter.
 * - `direct-agent-construction`: a client, transport or agent built by hand.
 * - `environment-config-outside-entrypoint`, `browser-state-read`,
 *   `global-runtime-secret-read`, `imported-runtime-secret`,
 *   `module-global-runtime-cache`, `runtime-secret-log`: a second source of
 *   runtime configuration, or a place a connection value can leak to.
 */
export type CompatibleRuntimeAdapter = 'ag-ui' | 'langgraph';

export type RuntimeWiringAuditKind =
  | 'browser-state-read'
  | 'global-runtime-secret-read'
  | 'imported-runtime-secret'
  | 'environment-config-outside-entrypoint'
  | 'module-global-runtime-cache'
  | 'direct-agent-provider-config'
  | 'noncanonical-provider-wiring'
  | 'direct-agent-construction'
  | 'session-outside-provider-factory'
  | 'session-connection-wiring'
  | 'session-context-wiring'
  | 'operation-reporter-wiring'
  | 'development-runtime-wiring'
  | 'thread-directory-wiring'
  | 'runtime-secret-log';

export interface RuntimeWiringAuditIssue {
  kind: RuntimeWiringAuditKind;
  detail: string;
}

export interface CanonicalProviderCall {
  /** The backend whose `createSession` the provider's factory calls. */
  adapter: CompatibleRuntimeAdapter;
  agentRef?: string;
  provideAgentBinding?: ExactImportBinding;
  agentRefBinding?: ExactImportBinding;
  createSessionBinding?: ExactImportBinding;
  /** Members of the agent config the provider factory returns. */
  properties: Readonly<Record<string, string>>;
  /** Members of the options object handed to the backend's `createSession`. */
  sessionProperties: Readonly<Record<string, string>>;
  owner?: ProviderRegistrationOwner;
}

export interface ThreadDirectoryProviderRecord {
  provideBinding?: ExactImportBinding;
  createDirectoryBinding?: ExactImportBinding;
  /** Members of the options handed to `createLangGraphThreadDirectory`. */
  directoryProperties: Readonly<Record<string, string>>;
  /** Where the directory's client options come from. */
  clientOptionsSource?: 'connection' | 'context';
  /** True when every thread-directory rule held for this provider. */
  canonical: boolean;
  owner?: ProviderRegistrationOwner;
}

/**
 * The option a backend's session takes the host's operation-failure reporter
 * under. The provider context names it `reportOperationFailure` and so do
 * both sessions; a reporter passed under any other name is silently dropped,
 * except a deprecated alias, which is rejected for being deprecated. The
 * audit is told the accepted names rather than
 * assuming them: `capability-wiring.spec.ts` reads them from the session
 * option interfaces, so a rename in a library needs no edit here.
 */
export type ReporterOptionNames = Readonly<
  Record<CompatibleRuntimeAdapter, readonly string[]>
>;

/** The names in the libraries (2026-11-20): one name for both sessions. */
export const defaultReporterOptionNames: ReporterOptionNames = {
  langgraph: ['reportOperationFailure'],
  'ag-ui': ['reportOperationFailure'],
};

/**
 * Names a session still reads but marks `@deprecated`. A reporter passed
 * under one is delivered, so it is not "dropped"; it is rejected so that no
 * application depends on a name the library is removing.
 */
export const defaultDeprecatedReporterOptionNames: ReporterOptionNames = {
  langgraph: ['onOperationFailure'],
  'ag-ui': [],
};

/** The option the thread directory takes the reporter under (2026-11-20). */
export const defaultDirectoryReporterOptionNames: readonly string[] = [
  'reportOperationFailure',
];

export interface RuntimeWiringAuditOptions {
  readonly reporterOptionNames?: ReporterOptionNames;
  readonly deprecatedReporterOptionNames?: ReporterOptionNames;
  /**
   * The option `createLangGraphThreadDirectory` takes the reporter under,
   * which the audit requires. An empty list says the directory declares none:
   * its refused requests then go unreported and no wiring can change that.
   */
  readonly directoryReporterOptionNames?: readonly string[];
}

/** The one token every cockpit entrypoint hands the harness. */
export const operationReporterToken = 'ɵAGENT_OPERATION_FAILURE_REPORTER';
export const agentProviderModule = '@threadplane/angular';

export type ProviderRegistrationOwner =
  | { readonly kind: 'appConfig' }
  | { readonly kind: 'component'; readonly component: string };

export interface BootstrapCallRecord {
  rootComponent?: string;
  rootComponentBinding?: ExactImportBinding;
  appConfigArgument?: string;
  hasCanonicalAppConfigBinding: boolean;
  hasCanonicalHarnessBinding: boolean;
  hasCanonicalCallOwner: boolean;
  hasCanonicalRuntimeOptions: boolean;
  hasPristineAgUrlGlobals: boolean;
  environmentBindings: readonly ExactImportBinding[];
  operationReporterBinding?: ExactImportBinding;
  runtimeProperties: Readonly<Record<string, string>>;
  hasRedactedCatch: boolean;
}

export interface AngularProviderRecord {
  provideToken: string;
  provideTokenBinding?: ExactImportBinding;
  connectionInjectorBinding?: ExactImportBinding;
  useFactoryExpression?: string;
  connectionDeclaration?: string;
  connectionCallCount: number;
  connectionWrites: boolean;
  canonicalFactory: boolean;
  returnExpression?: string;
  returnedProperties: Readonly<Record<string, string>>;
}

export interface ExactImportBinding {
  readonly identifier: string;
  readonly moduleName?: string;
  readonly importedName?: string;
  readonly canonical: boolean;
}

export function hasExactImportBinding(
  binding: ExactImportBinding | undefined,
  moduleName: string,
  importedName: string
): boolean {
  return (
    binding?.canonical === true &&
    binding.moduleName === moduleName &&
    binding.importedName === importedName
  );
}

export interface RuntimeTargetSourceInspection {
  issues: RuntimeWiringAuditIssue[];
  providerCalls: CanonicalProviderCall[];
  bootstrapCalls: BootstrapCallRecord[];
  angularProviders: AngularProviderRecord[];
  threadDirectoryProviders: ThreadDirectoryProviderRecord[];
}

const browserStateNames = new Set([
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'cookieStore',
  'URLSearchParams',
  'location',
  'history',
]);
const documentStateNames = new Set(['cookie', 'location', 'URL', 'referrer']);
const unconditionalBrowserMemberNames = new Set([
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'cookie',
  'href',
  'search',
  'hash',
  'pushState',
  'replaceState',
]);
const unconditionalSecretMemberNames = new Set([
  'authorization',
  'apiKey',
  'runtimeApiKey',
  'runtimeTarget',
  'customEndpoint',
]);
const agentModule =
  /^(?:@threadplane\/(?:ag-ui|langgraph)|@ag-ui\/|@langchain\/langgraph)/;
/** What the provider context offers a session factory. */
export const providerContextKeys = new Set([
  'threadId',
  'onThreadId',
  'clientOptions',
  'reportOperationFailure',
  'developmentRuntime',
]);
const contextReporterKey = 'reportOperationFailure';
/**
 * The context member that relays a session to the development-install
 * collector, and the option both backends' sessions take it under. A factory
 * that picks fields from the context drops it unless it names it.
 */
export const contextDevelopmentKey = 'developmentRuntime';
/**
 * What each backend's session must be given, and from where. `bypass` names
 * the options that replace the connection outright: a session handed one
 * ignores the URL (and, for LangGraph, the client options and the reporter).
 */
const sessionContract: Readonly<
  Record<
    CompatibleRuntimeAdapter,
    {
      readonly module: string;
      readonly connection: readonly string[];
      readonly context: readonly string[];
      readonly bypass: readonly string[];
    }
  >
> = {
  langgraph: {
    module: '@threadplane/langgraph',
    connection: ['apiUrl', 'assistantId', 'clientOptions'],
    context: ['threadId', 'onThreadId'],
    bypass: ['transport'],
  },
  'ag-ui': {
    module: '@threadplane/ag-ui',
    connection: ['url'],
    // The AG-UI session names a new conversation's thread itself and reports
    // it through `onThreadId`, as the LangGraph session reports the thread it
    // creates. Without it `agent.threadId()` stays null after the first run.
    context: ['threadId', 'onThreadId'],
    bypass: ['agent', 'fetch'],
  },
};
/** Names that may not be aliased, destructured or called anywhere else. */
const protectedWiringNames = [
  'provideAgent',
  'provideThreadDirectory',
  'createSession',
  'createLangGraphThreadDirectory',
];
const sessionFactoryNames = new Set([
  'createSession',
  'createLangGraphThreadDirectory',
]);
const agentConfigKeys = new Set([
  'createSession',
  'threadId',
  'onThreadId',
  'optionalCommands',
]);
const directoryConfigKeys = new Set(['createDirectory', 'getThread']);

function identifierTokens(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase());
}

function hasSequence(tokens: string[], sequence: string[]): boolean {
  return tokens.some((_, index) =>
    sequence.every((token, offset) => tokens[index + offset] === token)
  );
}

function isSensitiveRuntimeName(value: string): boolean {
  const tokens = identifierTokens(value);
  const endpointIndex = tokens.indexOf('endpoint');
  return (
    hasSequence(tokens, ['api', 'key']) ||
    hasSequence(tokens, ['api', 'url']) ||
    hasSequence(tokens, ['assistant', 'id']) ||
    hasSequence(tokens, ['runtime', 'target']) ||
    hasSequence(tokens, ['cockpit', 'runtime', 'connection']) ||
    hasSequence(tokens, ['custom', 'endpoint']) ||
    tokens.includes('credential') ||
    tokens.includes('authorization') ||
    (tokens.length === 1 && tokens[0] === 'connection') ||
    (endpointIndex >= 0 && tokens[endpointIndex + 1] !== 'count')
  );
}

function isSensitiveLogName(value: string): boolean {
  const tokens = identifierTokens(value);
  return (
    isSensitiveRuntimeName(value) ||
    (tokens.length === 1 &&
      ['connection', 'target', 'key', 'message', 'endpoint'].includes(
        tokens[0]
      )) ||
    hasSequence(tokens, ['runtime', 'message'])
  );
}

function staticPropertyName(expression: ts.Expression): string | undefined {
  if (ts.isStringLiteralLike(expression)) return expression.text;
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = staticPropertyName(expression.left);
    const right = staticPropertyName(expression.right);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  return undefined;
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return ts.isComputedPropertyName(name)
    ? staticPropertyName(name.expression)
    : undefined;
}

function accessChain(expression: ts.Expression): string[] {
  if (ts.isIdentifier(expression)) return [expression.text];
  if (ts.isPropertyAccessExpression(expression)) {
    return [...accessChain(expression.expression), expression.name.text];
  }
  if (ts.isElementAccessExpression(expression)) {
    const property = expression.argumentExpression
      ? staticPropertyName(expression.argumentExpression)
      : undefined;
    return property ? [...accessChain(expression.expression), property] : [];
  }
  return [];
}

function bindingNameContains(name: ts.BindingName, expected: string): boolean {
  if (ts.isIdentifier(name)) return name.text === expected;
  return name.elements.some(
    (element) =>
      ts.isBindingElement(element) &&
      bindingNameContains(element.name, expected)
  );
}

function bindingPropertyContains(
  name: ts.BindingName,
  expected: string
): boolean {
  if (ts.isIdentifier(name)) return false;
  return name.elements.some((element) => {
    if (!ts.isBindingElement(element)) return false;
    const property = element.propertyName;
    return (
      (property &&
        ((ts.isIdentifier(property) && property.text === expected) ||
          (ts.isStringLiteralLike(property) && property.text === expected))) ||
      bindingPropertyContains(element.name, expected)
    );
  });
}

function expressionRootIdentifier(
  expression: ts.Expression
): ts.Identifier | undefined {
  if (ts.isIdentifier(expression)) return expression;
  if (
    ts.isPropertyAccessExpression(expression) ||
    ts.isElementAccessExpression(expression)
  ) {
    return expressionRootIdentifier(expression.expression);
  }
  return undefined;
}

function functionParameters(
  node: ts.Node
): ts.NodeArray<ts.ParameterDeclaration> | undefined {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    return node.parameters;
  }
  return undefined;
}

function isLexicallyDeclared(identifier: ts.Identifier): boolean {
  const expected = identifier.text;
  for (
    let current: ts.Node | undefined = identifier.parent;
    current;
    current = current.parent
  ) {
    const parameters = functionParameters(current);
    if (
      parameters?.some((parameter) =>
        bindingNameContains(parameter.name, expected)
      )
    ) {
      return true;
    }
    if (ts.isBlock(current) || ts.isSourceFile(current)) {
      for (const statement of current.statements) {
        if (ts.isVariableStatement(statement)) {
          if (
            statement.declarationList.declarations.some((declaration) =>
              bindingNameContains(declaration.name, expected)
            )
          ) {
            return true;
          }
        }
        if (
          ts.isSourceFile(current) &&
          ts.isImportDeclaration(statement) &&
          statement.importClause
        ) {
          if (statement.importClause.name?.text === expected) return true;
          const bindings = statement.importClause.namedBindings;
          if (
            bindings &&
            ((ts.isNamespaceImport(bindings) &&
              bindings.name.text === expected) ||
              (ts.isNamedImports(bindings) &&
                bindings.elements.some(
                  (specifier) => specifier.name.text === expected
                )))
          ) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

function isLocallyShadowed(
  identifier: ts.Identifier,
  expected: string
): boolean {
  for (
    let current: ts.Node | undefined = identifier.parent;
    current && !ts.isSourceFile(current);
    current = current.parent
  ) {
    const parameters = functionParameters(current);
    if (
      parameters?.some((parameter) =>
        bindingNameContains(parameter.name, expected)
      )
    ) {
      return true;
    }
    if (ts.isCatchClause(current) && current.variableDeclaration) {
      if (bindingNameContains(current.variableDeclaration.name, expected)) {
        return true;
      }
    }
    if (
      (ts.isFunctionDeclaration(current) ||
        ts.isFunctionExpression(current) ||
        ts.isClassDeclaration(current) ||
        ts.isClassExpression(current)) &&
      current.name?.text === expected
    ) {
      return true;
    }
    if (
      (ts.isForStatement(current) ||
        ts.isForInStatement(current) ||
        ts.isForOfStatement(current)) &&
      current.initializer &&
      ts.isVariableDeclarationList(current.initializer) &&
      current.initializer.declarations.some((declaration) =>
        bindingNameContains(declaration.name, expected)
      )
    ) {
      return true;
    }
    if (ts.isBlock(current)) {
      for (const statement of current.statements) {
        if (
          ts.isVariableStatement(statement) &&
          statement.declarationList.declarations.some((declaration) =>
            bindingNameContains(declaration.name, expected)
          )
        ) {
          return true;
        }
        if (
          (ts.isFunctionDeclaration(statement) ||
            ts.isClassDeclaration(statement) ||
            ts.isEnumDeclaration(statement)) &&
          statement.name?.text === expected
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

interface LexicalScope {
  readonly parent?: LexicalScope;
  readonly bindings: Map<string, ts.VariableDeclaration | 'shadow'>;
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isBindingElement(element) ? bindingNames(element.name) : []
  );
}

function browserAliasDeclarations(
  sourceFile: ts.SourceFile,
  globals: ReadonlySet<string>
): ts.VariableDeclaration[] {
  const sourceScope: LexicalScope = { bindings: new Map() };
  const declarationScopes = new Map<ts.VariableDeclaration, LexicalScope>();

  const declare = (
    scope: LexicalScope,
    name: ts.BindingName,
    binding: ts.VariableDeclaration | 'shadow'
  ): void => {
    for (const identifier of bindingNames(name)) {
      scope.bindings.set(identifier, binding);
    }
  };

  const collect = (node: ts.Node, parentScope: LexicalScope): void => {
    let scope = parentScope;
    if (node !== sourceFile && (ts.isBlock(node) || functionParameters(node))) {
      scope = { parent: parentScope, bindings: new Map() };
      for (const parameter of functionParameters(node) ?? []) {
        declare(scope, parameter.name, 'shadow');
      }
    }
    if (ts.isImportDeclaration(node) && node.importClause) {
      if (node.importClause.name) {
        sourceScope.bindings.set(node.importClause.name.text, 'shadow');
      }
      const imports = node.importClause.namedBindings;
      if (imports && ts.isNamespaceImport(imports)) {
        sourceScope.bindings.set(imports.name.text, 'shadow');
      } else if (imports && ts.isNamedImports(imports)) {
        for (const specifier of imports.elements) {
          sourceScope.bindings.set(specifier.name.text, 'shadow');
        }
      }
    }
    if (ts.isVariableDeclaration(node)) {
      declare(scope, node.name, node);
      declarationScopes.set(node, scope);
    }
    ts.forEachChild(node, (child) => collect(child, scope));
  };
  collect(sourceFile, sourceScope);

  const resolve = (
    scope: LexicalScope,
    name: string
  ): ts.VariableDeclaration | 'shadow' | undefined => {
    for (
      let current: LexicalScope | undefined = scope;
      current;
      current = current.parent
    ) {
      const binding = current.bindings.get(name);
      if (binding) return binding;
    }
    return undefined;
  };
  const memo = new Map<ts.VariableDeclaration, boolean>();
  const visiting = new Set<ts.VariableDeclaration>();
  const isBrowserAlias = (declaration: ts.VariableDeclaration): boolean => {
    const cached = memo.get(declaration);
    if (cached !== undefined) return cached;
    if (visiting.has(declaration)) return false;
    visiting.add(declaration);
    const initializer = declaration.initializer;
    const scope = declarationScopes.get(declaration);
    let result = false;
    if (initializer && scope && ts.isIdentifier(initializer)) {
      const binding = resolve(scope, initializer.text);
      result =
        (globals.has(initializer.text) && binding === undefined) ||
        (binding !== undefined &&
          binding !== 'shadow' &&
          isBrowserAlias(binding));
    }
    visiting.delete(declaration);
    memo.set(declaration, result);
    return result;
  };

  return [...declarationScopes.keys()].filter(isBrowserAlias);
}

function nodeContainsSensitiveName(
  node: ts.Node,
  isSensitive: (value: string) => boolean,
  skipFunctionBodies = false
): boolean {
  let sensitive = false;
  const visit = (child: ts.Node): void => {
    if (sensitive) return;
    if (ts.isIdentifier(child) && isSensitive(child.text)) sensitive = true;
    if (ts.isStringLiteralLike(child) && isSensitive(child.text)) {
      sensitive = true;
    }
    if (
      skipFunctionBodies &&
      (ts.isArrowFunction(child) ||
        ts.isFunctionExpression(child) ||
        ts.isFunctionDeclaration(child))
    ) {
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return sensitive;
}

function isDeclarationIdentifier(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  return (
    ((ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent)) &&
      parent.name === identifier) ||
    (ts.isBindingElement(parent) &&
      (parent.name === identifier || parent.propertyName === identifier)) ||
    (ts.isPropertyAssignment(parent) && parent.name === identifier) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === identifier) ||
    (ts.isImportSpecifier(parent) &&
      (parent.name === identifier || parent.propertyName === identifier))
  );
}

function isTypeOnlyIdentifierReference(identifier: ts.Identifier): boolean {
  for (
    let current: ts.Node | undefined = identifier.parent;
    current && !ts.isStatement(current);
    current = current.parent
  ) {
    if (ts.isTypeNode(current)) return true;
  }
  return false;
}

function directReturnedObject(
  factory: ts.ArrowFunction | ts.FunctionExpression
): ts.ObjectLiteralExpression | undefined {
  if (ts.isObjectLiteralExpression(factory.body)) return factory.body;
  if (!ts.isBlock(factory.body)) return undefined;
  const returns = factory.body.statements.filter(ts.isReturnStatement);
  return returns.length === 1 &&
    returns[0].expression &&
    ts.isObjectLiteralExpression(returns[0].expression)
    ? returns[0].expression
    : undefined;
}

function directReturnedExpression(
  factory: ts.ArrowFunction | ts.FunctionExpression
): ts.Expression | undefined {
  if (!ts.isBlock(factory.body)) return factory.body;
  const returns = factory.body.statements.filter(ts.isReturnStatement);
  return returns.length === 1 ? returns[0].expression : undefined;
}

/**
 * `sanctionedObjects` are the object literals that may read the connection as
 * an explicit `name: connection.name` member: the options handed to the
 * backend's session or directory factory, or the value an Angular provider's
 * factory returns. A read anywhere else is treated as a write, because the
 * audit cannot follow where the value goes.
 */
function connectionFactoryMetadata(
  factory: ts.ArrowFunction | ts.FunctionExpression,
  sourceFile: ts.SourceFile,
  expectedAdapter: CompatibleRuntimeAdapter,
  sanctionedObjects?: ReadonlySet<ts.Node>
): Pick<
  AngularProviderRecord,
  | 'connectionDeclaration'
  | 'connectionCallCount'
  | 'connectionWrites'
  | 'canonicalFactory'
  | 'returnExpression'
  | 'returnedProperties'
> {
  const connectionDeclarations: ts.VariableDeclaration[] = [];
  if (ts.isBlock(factory.body)) {
    for (const statement of factory.body.statements) {
      if (
        !ts.isVariableStatement(statement) ||
        !(statement.declarationList.flags & ts.NodeFlags.Const) ||
        statement.declarationList.declarations.length !== 1
      ) {
        continue;
      }
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === 'connection' &&
          declaration.initializer &&
          ts.isCallExpression(declaration.initializer) &&
          ts.isIdentifier(declaration.initializer.expression) &&
          declaration.initializer.expression.text ===
            'injectCockpitRuntimeConnection' &&
          declaration.initializer.arguments.length === 0
        ) {
          connectionDeclarations.push(declaration);
        }
      }
    }
  }
  let connectionCallCount = 0;
  let connectionWrites = false;
  let returnCount = 0;
  walk(factory.body, (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'injectCockpitRuntimeConnection'
    ) {
      connectionCallCount++;
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      expressionRootIdentifier(node.left)?.text === 'connection'
    ) {
      connectionWrites = true;
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      expressionRootIdentifier(node.operand)?.text === 'connection'
    ) {
      connectionWrites = true;
    }
    if (
      ts.isDeleteExpression(node) &&
      expressionRootIdentifier(node.expression)?.text === 'connection'
    ) {
      connectionWrites = true;
    }
  });
  // Only the factory's own returns: a nested function returns for itself.
  const countOwnReturns = (node: ts.Node): void => {
    if (ts.isReturnStatement(node)) returnCount++;
    ts.forEachChild(node, (child) => {
      if (!functionParameters(child)) countOwnReturns(child);
    });
  };
  countOwnReturns(factory.body);
  const returned = directReturnedExpression(factory);
  const returnedProperties: Record<string, string> = {};
  if (returned && ts.isObjectLiteralExpression(returned)) {
    for (const property of returned.properties) {
      if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)) {
        returnedProperties[property.name.text] =
          property.initializer.getText(sourceFile);
      }
    }
  }
  const statements = ts.isBlock(factory.body) ? factory.body.statements : [];
  const declarationStatement = statements[0];
  const guardStatement = statements[1];
  const returnStatement = statements[2];
  const canonicalDeclaration =
    !!declarationStatement &&
    ts.isVariableStatement(declarationStatement) &&
    !!(declarationStatement.declarationList.flags & ts.NodeFlags.Const) &&
    declarationStatement.declarationList.declarations.length === 1 &&
    connectionDeclarations.length === 1 &&
    declarationStatement.declarationList.declarations[0] ===
      connectionDeclarations[0];
  const canonicalGuard = (() => {
    if (
      !guardStatement ||
      !ts.isIfStatement(guardStatement) ||
      guardStatement.elseStatement ||
      !ts.isBinaryExpression(guardStatement.expression) ||
      guardStatement.expression.operatorToken.kind !==
        ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      !ts.isPropertyAccessExpression(guardStatement.expression.left) ||
      !ts.isIdentifier(guardStatement.expression.left.expression) ||
      guardStatement.expression.left.expression.text !== 'connection' ||
      guardStatement.expression.left.name.text !== 'adapter' ||
      !ts.isStringLiteralLike(guardStatement.expression.right) ||
      guardStatement.expression.right.text !== expectedAdapter ||
      !ts.isBlock(guardStatement.thenStatement) ||
      guardStatement.thenStatement.statements.length !== 1
    ) {
      return false;
    }
    const thrown = guardStatement.thenStatement.statements[0];
    return (
      ts.isThrowStatement(thrown) &&
      !!thrown.expression &&
      ts.isNewExpression(thrown.expression) &&
      ts.isIdentifier(thrown.expression.expression) &&
      thrown.expression.expression.text === 'Error' &&
      thrown.expression.arguments?.length === 1 &&
      ts.isStringLiteralLike(thrown.expression.arguments[0]) &&
      thrown.expression.arguments[0].text === 'incompatible runtime'
    );
  })();
  const canonicalReturn =
    !!returnStatement &&
    ts.isReturnStatement(returnStatement) &&
    !!returnStatement.expression &&
    returnStatement.expression === returned &&
    returnCount === 1;

  walk(factory.body, (node) => {
    if (!ts.isIdentifier(node) || node.text !== 'connection') return;
    const parent = node.parent;
    const isDeclaration =
      ts.isVariableDeclaration(parent) && parent.name === node;
    const access =
      ts.isPropertyAccessExpression(parent) && parent.expression === node
        ? parent
        : undefined;
    const isGuardAccess =
      !!access &&
      access.name.text === 'adapter' &&
      !!guardStatement &&
      ts.isIfStatement(guardStatement) &&
      ts.isBinaryExpression(guardStatement.expression) &&
      guardStatement.expression.left === access;
    let isDirectReturnAccess = false;
    if (access && returnStatement && ts.isReturnStatement(returnStatement)) {
      if (returnStatement.expression === access) {
        isDirectReturnAccess = access.name.text === 'clientOptions';
      } else if (
        ts.isPropertyAssignment(access.parent) &&
        access.parent.initializer === access &&
        (sanctionedObjects
          ? sanctionedObjects.has(access.parent.parent)
          : access.parent.parent === returnStatement.expression) &&
        ts.isIdentifier(access.parent.name) &&
        access.parent.name.text === access.name.text &&
        (access.name.text === 'url' ||
          access.name.text === 'apiUrl' ||
          access.name.text === 'assistantId' ||
          access.name.text === 'clientOptions')
      ) {
        isDirectReturnAccess = true;
      }
    }
    if (!isDeclaration && !isGuardAccess && !isDirectReturnAccess) {
      connectionWrites = true;
    }
  });
  const canonicalFactory =
    ts.isArrowFunction(factory) &&
    factory.parameters.length === 0 &&
    statements.length === 3 &&
    canonicalDeclaration &&
    canonicalGuard &&
    canonicalReturn &&
    connectionCallCount === 1 &&
    !connectionWrites;
  return {
    ...(connectionDeclarations.length === 1
      ? {
          connectionDeclaration: `const ${connectionDeclarations[0].getText(
            sourceFile
          )}`,
        }
      : {}),
    connectionCallCount,
    connectionWrites,
    canonicalFactory,
    ...(returned ? { returnExpression: returned.getText(sourceFile) } : {}),
    returnedProperties,
  };
}

function providerAdapter(
  moduleName: string
): CompatibleRuntimeAdapter | undefined {
  if (moduleName === '@threadplane/ag-ui') return 'ag-ui';
  if (moduleName === '@threadplane/langgraph') return 'langgraph';
  return undefined;
}

function directUniqueProperties(
  object: ts.ObjectLiteralExpression
): Map<string, ts.PropertyAssignment> | undefined {
  const properties = new Map<string, ts.PropertyAssignment>();
  for (const property of object.properties) {
    if (
      !ts.isPropertyAssignment(property) ||
      !ts.isIdentifier(property.name) ||
      properties.has(property.name.text)
    ) {
      return undefined;
    }
    properties.set(property.name.text, property);
  }
  return properties;
}

function agSharedUrlGlobalIdentifiers(
  expression: ts.Expression
): { url: ts.Identifier; document: ts.Identifier } | undefined {
  if (
    !ts.isPropertyAccessExpression(expression) ||
    expression.name.text !== 'pathname' ||
    !ts.isNewExpression(expression.expression)
  ) {
    return undefined;
  }
  const urlCall = expression.expression;
  if (
    !ts.isIdentifier(urlCall.expression) ||
    urlCall.expression.text !== 'URL' ||
    urlCall.arguments?.length !== 2 ||
    !ts.isStringLiteralLike(urlCall.arguments[0]) ||
    urlCall.arguments[0].text !== 'agent'
  ) {
    return undefined;
  }
  const baseUri = urlCall.arguments[1];
  if (
    !ts.isPropertyAccessExpression(baseUri) ||
    baseUri.name.text !== 'baseURI' ||
    !ts.isIdentifier(baseUri.expression) ||
    baseUri.expression.text !== 'document'
  ) {
    return undefined;
  }
  return { url: urlCall.expression, document: baseUri.expression };
}

function hasRedactedCatch(call: ts.CallExpression): boolean {
  const catchAccess = call.parent;
  if (
    !ts.isPropertyAccessExpression(catchAccess) ||
    catchAccess.expression !== call ||
    catchAccess.name.text !== 'catch'
  ) {
    return false;
  }
  const catchCall = catchAccess.parent;
  if (
    !ts.isCallExpression(catchCall) ||
    catchCall.expression !== catchAccess ||
    catchCall.arguments.length !== 1
  ) {
    return false;
  }
  const handler = catchCall.arguments[0];
  return (
    ts.isArrowFunction(handler) &&
    ts.isIdentifier(handler.body) &&
    handler.body.text === 'undefined'
  );
}

function hasCanonicalTopLevelBootstrapOwner(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile
): boolean {
  if (!hasRedactedCatch(call)) return false;
  const catchAccess = call.parent;
  if (!ts.isPropertyAccessExpression(catchAccess)) return false;
  const catchCall = catchAccess.parent;
  if (!ts.isCallExpression(catchCall)) return false;
  const voidExpression = catchCall.parent;
  return (
    ts.isVoidExpression(voidExpression) &&
    voidExpression.expression === catchCall &&
    ts.isExpressionStatement(voidExpression.parent) &&
    voidExpression.parent.expression === voidExpression &&
    voidExpression.parent.parent === sourceFile
  );
}

// This is an ordered AST grammar for the one capability that intentionally
// persists a non-secret Memory identity. It is not a generic storage exemption.
function sameSyntax(actual: ts.Node, expected: string): boolean {
  const parsed = ts.createSourceFile(
    'grammar.ts',
    expected,
    ts.ScriptTarget.Latest,
    true
  );
  const shape = (node: ts.Node): unknown => {
    const children: unknown[] = [];
    ts.forEachChild(node, (child) => {
      children.push(shape(child));
    });
    return [node.kind, children.length ? children : node.getText().trim()];
  };
  return (
    JSON.stringify(shape(actual)) ===
    JSON.stringify(shape(parsed.statements[0]))
  );
}

const memoryFactoryGrammar = `const factory = () => {
  const connection = injectCockpitRuntimeConnection();
  if (connection.adapter !== 'langgraph') { throw new Error('incompatible runtime'); }
  const scope = inject(MemoryScope);
  const clientOptions = { ...connection.clientOptions, maxRetries: 0 };
  return {
    createSession: async (context) =>
      createSession({
        assistantId: connection.assistantId,
        threadId: context.threadId,
        onThreadId: context.onThreadId,
        developmentRuntime: context.developmentRuntime,
        transport: new MemoryTransport(connection.apiUrl, scope, undefined,
          clientOptions, context.reportOperationFailure),
      }),
  };
};`;

function matchesMemoryFactory(factory: ts.Node): boolean {
  const parsed = ts.createSourceFile(
    'grammar.ts',
    memoryFactoryGrammar,
    ts.ScriptTarget.Latest,
    true
  );
  const expected = (parsed.statements[0] as ts.VariableStatement)
    .declarationList.declarations[0].initializer!;
  // Compare semantic AST children, including order, operators, literals and types.
  const signature = (node: ts.Node): unknown => {
    const children: unknown[] = [];
    ts.forEachChild(node, (child) => {
      children.push(signature(child));
    });
    return [node.kind, children.length ? children : node.getText().trim()];
  };
  return (
    JSON.stringify(signature(factory)) === JSON.stringify(signature(expected))
  );
}

function memoryScopeStorageAccess(
  sourceFile: ts.SourceFile
): ts.Node | undefined {
  const controllers = sourceFile.statements.filter(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === 'createBrowserScope'
  );
  if (controllers.length !== 1 || !controllers[0].body) return undefined;
  const controllerBody = controllers[0].body;
  let storageAccess: ts.Node | undefined;
  let key = false,
    options = false,
    events = false,
    blocking = false,
    registration = false,
    admission = false,
    invalid = false,
    reads = 0,
    writes = 0;
  const initialization = controllerBody.statements.filter(ts.isTryStatement);
  registration =
    initialization.length === 1 &&
    initialization[0].tryBlock.statements.some((statement) =>
      sameSyntax(
        statement,
        `if (options.events) {
    options.events.addEventListener('storage', onStorage);
    listening = true;
  }`
      )
    );
  walk(sourceFile, (node) => {
    if (
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (d) => ts.isIdentifier(d.name) && d.name.text === 'SCOPE_KEY'
      ) &&
      node.parent === sourceFile
    ) {
      key = sameSyntax(
        node,
        "export const SCOPE_KEY = 'threadplane.deep-agents-memory.scope.v1';"
      );
    }
    if (
      ts.isVariableStatement(node) &&
      node.parent === controllerBody &&
      node.declarationList.declarations.some(
        (declaration) =>
          ts.isIdentifier(declaration.name) && declaration.name.text === 'block'
      )
    ) {
      blocking = sameSyntax(
        node,
        `const block = () => {
        if (snapshot.status === 'blocked') return;
        snapshot = Object.freeze({ status: 'blocked', scope, warning:
          'Browser memory identity changed or storage is unavailable. Active work keeps its original scope. Reload before sending again.' });
        for (const listener of [...listeners]) listener();
      };`
      );
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'onStorage' &&
      node.parent.parent.parent === controllerBody
    ) {
      events = sameSyntax(
        node.parent.parent,
        `const onStorage = (event: ScopeEvent) => {
        if (disposed || (event.storageArea !== null && event.storageArea !== storage) || (event.key !== null && event.key !== SCOPE_KEY)) return;
        if (event.key === null || event.newValue !== scope) block();
      };`
      );
    }
    if (ts.isMethodDeclaration(node) && node.name.getText() === 'admit') {
      const grammar = ts.createSourceFile(
        'admission.ts',
        `const controller = { admit() {
        if (disposed || snapshot.status !== 'ready') return undefined;
        try { if (storage?.getItem(SCOPE_KEY) !== scope) block(); } catch { block(); }
        return snapshot.status === 'ready' ? Object.freeze({ memory_scope: scope! }) : undefined;
      } };`,
        ts.ScriptTarget.Latest,
        true
      );
      const method = (
        (grammar.statements[0] as ts.VariableStatement).declarationList
          .declarations[0].initializer as ts.ObjectLiteralExpression
      ).properties[0];
      // The wrapper's forwarding method is distinct from the controller admission.
      if (
        node.body &&
        ts.isObjectLiteralExpression(node.parent) &&
        ts.isCallExpression(node.parent.parent) &&
        node.parent.parent.expression.getText() === 'Object.freeze' &&
        ts.isReturnStatement(node.parent.parent.parent) &&
        node.parent.parent.parent.parent === controllerBody
      )
        admission = sameSyntax(
          node.body,
          (method as ts.MethodDeclaration).body!.getText()
        );
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'MEMORY_SCOPE_OPTIONS'
    ) {
      options =
        !!node.initializer &&
        sameSyntax(
          node.parent.parent,
          `export const MEMORY_SCOPE_OPTIONS = new InjectionToken<ScopeOptions>('MEMORY_SCOPE_OPTIONS', {
        providedIn: 'root', factory: () => ({storage: () => window.localStorage, uuid: () => window.crypto.randomUUID(), events: window})
      });`
        );
      if (options)
        walk(node, (child) => {
          if (
            ts.isPropertyAccessExpression(child) &&
            child.getText() === 'window.localStorage'
          )
            storageAccess = child;
        });
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ['getItem', 'setItem'].includes(node.expression.name.text)
    ) {
      const method = node.expression.name.text;
      if (
        node.arguments[0]?.getText() !== 'SCOPE_KEY' ||
        node.expression.expression.getText() !== 'storage'
      )
        invalid = true;
      if (method === 'getItem') reads++;
      else writes++;
    }
  });
  return key &&
    options &&
    events &&
    blocking &&
    registration &&
    admission &&
    !invalid &&
    reads === 3 &&
    writes === 1
    ? storageAccess
    : undefined;
}

/** Looks through parentheses, casts and a trailing `?? undefined`. */
function unwrapValue(expression: ts.Expression): ts.Expression {
  let current = expression;
  for (;;) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isNonNullExpression(current)
    ) {
      current = current.expression;
    } else if (
      ts.isBinaryExpression(current) &&
      current.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
      ts.isIdentifier(current.right) &&
      current.right.text === 'undefined'
    ) {
      current = current.left;
    } else {
      return current;
    }
  }
}

interface SessionFactoryShape {
  readonly arrow: ts.ArrowFunction;
  readonly call: ts.CallExpression;
  readonly callee: ts.Identifier;
  readonly options: ts.ObjectLiteralExpression;
  /** `(context) => ...`: the parameter's name. */
  readonly contextName?: string;
  /** `({ threadId, onThreadId: report }) => ...`: local name to context key. */
  readonly contextBindings?: ReadonlyMap<string, string>;
}

/**
 * Matches `(context) => factory({ ... })`, the only form in which a session
 * or directory factory receives the provider context. Returns a reason when
 * the member is something else.
 */
function sessionFactoryShape(
  initializer: ts.Expression,
  factoryName: string
): SessionFactoryShape | string {
  if (!ts.isArrowFunction(initializer)) {
    return `must be an inline arrow function that calls ${factoryName}`;
  }
  if (initializer.parameters.length !== 1) {
    return 'must take exactly the provider context parameter';
  }
  const parameter = initializer.parameters[0];
  if (parameter.initializer || parameter.dotDotDotToken) {
    return 'context parameter may not have a default or be a rest parameter';
  }
  let contextName: string | undefined;
  let contextBindings: Map<string, string> | undefined;
  if (ts.isIdentifier(parameter.name)) {
    contextName = parameter.name.text;
  } else if (ts.isObjectBindingPattern(parameter.name)) {
    contextBindings = new Map();
    for (const element of parameter.name.elements) {
      const key = element.propertyName ?? element.name;
      if (
        element.dotDotDotToken ||
        element.initializer ||
        !ts.isIdentifier(element.name) ||
        !ts.isIdentifier(key)
      ) {
        return 'context parameter may only destructure plain members';
      }
      contextBindings.set(element.name.text, key.text);
    }
  } else {
    return 'context parameter must be an identifier or a plain destructuring';
  }
  let body: ts.Expression | undefined;
  if (ts.isBlock(initializer.body)) {
    const statements = initializer.body.statements;
    if (statements.length === 1 && ts.isReturnStatement(statements[0])) {
      body = statements[0].expression;
    }
  } else {
    body = initializer.body;
  }
  while (body && ts.isParenthesizedExpression(body)) body = body.expression;
  if (
    !body ||
    !ts.isCallExpression(body) ||
    !ts.isIdentifier(body.expression) ||
    body.expression.text !== factoryName
  ) {
    return `must return a direct ${factoryName}(...) call and nothing else`;
  }
  if (
    body.arguments.length !== 1 ||
    !ts.isObjectLiteralExpression(body.arguments[0])
  ) {
    return `${factoryName} must be given one inline options object`;
  }
  return {
    arrow: initializer,
    call: body,
    callee: body.expression,
    options: body.arguments[0],
    ...(contextName ? { contextName } : {}),
    ...(contextBindings ? { contextBindings } : {}),
  };
}

/** The provider context key an option value reads, if it reads exactly one. */
function contextKeyOf(
  shape: SessionFactoryShape,
  value: ts.Expression
): string | undefined {
  const inner = unwrapValue(value);
  if (
    shape.contextName &&
    ts.isPropertyAccessExpression(inner) &&
    ts.isIdentifier(inner.expression) &&
    inner.expression.text === shape.contextName
  ) {
    return inner.name.text;
  }
  if (shape.contextBindings && ts.isIdentifier(inner)) {
    return shape.contextBindings.get(inner.text);
  }
  return undefined;
}

interface SessionOptionProblem {
  readonly kind: RuntimeWiringAuditKind;
  readonly detail: string;
}

interface SessionOptionMembers {
  /** Option name to its value; a shorthand member is its own value. */
  readonly values: ReadonlyMap<string, ts.Expression>;
  readonly text: Readonly<Record<string, string>>;
  readonly problems: readonly SessionOptionProblem[];
}

/**
 * Reads an options object member by member. Spreads, computed names, methods
 * and duplicates are problems: each can replace a value the audit checked.
 */
function sessionOptionMembers(
  shape: SessionFactoryShape,
  sourceFile: ts.SourceFile,
  factoryName: string
): SessionOptionMembers {
  const values = new Map<string, ts.Expression>();
  const text: Record<string, string> = {};
  const problems: SessionOptionProblem[] = [];
  for (const property of shape.options.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spread = unwrapValue(property.expression);
      if (
        shape.contextName &&
        ts.isIdentifier(spread) &&
        spread.text === shape.contextName
      ) {
        problems.push({
          kind: 'session-context-wiring',
          detail: `${factoryName} options may not spread the provider context: the factory takes its own option names, and members it does not accept are dropped without an error`,
        });
      } else {
        problems.push({
          kind: 'session-connection-wiring',
          detail: `${factoryName} options may not contain spreads`,
        });
      }
      continue;
    }
    let name: string | undefined;
    let value: ts.Expression | undefined;
    if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)) {
      name = property.name.text;
      value = property.initializer;
    } else if (ts.isShorthandPropertyAssignment(property)) {
      name = property.name.text;
      value = property.name;
    }
    if (!name || !value) {
      problems.push({
        kind: 'session-connection-wiring',
        detail: `${factoryName} options forbid computed, method, and accessor members`,
      });
      continue;
    }
    if (values.has(name)) {
      problems.push({
        kind: 'session-connection-wiring',
        detail: `${factoryName} option ${name} is given more than once`,
      });
      continue;
    }
    values.set(name, value);
    text[name] = value.getText(sourceFile);
  }
  return { values, text, problems };
}

/**
 * Every read of the provider context must be the whole value of one option.
 * Anything else (the context handed to a helper, copied, or read inside an
 * expression) leaves the audit unable to say which option it reached.
 */
function strayContextReads(
  shape: SessionFactoryShape,
  sourceFile: ts.SourceFile
): string[] {
  const names = shape.contextName
    ? new Set([shape.contextName])
    : new Set(shape.contextBindings?.keys() ?? []);
  const stray: string[] = [];
  walk(shape.arrow.body, (node) => {
    if (!ts.isIdentifier(node) || !names.has(node.text)) return;
    if (
      ts.isShorthandPropertyAssignment(node.parent) &&
      node.parent.parent === shape.options
    ) {
      if (shape.contextName) stray.push(node.text);
      return;
    }
    if (isDeclarationIdentifier(node)) return;
    let value: ts.Expression = node;
    if (shape.contextName) {
      if (
        !ts.isPropertyAccessExpression(node.parent) ||
        node.parent.expression !== node
      ) {
        // The spread is reported with its own, more useful message.
        if (
          !ts.isSpreadAssignment(node.parent) ||
          node.parent.parent !== shape.options
        ) {
          stray.push(node.text);
        }
        return;
      }
      value = node.parent;
    }
    let held: ts.Node = value;
    let holder: ts.Node = value.parent;
    while (
      ts.isParenthesizedExpression(holder) ||
      ts.isAsExpression(holder) ||
      ts.isSatisfiesExpression(holder) ||
      ts.isNonNullExpression(holder) ||
      (ts.isBinaryExpression(holder) &&
        holder.left === held &&
        holder.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
        ts.isIdentifier(holder.right) &&
        holder.right.text === 'undefined')
    ) {
      held = holder;
      holder = holder.parent;
    }
    if (
      !ts.isPropertyAssignment(holder) ||
      holder.initializer !== held ||
      holder.parent !== shape.options
    ) {
      stray.push(value.getText(sourceFile));
    }
  });
  return stray;
}

export function inspectRuntimeTargetSource(
  source: string,
  fileName: string,
  expectedAdapter?: CompatibleRuntimeAdapter,
  project?: string,
  options: RuntimeWiringAuditOptions = {}
): RuntimeTargetSourceInspection {
  const reporterOptionNames =
    options.reporterOptionNames ?? defaultReporterOptionNames;
  // Every name any backend takes the reporter under, plus the context's own.
  const directoryReporterOptionNames =
    options.directoryReporterOptionNames ??
    defaultDirectoryReporterOptionNames;
  const deprecatedReporterOptionNames =
    options.deprecatedReporterOptionNames ??
    (options.reporterOptionNames
      ? { langgraph: [], 'ag-ui': [] }
      : defaultDeprecatedReporterOptionNames);
  const reporterShapedNames = new Set([
    contextReporterKey,
    ...Object.values(reporterOptionNames).flat(),
    ...Object.values(deprecatedReporterOptionNames).flat(),
    ...directoryReporterOptionNames,
  ]);
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const memoryOwner = project === 'cockpit-deep-agents-memory-angular';
  let memoryStorageAccess: ts.Node | undefined;
  const issues: RuntimeWiringAuditIssue[] = [];
  const providerCalls: CanonicalProviderCall[] = [];
  const bootstrapCalls: BootstrapCallRecord[] = [];
  const angularProviders: AngularProviderRecord[] = [];
  const threadDirectoryProviders: ThreadDirectoryProviderRecord[] = [];
  // Calls and references the wiring rules have checked and accepted. Any
  // other use of the same imported name is reported after the walk.
  const sanctionedFactoryCalls = new Set<ts.CallExpression>();
  const sanctionedTokenReferences = new Set<ts.Identifier>();
  let canonicalClientOptionsProvider = false;
  const importBindingsByLocalName = new Map<
    string,
    Array<{
      readonly moduleName: string;
      readonly importedName: string;
      readonly directUnaliased: boolean;
    }>
  >();
  let canonicalConnectionImport = false;
  let canonicalComponentImportCount = 0;
  let canonicalAppConfigImportCount = 0;
  let canonicalHarnessImportCount = 0;
  let harnessSymbolImportCount = 0;
  const directConstructorNames = new Set<string>();
  const directFactoryNames = new Set<string>();
  const agentNamespaces = new Set<string>();
  const directBrowserGlobals = new Set([
    'window',
    'document',
    'globalThis',
    'self',
  ]);
  const taintedLogNames = new Set<string>();
  const isEntrypoint = /(?:^|\/)main(?:\.cockpit)?\.ts$/.test(fileName);

  const report = (kind: RuntimeWiringAuditKind, detail: string): void => {
    if (
      !issues.some((issue) => issue.kind === kind && issue.detail === detail)
    ) {
      issues.push({ kind, detail });
    }
  };

  const recordImportBinding = (
    localName: string,
    moduleName: string,
    importedName: string,
    directUnaliased: boolean
  ): void => {
    const bindings = importBindingsByLocalName.get(localName) ?? [];
    bindings.push({ moduleName, importedName, directUnaliased });
    importBindingsByLocalName.set(localName, bindings);
  };

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    const moduleName = ts.isStringLiteralLike(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : '';
    if (
      !isEntrypoint &&
      /(?:^|\/|\.)environments?(?:\/|\.|$)/i.test(moduleName)
    ) {
      report(
        'environment-config-outside-entrypoint',
        `environment import ${moduleName}`
      );
    }
    const bindings = statement.importClause.namedBindings;
    if (statement.importClause.name) {
      recordImportBinding(
        statement.importClause.name.text,
        moduleName,
        'default',
        true
      );
    }
    if (bindings && ts.isNamespaceImport(bindings)) {
      recordImportBinding(bindings.name.text, moduleName, '*', false);
    }
    if (statement.importClause.name && agentModule.test(moduleName)) {
      directConstructorNames.add(statement.importClause.name.text);
    }
    if (
      bindings &&
      ts.isNamespaceImport(bindings) &&
      agentModule.test(moduleName)
    ) {
      agentNamespaces.add(bindings.name.text);
    }
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const specifier of bindings.elements) {
      const importedName = (specifier.propertyName ?? specifier.name).text;
      const localName = specifier.name.text;
      recordImportBinding(
        localName,
        moduleName,
        importedName,
        !specifier.propertyName && localName === importedName
      );
      if (
        importedName === 'provideAgent' ||
        importedName === 'provideThreadDirectory'
      ) {
        if (moduleName !== agentProviderModule) {
          report(
            'noncanonical-provider-wiring',
            `${importedName} must be imported from ${agentProviderModule}, not ${moduleName}`
          );
        } else if (specifier.propertyName || localName !== importedName) {
          report(
            'noncanonical-provider-wiring',
            `${importedName} must use its direct named import from ${moduleName}`
          );
        }
      }
      if (
        sessionFactoryNames.has(importedName) &&
        providerAdapter(moduleName) &&
        (specifier.propertyName || localName !== importedName)
      ) {
        report(
          'noncanonical-provider-wiring',
          `${importedName} must use its direct named import from ${moduleName}`
        );
      }
      if (
        importedName === 'injectCockpitRuntimeConnection' &&
        moduleName === '@threadplane/cockpit-telemetry'
      ) {
        if (specifier.propertyName || localName !== importedName) {
          report(
            'noncanonical-provider-wiring',
            'injectCockpitRuntimeConnection must use its direct named import'
          );
        } else {
          canonicalConnectionImport = true;
        }
      }
      if (
        moduleName === '@angular/core' &&
        importedName === 'Component' &&
        !specifier.propertyName &&
        localName === 'Component'
      ) {
        canonicalComponentImportCount++;
      }
      if (
        isEntrypoint &&
        moduleName === './app/app.config' &&
        importedName === 'appConfig' &&
        !specifier.propertyName &&
        localName === 'appConfig'
      ) {
        canonicalAppConfigImportCount++;
      }
      if (
        isEntrypoint &&
        moduleName === '@threadplane/cockpit-telemetry' &&
        importedName === 'bootstrapWithCockpitHarness'
      ) {
        harnessSymbolImportCount++;
        if (!specifier.propertyName && localName === importedName) {
          canonicalHarnessImportCount++;
        }
      }
      if (agentModule.test(moduleName)) {
        if (
          /^(?:Agent|Client|HttpAgent|LangGraphClient|FetchStreamTransport)$/.test(
            importedName
          )
        ) {
          directConstructorNames.add(localName);
        }
        if (
          /^(?:createAgent|createLangGraphClient|createClient)$/.test(
            importedName
          )
        ) {
          directFactoryNames.add(localName);
        }
      }
      // The agent and the directory view are built by their providers. Built
      // by hand they sit outside the registration the audit pins.
      if (
        moduleName === agentProviderModule &&
        /^(?:createAgent|createThreadDirectoryView)$/.test(importedName)
      ) {
        directFactoryNames.add(localName);
      }
      if (
        !/(?:^|\/|\.)environments?(?:\/|\.|$)/i.test(moduleName) &&
        !(
          moduleName === '@threadplane/cockpit-telemetry' &&
          importedName === 'injectCockpitRuntimeConnection'
        ) &&
        (isSensitiveRuntimeName(importedName) ||
          isSensitiveRuntimeName(localName))
      ) {
        report(
          'imported-runtime-secret',
          `sensitive import ${importedName} from ${moduleName}`
        );
      }
    }
  }

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const semanticNodes: ts.Node[] = [declaration.name];
      if (declaration.type) semanticNodes.push(declaration.type);
      if (declaration.initializer) semanticNodes.push(declaration.initializer);
      if (
        semanticNodes.some((node) =>
          nodeContainsSensitiveName(node, isSensitiveRuntimeName, true)
        )
      ) {
        report(
          'module-global-runtime-cache',
          `module-global ${declaration.name.getText(
            sourceFile
          )} has runtime-shaped name, type, or value`
        );
      }
    }
  }

  for (const declaration of browserAliasDeclarations(
    sourceFile,
    directBrowserGlobals
  )) {
    report(
      'browser-state-read',
      `browser alias ${declaration.name.getText(sourceFile)}`
    );
  }

  const writtenRuntimeBindings = new Set<string>();
  walk(sourceFile, (node) => {
    let target: ts.Expression | undefined;
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      target = node.left;
    } else if (
      ts.isPrefixUnaryExpression(node) ||
      ts.isPostfixUnaryExpression(node)
    ) {
      target = node.operand;
    } else if (ts.isDeleteExpression(node)) {
      target = node.expression;
    }
    const targetRoot = target ? expressionRootIdentifier(target) : undefined;
    if (targetRoot) {
      writtenRuntimeBindings.add(targetRoot.text);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ((node.expression.expression.getText(sourceFile) === 'Object' &&
        node.expression.name.text === 'assign') ||
        (node.expression.expression.getText(sourceFile) === 'Reflect' &&
          node.expression.name.text === 'set'))
    ) {
      const firstRoot = node.arguments[0]
        ? expressionRootIdentifier(node.arguments[0])
        : undefined;
      if (firstRoot) {
        writtenRuntimeBindings.add(firstRoot.text);
      }
    }
  });
  const topLevelLocalBindingCount = (name: string): number =>
    sourceFile.statements.reduce((count, statement) => {
      if (ts.isVariableStatement(statement)) {
        return (
          count +
          statement.declarationList.declarations.filter((declaration) =>
            bindingNameContains(declaration.name, name)
          ).length
        );
      }
      if (
        (ts.isFunctionDeclaration(statement) ||
          ts.isClassDeclaration(statement) ||
          ts.isEnumDeclaration(statement)) &&
        statement.name?.text === name
      ) {
        return count + 1;
      }
      return count;
    }, 0);
  const topLevelImportBindingCount = (name: string): number =>
    sourceFile.statements.reduce((count, statement) => {
      if (!ts.isImportDeclaration(statement) || !statement.importClause) {
        return count;
      }
      let additions = statement.importClause.name?.text === name ? 1 : 0;
      const bindings = statement.importClause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        additions += bindings.name.text === name ? 1 : 0;
      } else if (bindings && ts.isNamedImports(bindings)) {
        additions += bindings.elements.filter(
          (specifier) => specifier.name.text === name
        ).length;
      }
      return count + additions;
    }, 0);
  const exactBinding = (identifier: ts.Identifier): ExactImportBinding => {
    const imports = importBindingsByLocalName.get(identifier.text) ?? [];
    const imported = imports.length === 1 ? imports[0] : undefined;
    return {
      identifier: identifier.text,
      ...(imported
        ? {
            moduleName: imported.moduleName,
            importedName: imported.importedName,
          }
        : {}),
      canonical:
        !!imported &&
        imported.directUnaliased &&
        topLevelImportBindingCount(identifier.text) === 1 &&
        topLevelLocalBindingCount(identifier.text) === 0 &&
        !writtenRuntimeBindings.has(identifier.text) &&
        !isLocallyShadowed(identifier, identifier.text),
    };
  };
  const exactFactoryBinding = (
    factory: ts.ArrowFunction | ts.FunctionExpression,
    name: string
  ): ExactImportBinding | undefined => {
    const identifiers: ts.Identifier[] = [];
    walk(factory.body, (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === name
      ) {
        identifiers.push(node.expression);
      }
    });
    return identifiers.length === 1 ? exactBinding(identifiers[0]) : undefined;
  };
  const hasOnlyExecutableReferences = (
    expectedIdentifiers: readonly ts.Identifier[],
    name: string
  ): boolean => {
    const references: ts.Identifier[] = [];
    walk(sourceFile, (node) => {
      if (
        ts.isIdentifier(node) &&
        node.text === name &&
        !isDeclarationIdentifier(node) &&
        !isTypeOnlyIdentifierReference(node)
      ) {
        references.push(node);
      }
    });
    return (
      references.length === expectedIdentifiers.length &&
      expectedIdentifiers.every((identifier) => references.includes(identifier))
    );
  };
  const isSoleExecutableReference = (
    expectedIdentifier: ts.Identifier,
    name: string
  ): boolean => hasOnlyExecutableReferences([expectedIdentifier], name);
  const stableComponentBinding =
    canonicalComponentImportCount === 1 &&
    topLevelImportBindingCount('Component') === 1 &&
    topLevelLocalBindingCount('Component') === 0 &&
    !writtenRuntimeBindings.has('Component');

  const providerRegistrationOwners = new Map<
    ts.CallExpression,
    ProviderRegistrationOwner
  >();
  const appConfigProviderArrays: ts.ArrayLiteralExpression[] = [];
  const directProvidersArray = (
    object: ts.ObjectLiteralExpression,
    ownerLabel: string,
    required: boolean
  ): ts.ArrayLiteralExpression | undefined => {
    if (object.properties.some(ts.isSpreadAssignment)) {
      report(
        'noncanonical-provider-wiring',
        `${ownerLabel} object may not contain spreads`
      );
      return undefined;
    }
    const providersMembers = object.properties.filter(
      (property) =>
        (ts.isPropertyAssignment(property) ||
          ts.isShorthandPropertyAssignment(property) ||
          ts.isMethodDeclaration(property)) &&
        propertyNameText(property.name) === 'providers'
    );
    if (providersMembers.length === 0 && !required) return undefined;
    if (
      providersMembers.length !== 1 ||
      !ts.isPropertyAssignment(providersMembers[0]) ||
      !ts.isIdentifier(providersMembers[0].name) ||
      !ts.isArrayLiteralExpression(providersMembers[0].initializer)
    ) {
      report(
        'noncanonical-provider-wiring',
        `${ownerLabel} requires one explicit direct providers array`
      );
      return undefined;
    }
    const providers = providersMembers[0].initializer;
    if (providers.elements.some(ts.isSpreadElement)) {
      report(
        'noncanonical-provider-wiring',
        `${ownerLabel} providers array may not contain spreads`
      );
      return undefined;
    }
    return providers;
  };
  const registerDirectProviderCalls = (
    providers: ts.ArrayLiteralExpression,
    owner: ProviderRegistrationOwner
  ): void => {
    for (const element of providers.elements) {
      if (
        ts.isCallExpression(element) &&
        ts.isIdentifier(element.expression) &&
        (element.expression.text === 'provideAgent' ||
          element.expression.text === 'provideThreadDirectory')
      ) {
        providerRegistrationOwners.set(element, owner);
      }
    }
  };
  const appConfigDeclarations = sourceFile.statements.flatMap((statement) =>
    ts.isVariableStatement(statement)
      ? statement.declarationList.declarations.filter(
          (declaration) =>
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === 'appConfig'
        )
      : []
  );
  const appConfigDeclarationStatement =
    appConfigDeclarations.length === 1
      ? (appConfigDeclarations[0].parent.parent as ts.VariableStatement)
      : undefined;
  const appConfigDeclarationIndex = appConfigDeclarationStatement
    ? sourceFile.statements.indexOf(appConfigDeclarationStatement)
    : -1;
  let appConfigReferencedInInitializer = false;
  if (appConfigDeclarations[0]?.initializer) {
    walk(appConfigDeclarations[0].initializer, (node) => {
      if (
        ts.isIdentifier(node) &&
        node.text === 'appConfig' &&
        !isDeclarationIdentifier(node) &&
        !isTypeOnlyIdentifierReference(node)
      ) {
        appConfigReferencedInInitializer = true;
      }
    });
  }
  let appConfigReferencedAfterDeclaration = false;
  if (appConfigDeclarationIndex >= 0) {
    for (const statement of sourceFile.statements.slice(
      appConfigDeclarationIndex + 1
    )) {
      walk(statement, (node) => {
        if (
          ts.isIdentifier(node) &&
          node.text === 'appConfig' &&
          !isDeclarationIdentifier(node) &&
          !isTypeOnlyIdentifierReference(node)
        ) {
          appConfigReferencedAfterDeclaration = true;
        }
      });
    }
  }
  const stableAppConfigBinding =
    appConfigDeclarations.length === 1 &&
    topLevelLocalBindingCount('appConfig') === 1 &&
    topLevelImportBindingCount('appConfig') === 0 &&
    !writtenRuntimeBindings.has('appConfig') &&
    !appConfigReferencedInInitializer &&
    !appConfigReferencedAfterDeclaration;
  if (appConfigDeclarations.length > 0 && !stableAppConfigBinding) {
    report(
      'noncanonical-provider-wiring',
      'appConfig registration owner must have one stable top-level binding'
    );
  }
  for (const appConfig of appConfigDeclarations) {
    const statement = appConfig.parent.parent;
    const exported =
      ts.isVariableStatement(statement) &&
      (ts.getModifiers(statement) ?? []).some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
      ) &&
      !!(statement.declarationList.flags & ts.NodeFlags.Const) &&
      statement.declarationList.declarations.length === 1;
    if (!exported || !stableAppConfigBinding) {
      report(
        'noncanonical-provider-wiring',
        'appConfig registration owner must be one exported top-level const'
      );
      continue;
    }
    if (
      !appConfig.initializer ||
      !ts.isObjectLiteralExpression(appConfig.initializer)
    ) {
      report(
        'noncanonical-provider-wiring',
        'appConfig must be initialized with a direct object literal'
      );
      continue;
    }
    const providers = directProvidersArray(
      appConfig.initializer,
      'appConfig',
      true
    );
    if (!providers) continue;
    appConfigProviderArrays.push(providers);
    registerDirectProviderCalls(providers, { kind: 'appConfig' });
  }
  walk(sourceFile, (node) => {
    if (
      !ts.isClassDeclaration(node) ||
      !node.name ||
      node.parent !== sourceFile
    ) {
      return;
    }
    const decorators = ts.canHaveDecorators(node)
      ? ts.getDecorators(node) ?? []
      : [];
    for (const decorator of decorators) {
      if (
        !ts.isCallExpression(decorator.expression) ||
        !ts.isIdentifier(decorator.expression.expression) ||
        decorator.expression.expression.text !== 'Component'
      ) {
        continue;
      }
      if (!stableComponentBinding) {
        report(
          'noncanonical-provider-wiring',
          '@Component provider owner requires the stable direct Component import from @angular/core'
        );
        continue;
      }
      const metadata = decorator.expression.arguments[0];
      if (!metadata || !ts.isObjectLiteralExpression(metadata)) continue;
      const providers = directProvidersArray(
        metadata,
        `@Component ${node.name.text}`,
        false
      );
      if (providers) {
        registerDirectProviderCalls(providers, {
          kind: 'component',
          component: node.name.text,
        });
      }
    }
  });

  walk(sourceFile, (node) => {
    if (ts.isVariableDeclaration(node)) {
      const initializer = node.initializer;
      for (const name of protectedWiringNames) {
        const declares =
          bindingNameContains(node.name, name) ||
          bindingPropertyContains(node.name, name);
        const aliases =
          !!initializer &&
          ((ts.isIdentifier(initializer) && initializer.text === name) ||
            (ts.isPropertyAccessExpression(initializer) &&
              initializer.name.text === name) ||
            (ts.isElementAccessExpression(initializer) &&
              !!initializer.argumentExpression &&
              staticPropertyName(initializer.argumentExpression) === name));
        if (declares || aliases) {
          report(
            'noncanonical-provider-wiring',
            `${name} may not be destructured, reversed, or locally aliased`
          );
        }
      }
    }

    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      if (directConstructorNames.has(node.expression.text)) {
        report('direct-agent-construction', `new ${node.expression.text}`);
      }
    }
    if (
      ts.isNewExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      agentNamespaces.has(node.expression.expression.getText(sourceFile))
    ) {
      report(
        'direct-agent-construction',
        `new ${node.expression.getText(sourceFile)}`
      );
    }

    if (!ts.isCallExpression(node)) return;
    if (
      ts.isIdentifier(node.expression) &&
      directFactoryNames.has(node.expression.text)
    ) {
      report('direct-agent-construction', `call ${node.expression.text}`);
    }
    if (
      ts.isPropertyAccessExpression(node.expression) &&
      agentNamespaces.has(node.expression.expression.getText(sourceFile)) &&
      /(?:Agent|Client|Session|Directory|Transport)/.test(
        node.expression.name.text
      )
    ) {
      report(
        'direct-agent-construction',
        `call ${node.expression.getText(sourceFile)}`
      );
    }
    if (
      ts.isPropertyAccessExpression(node.expression) &&
      (node.expression.name.text === 'provideAgent' ||
        node.expression.name.text === 'provideThreadDirectory')
    ) {
      report(
        'noncanonical-provider-wiring',
        `${node.expression.name.text} must be called as its direct imported identifier`
      );
      return;
    }
    if (!ts.isIdentifier(node.expression)) return;
    if (node.expression.text === 'provideThreadDirectory') {
      auditThreadDirectoryProvider(node);
    } else if (node.expression.text === 'provideAgent') {
      auditAgentProvider(node);
    }
  });

  /** The connection injector every provider factory must read. */
  function requireConnectionInjector(
    factory: ts.ArrowFunction | ts.FunctionExpression
  ): void {
    if (!canonicalConnectionImport) {
      report(
        'noncanonical-provider-wiring',
        'provider source requires direct injectCockpitRuntimeConnection import'
      );
    }
    if (
      !hasExactImportBinding(
        exactFactoryBinding(factory, 'injectCockpitRuntimeConnection'),
        '@threadplane/cockpit-telemetry',
        'injectCockpitRuntimeConnection'
      )
    ) {
      report(
        'noncanonical-provider-wiring',
        'provider factory requires the stable telemetry connection injector import'
      );
    }
  }

  /**
   * Reads the config object a provider factory returns. Only plain, unique,
   * known members are allowed, so nothing can replace the audited one.
   */
  function configMembers(
    returned: ts.ObjectLiteralExpression,
    allowed: ReadonlySet<string>,
    label: string
  ): Map<string, ts.Expression> {
    const members = new Map<string, ts.Expression>();
    for (const property of returned.properties) {
      if (
        !ts.isPropertyAssignment(property) ||
        !ts.isIdentifier(property.name)
      ) {
        report(
          'noncanonical-provider-wiring',
          `${label} forbids spread, computed, method, and shorthand members`
        );
        continue;
      }
      const name = property.name.text;
      if (members.has(name)) {
        report(
          'noncanonical-provider-wiring',
          `${label} member ${name} is given more than once`
        );
        continue;
      }
      if (!allowed.has(name)) {
        report(
          'noncanonical-provider-wiring',
          `${label} member ${name} is not part of the audited wiring`
        );
      }
      members.set(name, property.initializer);
    }
    return members;
  }

  function auditAgentProvider(node: ts.CallExpression): void {
    const owner = providerRegistrationOwners.get(node);
    if (!owner) {
      report(
        'noncanonical-provider-wiring',
        'provideAgent must be a direct element of executable appConfig.providers or @Component.providers'
      );
    }
    const provideAgentBinding = exactBinding(node.expression as ts.Identifier);
    if (
      !hasExactImportBinding(
        provideAgentBinding,
        agentProviderModule,
        'provideAgent'
      )
    ) {
      report(
        'noncanonical-provider-wiring',
        `provideAgent requires its stable import from ${agentProviderModule}`
      );
    }
    const factory = node.arguments.at(-1);
    if (
      !factory ||
      (!ts.isArrowFunction(factory) && !ts.isFunctionExpression(factory))
    ) {
      report(
        'direct-agent-provider-config',
        'provideAgent requires an inline factory'
      );
      return;
    }
    const agentRefArgument =
      node.arguments.length === 2 ? node.arguments[0] : undefined;
    if (
      node.arguments.length > 2 ||
      (agentRefArgument && !ts.isIdentifier(agentRefArgument))
    ) {
      report(
        'noncanonical-provider-wiring',
        'typed provider refs must be a direct identifier first argument'
      );
    }
    if (
      agentRefArgument &&
      ts.isIdentifier(agentRefArgument) &&
      !hasExactImportBinding(
        exactBinding(agentRefArgument),
        './agent-ref',
        agentRefArgument.text
      )
    ) {
      report(
        'noncanonical-provider-wiring',
        `typed provider ref ${agentRefArgument.text} requires its stable ./agent-ref import`
      );
    }
    requireConnectionInjector(factory);

    const returned = directReturnedObject(factory);
    const members = returned
      ? configMembers(returned, agentConfigKeys, 'agent config')
      : new Map<string, ts.Expression>();
    const properties: Record<string, string> = {};
    for (const [name, value] of members) {
      properties[name] = value.getText(sourceFile);
    }
    const sessionMember = members.get('createSession');
    const shapeOrReason = sessionMember
      ? sessionFactoryShape(sessionMember, 'createSession')
      : undefined;
    const shape =
      shapeOrReason && typeof shapeOrReason !== 'string'
        ? shapeOrReason
        : undefined;
    const createSessionBinding = shape ? exactBinding(shape.callee) : undefined;
    const importedAdapter =
      createSessionBinding?.canonical &&
      createSessionBinding.importedName === 'createSession' &&
      createSessionBinding.moduleName
        ? providerAdapter(createSessionBinding.moduleName)
        : undefined;
    const adapter = importedAdapter ?? expectedAdapter;

    const connectionMetadata = connectionFactoryMetadata(
      factory,
      sourceFile,
      expectedAdapter ?? adapter ?? 'langgraph',
      new Set<ts.Node>(shape ? [shape.options] : [])
    );
    const memoryFactory =
      memoryOwner &&
      fileName === 'src/app/app.config.ts' &&
      !!shape &&
      importedAdapter === 'langgraph' &&
      matchesMemoryFactory(factory) &&
      [
        ['inject', '@angular/core'],
        ['MemoryScope', './memory-scope'],
        ['MemoryTransport', './memory-transport'],
      ].every(([name, module]) => {
        const references: ts.Identifier[] = [];
        walk(factory.body, (child) => {
          if (ts.isIdentifier(child) && child.text === name)
            references.push(child);
        });
        return (
          references.length > 0 &&
          references.every((identifier) =>
            hasExactImportBinding(exactBinding(identifier), module, name)
          )
        );
      });
    if (!connectionMetadata.canonicalFactory && !memoryFactory) {
      report(
        'noncanonical-provider-wiring',
        'provider factory must contain only the ordered connection declaration, adapter guard, and sole return'
      );
    }
    if (!returned) {
      report(
        'noncanonical-provider-wiring',
        'provider factory must return a direct object literal'
      );
      return;
    }
    if (!sessionMember) {
      report(
        'noncanonical-provider-wiring',
        'agent config requires an explicit createSession member'
      );
    } else if (typeof shapeOrReason === 'string') {
      report(
        'noncanonical-provider-wiring',
        `agent config createSession ${shapeOrReason}`
      );
    }
    if (shape && !importedAdapter) {
      report(
        'noncanonical-provider-wiring',
        `createSession requires its stable direct import from ${
          expectedAdapter
            ? sessionContract[expectedAdapter].module
            : '@threadplane/langgraph or @threadplane/ag-ui'
        }`
      );
    }
    if (expectedAdapter && importedAdapter && importedAdapter !== expectedAdapter) {
      report(
        'noncanonical-provider-wiring',
        `session adapter ${importedAdapter} does not match ${expectedAdapter}`
      );
    }
    if (!adapter) return;

    let sessionProperties: Readonly<Record<string, string>> = {};
    if (shape) {
      if (importedAdapter) sanctionedFactoryCalls.add(shape.call);
      const options = sessionOptionMembers(shape, sourceFile, 'createSession');
      sessionProperties = options.text;
      if (!memoryFactory) {
        auditSessionOptions(shape, options, adapter);
      }
    }
    providerCalls.push({
      adapter,
      provideAgentBinding,
      ...(agentRefArgument && ts.isIdentifier(agentRefArgument)
        ? {
            agentRef: agentRefArgument.text,
            agentRefBinding: exactBinding(agentRefArgument),
          }
        : {}),
      ...(createSessionBinding ? { createSessionBinding } : {}),
      properties,
      sessionProperties,
      ...(owner ? { owner } : {}),
    });
  }

  /**
   * The values a session must be given: the connection's, so the runtime
   * switcher decides where it talks; the context's thread members, so it
   * follows thread switches; and the context's reporter under a name this
   * backend's session accepts, so a refused request reaches the host.
   */
  function auditSessionOptions(
    shape: SessionFactoryShape,
    options: SessionOptionMembers,
    adapter: CompatibleRuntimeAdapter
  ): void {
    const contract = sessionContract[adapter];
    for (const problem of options.problems) {
      report(problem.kind, problem.detail);
    }
    for (const stray of strayContextReads(shape, sourceFile)) {
      report(
        'session-context-wiring',
        `the provider context may only be read as the whole value of a createSession option; found ${stray}`
      );
    }
    for (const name of contract.connection) {
      if (options.text[name] !== `connection.${name}`) {
        report(
          'session-connection-wiring',
          `${name} must be an explicit ${name}: connection.${name} assignment`
        );
      }
    }
    for (const name of contract.bypass) {
      if (options.values.has(name)) {
        report(
          'session-connection-wiring',
          `createSession option ${name} replaces the cockpit runtime connection`
        );
      }
    }
    for (const name of contract.context) {
      const value = options.values.get(name);
      if (!value || contextKeyOf(shape, value) !== name) {
        report(
          'session-context-wiring',
          `${name} must be the provider context's ${name}: ${
            name === 'onThreadId'
              ? 'a session that does not report the thread it names or creates leaves the agent without a thread id'
              : "a session that ignores it does not follow the agent's thread"
          }`
        );
      }
    }
    const accepted = reporterOptionNames[adapter];
    // A name declared both ways counts as current: the caller's lists win.
    const deprecated = deprecatedReporterOptionNames[adapter].filter(
      (name) => !accepted.includes(name)
    );
    let reporterPassed = false;
    for (const [name, value] of options.values) {
      const key = contextKeyOf(shape, value);
      if (key && !providerContextKeys.has(key)) {
        report(
          'session-context-wiring',
          `the provider context has no member ${key}`
        );
      }
      if (accepted.includes(name)) {
        reporterPassed = true;
        if (key !== contextReporterKey) {
          report(
            'operation-reporter-wiring',
            `${name} must be the provider context's ${contextReporterKey}`
          );
        }
      } else if (deprecated.includes(name)) {
        // Delivered today, so the reporter counts as passed; the name does not.
        reporterPassed = true;
        report(
          'operation-reporter-wiring',
          `the operation reporter is passed as ${name}, a deprecated alias of the ${adapter} session; pass it as ${accepted.join(
            ' or '
          )}`
        );
      } else if (
        reporterShapedNames.has(name) ||
        /OperationFailure$/.test(name) ||
        key === contextReporterKey
      ) {
        report(
          'operation-reporter-wiring',
          `the operation reporter is passed as ${name}, which the ${adapter} session does not accept (it takes ${accepted.join(
            ' or '
          )}); the reporter is dropped without an error`
        );
      }
    }
    if (!reporterPassed) {
      report(
        'operation-reporter-wiring',
        `createSession must be given the provider context's ${contextReporterKey} as ${accepted.join(
          ' or '
        )}`
      );
    }
    auditDevelopmentRuntimeOption(shape, options, adapter);
  }

  /**
   * The context's development-install relay must reach the session under the
   * one name both sessions take it by. Without it a development build reports
   * nothing, and no error says so. (The memory application's own
   * factory is matched whole against a grammar that includes the relay.)
   */
  function auditDevelopmentRuntimeOption(
    shape: SessionFactoryShape,
    options: SessionOptionMembers,
    adapter: CompatibleRuntimeAdapter
  ): void {
    let relayPassed = false;
    for (const [name, value] of options.values) {
      const key = contextKeyOf(shape, value);
      if (name === contextDevelopmentKey) {
        relayPassed = true;
        if (key !== contextDevelopmentKey) {
          report(
            'development-runtime-wiring',
            `${name} must be the provider context's ${contextDevelopmentKey}`
          );
        }
      } else if (key === contextDevelopmentKey) {
        report(
          'development-runtime-wiring',
          `the development runtime is passed as ${name}, which the ${adapter} session does not accept (it takes ${contextDevelopmentKey}); it is dropped without an error`
        );
      }
    }
    if (!relayPassed) {
      report(
        'development-runtime-wiring',
        `createSession must be given the provider context's ${contextDevelopmentKey} as ${contextDevelopmentKey}: a session without it reports nothing in a development build`
      );
    }
  }

  function auditThreadDirectoryProvider(node: ts.CallExpression): void {
    let canonical = true;
    const fail = (detail: string): void => {
      canonical = false;
      report('thread-directory-wiring', detail);
    };
    const issuesBefore = issues.length;
    const owner = providerRegistrationOwners.get(node);
    if (!owner) {
      fail(
        'provideThreadDirectory must be a direct element of executable appConfig.providers or @Component.providers'
      );
    }
    const provideBinding = exactBinding(node.expression as ts.Identifier);
    if (
      !hasExactImportBinding(
        provideBinding,
        agentProviderModule,
        'provideThreadDirectory'
      )
    ) {
      fail(
        `provideThreadDirectory requires its stable import from ${agentProviderModule}`
      );
    }
    if (expectedAdapter && expectedAdapter !== 'langgraph') {
      fail(
        `a LangGraph thread directory cannot list the threads of an ${expectedAdapter} agent`
      );
    }
    const factory = node.arguments[0];
    if (
      node.arguments.length !== 1 ||
      !factory ||
      (!ts.isArrowFunction(factory) && !ts.isFunctionExpression(factory))
    ) {
      fail('provideThreadDirectory requires one inline factory');
      threadDirectoryProviders.push({
        provideBinding,
        directoryProperties: {},
        canonical: false,
        ...(owner ? { owner } : {}),
      });
      return;
    }
    requireConnectionInjector(factory);
    const returned = directReturnedObject(factory);
    const members = returned
      ? configMembers(returned, directoryConfigKeys, 'thread directory config')
      : new Map<string, ts.Expression>();
    if (!returned) fail('directory factory must return a direct object literal');
    const directoryMember = members.get('createDirectory');
    const shapeOrReason = directoryMember
      ? sessionFactoryShape(directoryMember, 'createLangGraphThreadDirectory')
      : 'is missing';
    const shape = typeof shapeOrReason === 'string' ? undefined : shapeOrReason;
    if (typeof shapeOrReason === 'string') {
      fail(`thread directory config createDirectory ${shapeOrReason}`);
    }
    const createDirectoryBinding = shape
      ? exactBinding(shape.callee)
      : undefined;
    const stableFactory = hasExactImportBinding(
      createDirectoryBinding,
      '@threadplane/langgraph',
      'createLangGraphThreadDirectory'
    );
    if (shape && !stableFactory) {
      fail(
        'createLangGraphThreadDirectory requires its stable direct import from @threadplane/langgraph'
      );
    }
    const metadata = connectionFactoryMetadata(
      factory,
      sourceFile,
      'langgraph',
      new Set<ts.Node>(shape ? [shape.options] : [])
    );
    if (!metadata.canonicalFactory) {
      fail(
        'directory factory must contain only the ordered connection declaration, adapter guard, and sole return'
      );
    }
    let directoryProperties: Readonly<Record<string, string>> = {};
    let clientOptionsSource: 'connection' | 'context' | undefined;
    if (shape) {
      if (stableFactory) sanctionedFactoryCalls.add(shape.call);
      const options = sessionOptionMembers(
        shape,
        sourceFile,
        'createLangGraphThreadDirectory'
      );
      directoryProperties = options.text;
      for (const problem of options.problems) fail(problem.detail);
      for (const stray of strayContextReads(shape, sourceFile)) {
        fail(
          `the provider context may only be read as the whole value of a directory option; found ${stray}`
        );
      }
      if (options.text['apiUrl'] !== 'connection.apiUrl') {
        fail(
          'apiUrl must be an explicit apiUrl: connection.apiUrl assignment, so the directory lists the deployment its agent talks to'
        );
      }
      if (options.values.has('client')) {
        fail(
          'createLangGraphThreadDirectory option client replaces the cockpit runtime connection'
        );
      }
      const clientOptions = options.values.get('clientOptions');
      if (options.text['clientOptions'] === 'connection.clientOptions') {
        clientOptionsSource = 'connection';
      } else if (
        clientOptions &&
        contextKeyOf(shape, clientOptions) === 'clientOptions'
      ) {
        clientOptionsSource = 'context';
      } else {
        fail(
          "clientOptions must be connection.clientOptions or the provider context's clientOptions, so the directory sends the deployment key its agent sends"
        );
      }
      // The directory's own requests can be refused too. It is required to
      // report them as soon as the directory declares an option to do so.
      let reporterPassed = false;
      for (const [name, value] of options.values) {
        const key = contextKeyOf(shape, value);
        if (directoryReporterOptionNames.includes(name)) {
          reporterPassed = true;
          if (key !== contextReporterKey) {
            fail(`${name} must be the provider context's ${contextReporterKey}`);
          }
        } else if (
          reporterShapedNames.has(name) ||
          /OperationFailure$/.test(name) ||
          key === contextReporterKey
        ) {
          fail(
            `the operation reporter is passed as ${name}, which the thread directory does not accept${
              directoryReporterOptionNames.length
                ? ` (it takes ${directoryReporterOptionNames.join(' or ')})`
                : ''
            }; the reporter is dropped without an error`
          );
        }
      }
      if (directoryReporterOptionNames.length > 0 && !reporterPassed) {
        fail(
          `createLangGraphThreadDirectory must be given the provider context's ${contextReporterKey} as ${directoryReporterOptionNames.join(
            ' or '
          )}`
        );
      }
    }
    threadDirectoryProviders.push({
      provideBinding,
      ...(createDirectoryBinding ? { createDirectoryBinding } : {}),
      directoryProperties,
      ...(clientOptionsSource ? { clientOptionsSource } : {}),
      canonical: canonical && issues.length === issuesBefore,
      ...(owner ? { owner } : {}),
    });
  }

  for (const providers of appConfigProviderArrays) {
    const seenTokens = new Set<string>();
    for (const element of providers.elements) {
      if (!ts.isObjectLiteralExpression(element)) continue;
      const hasSpread = element.properties.some(ts.isSpreadAssignment);
      const relevantMembers = element.properties.filter((property) => {
        if (
          !ts.isPropertyAssignment(property) &&
          !ts.isShorthandPropertyAssignment(property) &&
          !ts.isMethodDeclaration(property)
        ) {
          return false;
        }
        const name = propertyNameText(property.name);
        return name === 'provide' || name === 'useFactory';
      });
      const provideMembers = relevantMembers.filter(
        (property) =>
          property.name !== undefined &&
          propertyNameText(property.name) === 'provide'
      );
      const factoryMembers = relevantMembers.filter(
        (property) =>
          property.name !== undefined &&
          propertyNameText(property.name) === 'useFactory'
      );
      const canonicalMembers =
        !hasSpread &&
        provideMembers.length === 1 &&
        factoryMembers.length === 1 &&
        ts.isPropertyAssignment(provideMembers[0]) &&
        ts.isIdentifier(provideMembers[0].name) &&
        ts.isPropertyAssignment(factoryMembers[0]) &&
        ts.isIdentifier(factoryMembers[0].name);
      if (hasSpread || provideMembers.length > 0 || factoryMembers.length > 0) {
        if (!canonicalMembers) {
          report(
            'noncanonical-provider-wiring',
            'Angular provider objects require explicit unique provide/useFactory assignments and no spreads'
          );
        }
      }
      if (!canonicalMembers) continue;
      const provide = provideMembers[0] as ts.PropertyAssignment;
      const useFactory = factoryMembers[0] as ts.PropertyAssignment;
      const token = provide.initializer.getText(sourceFile);
      if (seenTokens.has(token)) {
        report(
          'noncanonical-provider-wiring',
          `duplicate Angular provider token ${token}`
        );
      }
      seenTokens.add(token);
      const factory = useFactory.initializer;
      const provider: AngularProviderRecord = {
        provideToken: token,
        ...(ts.isIdentifier(provide.initializer)
          ? { provideTokenBinding: exactBinding(provide.initializer) }
          : {}),
        useFactoryExpression: factory.getText(sourceFile),
        connectionCallCount: 0,
        connectionWrites: false,
        canonicalFactory: false,
        returnedProperties: {},
      };
      if (ts.isArrowFunction(factory) || ts.isFunctionExpression(factory)) {
        const metadata = connectionFactoryMetadata(
          factory,
          sourceFile,
          'langgraph'
        );
        const connectionInjectorBinding = exactFactoryBinding(
          factory,
          'injectCockpitRuntimeConnection'
        );
        Object.assign(provider, metadata, {
          ...(connectionInjectorBinding
            ? { connectionInjectorBinding }
            : {}),
          canonicalFactory:
            canonicalConnectionImport &&
            hasExactImportBinding(
              connectionInjectorBinding,
              '@threadplane/cockpit-telemetry',
              'injectCockpitRuntimeConnection'
            ) &&
            metadata.canonicalFactory,
        });
      }
      angularProviders.push(provider);
      if (
        hasExactImportBinding(
          provider.provideTokenBinding,
          agentProviderModule,
          'AGENT_CLIENT_OPTIONS'
        )
      ) {
        // The value every `context.clientOptions` reads. It carries the
        // developer's deployment key, so it has one legitimate source.
        if (
          provider.canonicalFactory &&
          provider.returnExpression === 'connection.clientOptions'
        ) {
          canonicalClientOptionsProvider = true;
          sanctionedTokenReferences.add(provide.initializer as ts.Identifier);
        } else {
          report(
            'session-connection-wiring',
            'AGENT_CLIENT_OPTIONS must be provided by the canonical connection factory returning connection.clientOptions'
          );
        }
      }
    }
  }

  const bootstrapCallNodes: ts.CallExpression[] = [];
  const harnessExecutableReferences: ts.Identifier[] = [];
  walk(sourceFile, (node) => {
    if (
      ts.isIdentifier(node) &&
      node.text === 'bootstrapWithCockpitHarness' &&
      !isDeclarationIdentifier(node) &&
      !isTypeOnlyIdentifierReference(node)
    ) {
      harnessExecutableReferences.push(node);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'bootstrapWithCockpitHarness'
    ) {
      bootstrapCallNodes.push(node);
    }
  });
  for (const node of bootstrapCallNodes) {
    const root = node.arguments[0];
    const appConfig = node.arguments[1];
    const options = node.arguments[2];
    const runtimeProperties: Record<string, string> = {};
    const environmentBindings: ExactImportBinding[] = [];
    const environmentReferenceIdentifiers: ts.Identifier[] = [];
    let operationReporterBinding: ExactImportBinding | undefined;
    let hasCanonicalRuntimeOptions = false;
    let hasPristineAgUrlGlobals = expectedAdapter !== 'ag-ui';
    if (options && ts.isObjectLiteralExpression(options)) {
      const outerProperties = directUniqueProperties(options);
      const runtime = outerProperties?.get('runtime');
      if (
        outerProperties?.size === 1 &&
        runtime &&
        ts.isObjectLiteralExpression(runtime.initializer)
      ) {
        const directRuntimeProperties = directUniqueProperties(
          runtime.initializer
        );
        if (directRuntimeProperties) {
          for (const property of directRuntimeProperties.values()) {
            const propertyName = (property.name as ts.Identifier).text;
            runtimeProperties[propertyName] =
              property.initializer.getText(sourceFile);
            if (
              propertyName === 'operationReporterToken' &&
              ts.isIdentifier(property.initializer)
            ) {
              operationReporterBinding = exactBinding(property.initializer);
              if (isEntrypoint && bootstrapCallNodes.length === 1) {
                sanctionedTokenReferences.add(property.initializer);
              }
            }
            if (
              (propertyName === 'sharedApiUrl' ||
                propertyName === 'assistantId') &&
              expressionRootIdentifier(property.initializer)?.text ===
                'environment'
            ) {
              const environmentIdentifier = expressionRootIdentifier(
                property.initializer
              ) as ts.Identifier;
              environmentReferenceIdentifiers.push(environmentIdentifier);
              environmentBindings.push(
                exactBinding(environmentIdentifier)
              );
            }
          }
          const requiredNames =
            expectedAdapter === 'langgraph'
              ? [
                  'adapter',
                  'sharedApiUrl',
                  'assistantId',
                  'operationReporterToken',
                ]
              : expectedAdapter === 'ag-ui'
                ? ['adapter', 'sharedUrl', 'operationReporterToken']
                : [];
          const adapterProperty = directRuntimeProperties.get('adapter');
          const reporterProperty = directRuntimeProperties.get(
            'operationReporterToken'
          );
          const expectedReporter = operationReporterToken;
          const sharedUrlProperty = directRuntimeProperties.get('sharedUrl');
          const agGlobals = sharedUrlProperty
            ? agSharedUrlGlobalIdentifiers(sharedUrlProperty.initializer)
            : undefined;
          hasCanonicalRuntimeOptions =
            requiredNames.length > 0 &&
            directRuntimeProperties.size === requiredNames.length &&
            requiredNames.every((name) =>
              directRuntimeProperties.has(name)
            ) &&
            !!adapterProperty &&
            ts.isStringLiteralLike(adapterProperty.initializer) &&
            adapterProperty.initializer.text === expectedAdapter &&
            !!reporterProperty &&
            ts.isIdentifier(reporterProperty.initializer) &&
            reporterProperty.initializer.text === expectedReporter &&
            (expectedAdapter !== 'ag-ui' || !!agGlobals);
          if (expectedAdapter === 'ag-ui' && agGlobals) {
            const pristineGlobal = (
              identifier: ts.Identifier,
              name: string
            ): boolean =>
              identifier.text === name &&
              topLevelImportBindingCount(name) === 0 &&
              topLevelLocalBindingCount(name) === 0 &&
              !writtenRuntimeBindings.has(name) &&
              !isLocallyShadowed(identifier, name) &&
              isSoleExecutableReference(identifier, name);
            hasPristineAgUrlGlobals =
              pristineGlobal(agGlobals.url, 'URL') &&
              pristineGlobal(agGlobals.document, 'document');
          }
        }
      }
    }
    if (
      expectedAdapter === 'langgraph' &&
      !hasOnlyExecutableReferences(
        environmentReferenceIdentifiers,
        'environment'
      )
    ) {
      hasCanonicalRuntimeOptions = false;
      for (const [index, binding] of environmentBindings.entries()) {
        environmentBindings[index] = { ...binding, canonical: false };
      }
    }
    bootstrapCalls.push({
      ...(root && ts.isIdentifier(root) ? { rootComponent: root.text } : {}),
      ...(root && ts.isIdentifier(root)
        ? { rootComponentBinding: exactBinding(root) }
        : {}),
      ...(appConfig
        ? { appConfigArgument: appConfig.getText(sourceFile) }
        : {}),
      hasCanonicalAppConfigBinding:
        !!appConfig &&
        ts.isIdentifier(appConfig) &&
        appConfig.text === 'appConfig' &&
        canonicalAppConfigImportCount === 1 &&
        hasExactImportBinding(
          exactBinding(appConfig),
          './app/app.config',
          'appConfig'
        ) &&
        isSoleExecutableReference(appConfig, 'appConfig'),
      hasCanonicalHarnessBinding:
        canonicalHarnessImportCount === 1 &&
        harnessSymbolImportCount === 1 &&
        hasExactImportBinding(
          exactBinding(node.expression as ts.Identifier),
          '@threadplane/cockpit-telemetry',
          'bootstrapWithCockpitHarness'
        ) &&
        harnessExecutableReferences.length === 1 &&
        harnessExecutableReferences[0] === node.expression,
      hasCanonicalCallOwner:
        bootstrapCallNodes.length === 1 &&
        hasCanonicalTopLevelBootstrapOwner(node, sourceFile),
      hasCanonicalRuntimeOptions,
      hasPristineAgUrlGlobals,
      environmentBindings,
      ...(operationReporterBinding ? { operationReporterBinding } : {}),
      runtimeProperties,
      hasRedactedCatch: hasRedactedCatch(node),
    });
  }

  for (const [index, record] of threadDirectoryProviders.entries()) {
    if (
      record.clientOptionsSource === 'context' &&
      !canonicalClientOptionsProvider
    ) {
      report(
        'thread-directory-wiring',
        "a directory that reads the provider context's clientOptions requires the canonical AGENT_CLIENT_OPTIONS provider in the same file"
      );
      threadDirectoryProviders[index] = { ...record, canonical: false };
    }
  }

  // The session and directory factories, and the two host tokens, each have
  // one sanctioned place. A session built anywhere else never receives the
  // provider context: it ignores the agent's thread and drops the reporter.
  const backendFactoryLocals = new Set<string>();
  const hostTokenLocals = new Map<string, string>();
  for (const [localName, bindings] of importBindingsByLocalName) {
    for (const binding of bindings) {
      if (
        providerAdapter(binding.moduleName) &&
        sessionFactoryNames.has(binding.importedName)
      ) {
        backendFactoryLocals.add(localName);
      }
      if (
        binding.moduleName === agentProviderModule &&
        (binding.importedName === 'AGENT_CLIENT_OPTIONS' ||
          binding.importedName === operationReporterToken)
      ) {
        hostTokenLocals.set(localName, binding.importedName);
      }
      if (
        binding.moduleName === agentProviderModule &&
        binding.importedName === 'provideAgentClientOptions'
      ) {
        report(
          'session-connection-wiring',
          'provideAgentClientOptions supplies fixed client options; provide AGENT_CLIENT_OPTIONS from connection.clientOptions instead'
        );
      }
    }
  }
  walk(sourceFile, (node) => {
    if (
      !ts.isIdentifier(node) ||
      isDeclarationIdentifier(node) ||
      isTypeOnlyIdentifierReference(node)
    ) {
      return;
    }
    if (backendFactoryLocals.has(node.text)) {
      const sanctioned =
        ts.isCallExpression(node.parent) &&
        node.parent.expression === node &&
        sanctionedFactoryCalls.has(node.parent);
      if (!sanctioned) {
        report(
          'session-outside-provider-factory',
          `${node.text} may only be called as the direct result of its provider factory's ${
            node.text === 'createSession' ? 'createSession' : 'createDirectory'
          } member; built anywhere else it never receives the provider context`
        );
      }
    }
    const hostToken = hostTokenLocals.get(node.text);
    if (hostToken && !sanctionedTokenReferences.has(node)) {
      report(
        hostToken === operationReporterToken
          ? 'operation-reporter-wiring'
          : 'session-connection-wiring',
        hostToken === operationReporterToken
          ? `${hostToken} may only be handed to the cockpit harness as the entrypoint's operationReporterToken`
          : `${hostToken} may only be the provide token of the canonical connection factory provider`
      );
    }
  });

  if (memoryOwner && fileName === 'src/app/memory-scope.ts') {
    const tokenReferences: ts.Identifier[] = [];
    walk(sourceFile, (child) => {
      if (
        ts.isNewExpression(child) &&
        ts.isIdentifier(child.expression) &&
        child.expression.text === 'InjectionToken'
      )
        tokenReferences.push(child.expression);
    });
    if (
      tokenReferences.length === 1 &&
      hasExactImportBinding(
        exactBinding(tokenReferences[0]),
        '@angular/core',
        'InjectionToken'
      )
    )
      memoryStorageAccess = memoryScopeStorageAccess(sourceFile);
  }

  const isGlobalObjectIdentifier = (
    expression: ts.Expression
  ): expression is ts.Identifier =>
    ts.isIdentifier(expression) &&
    (expression.text === 'window' ||
      expression.text === 'globalThis' ||
      expression.text === 'self') &&
    !isLexicallyDeclared(expression);

  walk(sourceFile, (node) => {
    if (node === memoryStorageAccess) return;
    const reportUnconditionalMember = (property: string): void => {
      if (unconditionalBrowserMemberNames.has(property)) {
        report('browser-state-read', `sensitive member ${property}`);
      }
      if (unconditionalSecretMemberNames.has(property)) {
        report('global-runtime-secret-read', `sensitive member ${property}`);
      }
    };
    if (ts.isPropertyAccessExpression(node)) {
      reportUnconditionalMember(node.name.text);
      const chain = accessChain(node);
      const locationIndex = chain.lastIndexOf('location');
      const historyIndex = chain.lastIndexOf('history');
      if (
        (locationIndex >= 0 &&
          chain
            .slice(locationIndex + 1)
            .some((member) =>
              ['href', 'search', 'hash', 'searchParams'].includes(member)
            )) ||
        (historyIndex >= 0 &&
          chain
            .slice(historyIndex + 1)
            .some((member) =>
              ['state', 'pushState', 'replaceState'].includes(member)
            ))
      ) {
        report(
          'browser-state-read',
          `sensitive browser chain ${chain.join('.')}`
        );
      }
    }
    if (ts.isElementAccessExpression(node) && node.argumentExpression) {
      const property = staticPropertyName(node.argumentExpression);
      if (property) reportUnconditionalMember(property);
      const chain = accessChain(node);
      const locationIndex = chain.lastIndexOf('location');
      const historyIndex = chain.lastIndexOf('history');
      if (
        (locationIndex >= 0 &&
          chain
            .slice(locationIndex + 1)
            .some((member) => ['href', 'search', 'hash'].includes(member))) ||
        (historyIndex >= 0 &&
          chain
            .slice(historyIndex + 1)
            .some((member) =>
              ['state', 'pushState', 'replaceState'].includes(member)
            ))
      ) {
        report(
          'browser-state-read',
          `sensitive browser chain ${chain.join('.')}`
        );
      }
    }
    if (
      ts.isPropertyAssignment(node) ||
      ts.isShorthandPropertyAssignment(node) ||
      ts.isMethodDeclaration(node)
    ) {
      const property = propertyNameText(node.name);
      if (property) reportUnconditionalMember(property);
    }
    if (ts.isBindingElement(node)) {
      const property = node.propertyName
        ? propertyNameText(node.propertyName)
        : ts.isIdentifier(node.name)
        ? node.name.text
        : undefined;
      if (property) reportUnconditionalMember(property);
    }
    if (
      ts.isIdentifier(node) &&
      browserStateNames.has(node.text) &&
      !isLexicallyDeclared(node) &&
      !isDeclarationIdentifier(node)
    ) {
      const isPropertyName =
        (ts.isPropertyAccessExpression(node.parent) &&
          node.parent.name === node) ||
        (ts.isPropertyAssignment(node.parent) && node.parent.name === node);
      if (!isPropertyName) {
        report('browser-state-read', `browser state identifier ${node.text}`);
      }
    }
    if (ts.isPropertyAccessExpression(node)) {
      if (isGlobalObjectIdentifier(node.expression)) {
        const property = node.name.text;
        if (
          browserStateNames.has(property) ||
          isSensitiveRuntimeName(property)
        ) {
          report(
            isSensitiveRuntimeName(property)
              ? 'global-runtime-secret-read'
              : 'browser-state-read',
            `sensitive global property ${node.getText(sourceFile)}`
          );
        }
      }
      if (
        ts.isIdentifier(node.expression) &&
        !isLexicallyDeclared(node.expression) &&
        ((node.expression.text === 'document' &&
          documentStateNames.has(node.name.text)) ||
          node.expression.text === 'location' ||
          node.expression.text === 'history')
      ) {
        report(
          'browser-state-read',
          `browser state property ${node.getText(sourceFile)}`
        );
      }
    }
    if (ts.isElementAccessExpression(node)) {
      const property = node.argumentExpression
        ? staticPropertyName(node.argumentExpression)
        : undefined;
      if (isGlobalObjectIdentifier(node.expression)) {
        if (property === 'parent') return;
        if (
          !property ||
          browserStateNames.has(property) ||
          isSensitiveRuntimeName(property)
        ) {
          report(
            property && isSensitiveRuntimeName(property)
              ? 'global-runtime-secret-read'
              : 'browser-state-read',
            `sensitive global bracket read ${node.getText(sourceFile)}`
          );
        }
      }
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'document' &&
        !isLexicallyDeclared(node.expression) &&
        (!property || documentStateNames.has(property))
      ) {
        report(
          'browser-state-read',
          `document state read ${node.getText(sourceFile)}`
        );
      }
    }
    if (ts.isBindingElement(node)) {
      const property = node.propertyName
        ? ts.isIdentifier(node.propertyName) ||
          ts.isStringLiteralLike(node.propertyName)
          ? node.propertyName.text
          : undefined
        : ts.isIdentifier(node.name)
        ? node.name.text
        : undefined;
      const declaration = node.parent.parent;
      if (
        property &&
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer &&
        ts.isIdentifier(declaration.initializer) &&
        declaration.initializer.text === 'document' &&
        !isLexicallyDeclared(declaration.initializer) &&
        documentStateNames.has(property)
      ) {
        report('browser-state-read', `destructured document state ${property}`);
      }
    }
  });

  walk(sourceFile, (node) => {
    if (
      ts.isParameter(node) &&
      ts.isIdentifier(node.name) &&
      isSensitiveLogName(node.name.text)
    ) {
      taintedLogNames.add(node.name.text);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      ((node.initializer &&
        nodeContainsSensitiveName(node.initializer, isSensitiveLogName)) ||
        isSensitiveLogName(node.name.text))
    ) {
      taintedLogNames.add(node.name.text);
    }
  });
  let taintChanged = true;
  while (taintChanged) {
    taintChanged = false;
    walk(sourceFile, (node) => {
      if (
        !ts.isVariableDeclaration(node) ||
        !ts.isIdentifier(node.name) ||
        !node.initializer ||
        taintedLogNames.has(node.name.text)
      ) {
        return;
      }
      let readsTainted = false;
      walk(node.initializer, (child) => {
        if (ts.isIdentifier(child) && taintedLogNames.has(child.text)) {
          readsTainted = true;
        }
      });
      if (readsTainted) {
        taintedLogNames.add(node.name.text);
        taintChanged = true;
      }
    });
  }
  walk(sourceFile, (node) => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression) ||
      !ts.isIdentifier(node.expression.expression) ||
      node.expression.expression.text !== 'console' ||
      isLexicallyDeclared(node.expression.expression)
    ) {
      return;
    }
    const logsSensitive = node.arguments.some((argument) => {
      if (ts.isStringLiteralLike(argument)) {
        return isSensitiveLogName(argument.text);
      }
      let sensitive = nodeContainsSensitiveName(argument, isSensitiveLogName);
      walk(argument, (child) => {
        if (ts.isIdentifier(child) && taintedLogNames.has(child.text)) {
          sensitive = true;
        }
      });
      return sensitive;
    });
    if (logsSensitive) {
      report('runtime-secret-log', `console.${node.expression.name.text}`);
    }
  });

  return {
    issues,
    providerCalls,
    bootstrapCalls,
    angularProviders,
    threadDirectoryProviders,
  };
}

export function auditRuntimeTargetSource(
  source: string,
  fileName: string,
  expectedAdapter?: CompatibleRuntimeAdapter,
  options?: RuntimeWiringAuditOptions
): RuntimeWiringAuditIssue[] {
  return inspectRuntimeTargetSource(
    source,
    fileName,
    expectedAdapter,
    undefined,
    options
  ).issues;
}
