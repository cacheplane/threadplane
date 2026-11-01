import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {
  CompilerState,
  Extractor,
  ExtractorConfig,
  ExtractorLogLevel,
} from '@microsoft/api-extractor';
import type {
  ApiIndex,
  ApiMember,
  ApiSymbol,
  ApiToken,
} from '../../src/lib/api-reference-model';
import {
  apiMemberAnchor,
  apiSummary,
  apiSymbolFileName,
  apiSymbolHref,
} from '../../src/lib/api-reference-model';
import { assertPublicDocOutput } from '../public-doc-projection';
import {
  SDK_ENTRYPOINTS,
  validateRegistry,
  type SdkEntrypoint,
} from './registry';
import { parseDocs } from './docs';
import {
  angularMetadata,
  exportedDeclarations,
  isPublicDeclaration,
  isTypeOnlyExport,
  memberDeclaration,
  sourceLocation,
} from './source';

interface RawMember extends Omit<ApiMember, 'docs' | 'members'> {
  docComment?: string;
  releaseTag?: string;
  members?: RawMember[];
}
interface SourceRegistry {
  origins: WeakMap<ApiMember, ts.Declaration>;
  symbols: Map<string, ApiSymbol[]>;
}
function declarationIdentity(declaration: ts.Declaration): string {
  return `${declaration.getSourceFile().fileName}:${declaration.pos}:${
    declaration.end
  }`;
}
export interface GenerateOptions {
  root: string;
  entrypoints?: readonly SdkEntrypoint[];
  output?: string;
  check?: boolean;
  validate?: boolean;
}
function sorted<T extends { name: string }>(values: T[]): T[] {
  return values.sort((a, b) => a.name.localeCompare(b.name, 'en'));
}
function diagnosticText(diagnostics: readonly ts.Diagnostic[]): string {
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => process.cwd(),
    getCanonicalFileName: (value) => value,
    getNewLine: () => '\n',
  });
}
function compile(
  root: string,
  entries: readonly SdkEntrypoint[],
  staging: string
): ts.Program {
  const configFile = path.join(root, 'apps/website/scripts/tsconfig.api.json');
  const read = ts.readConfigFile(configFile, ts.sys.readFile);
  if (read.error) throw new Error(diagnosticText([read.error]));
  const config = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    path.dirname(configFile)
  );
  const options: ts.CompilerOptions = {
    ...config.options,
    rootDir: root,
    outDir: path.join(staging, 'declarations'),
    paths: {
      ...config.options.paths,
      ...Object.fromEntries(
        entries.map((entry) => [
          entry.importPath,
          [path.join(root, entry.source)],
        ])
      ),
    },
  };
  const files = entries.map((entry) => path.join(root, entry.source));
  for (const file of files)
    if (!fs.existsSync(file))
      throw new Error(`Missing API entrypoint: ${path.relative(root, file)}`);
  const program = ts.createProgram(files, options);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (
    diagnostics.some(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
    )
  )
    throw new Error(
      `API declaration type checking failed:\n${diagnosticText(diagnostics)}`
    );
  const emitted = program.emit();
  if (emitted.emitSkipped || emitted.diagnostics.length)
    throw new Error(
      `API declaration emission failed:\n${diagnosticText(emitted.diagnostics)}`
    );
  return program;
}
interface ExtractionContext {
  compilerState?: CompilerState;
  diagnostics: Set<string>;
}
function extract(
  root: string,
  entry: SdkEntrypoint,
  entries: readonly SdkEntrypoint[],
  staging: string,
  context: ExtractionContext,
  exportName?: string,
  bundledPackages: string[] = []
): RawMember[] {
  const declarationPath = (source: string) =>
    path.join(staging, 'declarations', source.replace(/\.tsx?$/, '.d.ts'));
  const paths = Object.fromEntries(
    entries.map((item) => [item.importPath, [declarationPath(item.source)]])
  );
  let mainEntryPointFilePath = declarationPath(entry.source);
  if (exportName) {
    mainEntryPointFilePath = path.join(
      staging,
      'aliases',
      `${entry.id.replaceAll('/', '__')}-${exportName}.d.ts`
    );
    fs.mkdirSync(path.dirname(mainEntryPointFilePath), { recursive: true });
    fs.writeFileSync(
      mainEntryPointFilePath,
      `export { ${exportName} } from ${JSON.stringify(
        path
          .relative(
            path.dirname(mainEntryPointFilePath),
            declarationPath(entry.source)
          )
          .replace(/\.d\.ts$/, '')
      )};\n`
    );
  }
  const modelFile = path.join(
    staging,
    'models',
    `${entry.id.replaceAll('/', '__')}${
      exportName ? `-${exportName}` : ''
    }.api.json`
  );
  fs.mkdirSync(path.dirname(modelFile), { recursive: true });
  const config = ExtractorConfig.prepare({
    configObject: {
      projectFolder: root,
      bundledPackages,
      mainEntryPointFilePath,
      compiler: {
        overrideTsconfig: {
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            skipLibCheck: true,
            strict: true,
            jsx: 'react-jsx',
            esModuleInterop: true,
            experimentalDecorators: true,
            baseUrl: root,
            paths,
            types: ['node', 'react'],
            lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          },
          files: entries.map((item) => declarationPath(item.source)),
        },
      },
      apiReport: { enabled: false },
      dtsRollup: { enabled: false },
      tsdocMetadata: { enabled: false },
      docModel: {
        enabled: true,
        apiJsonFilePath: modelFile,
        includeForgottenExports: false,
      },
      messages: {
        compilerMessageReporting: {
          default: { logLevel: ExtractorLogLevel.Error },
        },
        extractorMessageReporting: {
          default: { logLevel: ExtractorLogLevel.Warning },
          // Missing summaries are reported by index.undocumented. Forgotten
          // exports are resolved by the complete checked source registry below.
          'ae-missing-release-tag': { logLevel: ExtractorLogLevel.None },
          'ae-forgotten-export': { logLevel: ExtractorLogLevel.None },
        },
        tsdocMessageReporting: {
          default: { logLevel: ExtractorLogLevel.Warning },
        },
      },
    },
    configObjectFullPath: path.join(
      root,
      'apps/website/scripts/api-extractor.json'
    ),
    packageJsonFullPath: path.join(root, 'libs', entry.project, 'package.json'),
    packageJson: { name: entry.packageName, version: entry.version },
  });
  const messages: string[] = [];
  // All normal entrypoints use the same complete staged declaration graph.
  // Isolated alias wrappers receive their own program because they add a root.
  if (!exportName && !context.compilerState)
    context.compilerState = CompilerState.create(config);
  const result = Extractor.invoke(config, {
    compilerState: exportName ? undefined : context.compilerState,
    localBuild: true,
    showVerboseMessages: false,
    messageCallback(message) {
      if (message.logLevel === ExtractorLogLevel.Error)
        messages.push(message.text);
      if (message.logLevel === ExtractorLogLevel.Warning) {
        const location = message.sourceFilePath
          ? path.relative(
              message.sourceFilePath.startsWith(
                path.join(staging, 'declarations')
              )
                ? path.join(staging, 'declarations')
                : root,
              message.sourceFilePath
            )
          : entry.source;
        const diagnostic = `${location}:${message.sourceFileLine ?? 1} [${
          message.messageId
        }] ${message.text}`;
        if (!context.diagnostics.has(diagnostic)) {
          context.diagnostics.add(diagnostic);
          console.warn(diagnostic);
        }
      }
      message.handled = true;
    },
  });
  if (!result.succeeded)
    throw new Error(
      `API Extractor failed for ${entry.importPath}: ${messages.join('\n')}`
    );
  const model = JSON.parse(fs.readFileSync(modelFile, 'utf8')) as RawMember;
  const entrypoint = model.members?.find((item) => item.kind === 'EntryPoint');
  if (!entrypoint?.members?.length && !entry.allowEmpty)
    throw new Error(
      `Empty API Extractor model: ${entry.importPath}${
        exportName ? `#${exportName}` : ''
      }`
    );
  return entrypoint?.members ?? [];
}
function normalize(
  raw: RawMember,
  root: string,
  program: ts.Program,
  declarations: readonly ts.Declaration[],
  sources: SourceRegistry
): ApiMember | undefined {
  if (
    raw.name?.startsWith('ɵ') ||
    raw.releaseTag === 'Internal' ||
    /@internal\b/.test(raw.docComment ?? '')
  )
    return undefined;
  const source =
    declarations[(raw.overloadIndex ?? 1) - 1] ??
    declarations.find(isPublicDeclaration);
  if (declarations.length && (!source || !isPublicDeclaration(source)))
    return undefined;
  const text = raw.excerptTokens?.map((token) => token.text).join('') ?? '';
  if (/^\s*(?:private|protected)\b/.test(text)) return undefined;
  const result: ApiMember = {
    name: raw.name ?? raw.kind,
    kind: raw.kind,
    canonicalReference: raw.canonicalReference,
    excerptTokens: raw.excerptTokens ?? [],
    docs: parseDocs(raw.docComment ?? ''),
    members: [],
    source: sourceLocation(root, source),
  };
  if (source) sources.origins.set(result, source);
  for (const key of [
    'overloadIndex',
    'isStatic',
    'isReadonly',
    'isOptional',
    'parameters',
    'typeParameters',
    'returnTypeTokenRange',
    'typeTokenRange',
    'variableTypeTokenRange',
  ] as const) {
    if (raw[key] !== undefined) Object.assign(result, { [key]: raw[key] });
  }
  const angular = angularMetadata(source, program.getTypeChecker());
  if (angular) result.angular = angular;
  result.members = (raw.members ?? []).flatMap((member) => {
    const declaration = memberDeclaration(
      declarations,
      member.name,
      (member.overloadIndex ?? 1) - 1,
      member.kind
    );
    const value = normalize(
      member,
      root,
      program,
      declaration ? [declaration] : [],
      sources
    );
    return value ? [value] : [];
  });
  return result;
}
function symbolsFor(
  entry: SdkEntrypoint,
  raw: RawMember[],
  root: string,
  program: ts.Program,
  sources: SourceRegistry
): ApiSymbol[] {
  const exports = exportedDeclarations(program, path.join(root, entry.source));
  const checker = program.getTypeChecker();
  const entryFile = program.getSourceFile(path.join(root, entry.source));
  const entryModule = entryFile && checker.getSymbolAtLocation(entryFile);
  const exportSources = new Map(
    entryModule
      ? checker
          .getExportsOfModule(entryModule)
          .map((symbol) => [symbol.name, symbol.declarations?.[0]])
      : []
  );
  const groups = new Map<string, ApiMember[]>();
  for (const member of raw) {
    const value = normalize(
      member,
      root,
      program,
      exports.get(member.name) ?? [],
      sources
    );
    if (value) {
      // Forwarded external declarations retain the Extractor excerpt, while
      // their source link points to this SDK's real reexport declaration.
      const external = value.source?.path.startsWith('node_modules/');
      const clearExternalSources = (item: ApiMember): void => {
        if (item.source?.path.startsWith('node_modules/')) delete item.source;
        item.members.forEach(clearExternalSources);
      };
      clearExternalSources(value);
      if (external) {
        const exportDeclaration = exportSources.get(member.name);
        value.source = sourceLocation(root, exportDeclaration);
        // External SDK types can lack summaries. An explicit TSDoc comment
        // on this SDK's reexport documents that contract without wrapping or
        // replacing the upstream declaration or its existing documentation.
        if (!value.docs.summary && exportDeclaration) {
          const comment = ts
            .getJSDocCommentsAndTags(exportDeclaration)
            .filter(ts.isJSDoc)
            .map((doc) => doc.getText())
            .join('\n');
          value.docs.summary = parseDocs(comment).summary;
        }
      }
      groups.set(value.name, [...(groups.get(value.name) ?? []), value]);
    }
  }
  for (const [name, declarations] of exports) {
    if (
      !name.startsWith('ɵ') &&
      declarations.some(isPublicDeclaration) &&
      !groups.has(name)
    )
      throw new Error(
        `Unrecognized exported API ${
          entry.importPath
        }#${name} at ${JSON.stringify(
          sourceLocation(root, declarations[0])
        )}; extractor exports: ${raw.map((item) => item.name).join(', ')}`
      );
  }
  const symbols: ApiSymbol[] = [];
  const add = (name: string, declarations: ApiMember[]): void => {
    const first = declarations[0];
    if (!first) return;
    const sourceDeclarations =
      exports.get(name) ??
      declarations.flatMap((member) => {
        const origin = sources.origins.get(member);
        return origin ? [origin] : [];
      });
    const symbol: ApiSymbol = {
      name,
      entrypointId: entry.id,
      kind: first.kind,
      href: apiSymbolHref(entry.id, name),
      canonicalReference: first.canonicalReference,
      isDeprecated: declarations.every((member) => !!member.docs.deprecated),
      isTypeOnly: exports.has(name)
        ? isTypeOnlyExport(program, path.join(root, entry.source), name)
        : declarations.every((member) =>
            ['Interface', 'TypeAlias'].includes(member.kind)
          ),
      summary: apiSummary(declarations),
      declarations,
      source: first.source,
    };
    symbols.push(symbol);
    for (const declaration of sourceDeclarations) {
      const identity = declarationIdentity(declaration);
      sources.symbols.set(identity, [
        ...(sources.symbols.get(identity) ?? []),
        symbol,
      ]);
    }
    for (const declaration of declarations)
      if (declaration.kind === 'Namespace') {
        const children = new Map<string, ApiMember[]>();
        for (const member of declaration.members)
          children.set(member.name, [
            ...(children.get(member.name) ?? []),
            member,
          ]);
        for (const [child, members] of children)
          add(`${name}.${child}`, members);
      }
  };
  for (const [name, declarations] of groups) add(name, declarations);
  return sorted(symbols);
}
function resolveLinks(
  symbols: ApiSymbol[],
  entries: readonly SdkEntrypoint[],
  program: ts.Program,
  sources: SourceRegistry
): void {
  const canonical = new Map<string, { entrypointId: string; href: string }[]>();
  const names = new Map<string, ApiSymbol[]>();
  const add = (reference: string, entrypointId: string, href: string) =>
    canonical.set(reference, [
      ...(canonical.get(reference) ?? []),
      { entrypointId, href },
    ]);
  for (const symbol of symbols) {
    names.set(symbol.name, [...(names.get(symbol.name) ?? []), symbol]);
    const walk = (member: ApiMember, href: string): void => {
      add(member.canonicalReference, symbol.entrypointId, href);
      member.members.forEach((child, index) =>
        walk(child, `${href.split('#')[0]}#${apiMemberAnchor(child, index)}`)
      );
    };
    symbol.declarations.forEach((member) => walk(member, symbol.href));
  }
  const choose = <T extends { entrypointId: string; href: string }>(
    targets: T[] | undefined,
    current: string
  ): T | undefined =>
    targets?.find((target) => target.entrypointId === current) ?? targets?.[0];
  const originReferences = new WeakMap<
    ts.Declaration,
    Map<string, ApiSymbol[]>
  >();
  const externalReferences = new WeakMap<ts.Declaration, Set<string>>();
  const resolveOrigin = (
    member: ApiMember,
    text: string,
    current: string
  ): string | undefined => {
    const declaration = sources.origins.get(member);
    if (!declaration) return undefined;
    let references = originReferences.get(declaration);
    if (!references) {
      references = new Map();
      const externals = new Set<string>();
      externalReferences.set(declaration, externals);
      const checker = program.getTypeChecker();
      const visitedDeclarations = new Set<ts.Declaration>();
      const walk = (node: ts.Node): void => {
        if (ts.isIdentifier(node)) {
          let target = checker.getSymbolAtLocation(node);
          if (target && target.flags & ts.SymbolFlags.Alias)
            target = checker.getAliasedSymbol(target);
          const targets =
            target?.declarations?.flatMap(
              (item) => sources.symbols.get(declarationIdentity(item)) ?? []
            ) ?? [];
          if (targets.length)
            references?.set(node.text, [
              ...(references.get(node.text) ?? []),
              ...targets,
            ]);
          else if (
            target?.declarations?.length &&
            target.declarations.every((item) =>
              item.getSourceFile().fileName.includes('/node_modules/')
            )
          )
            externals.add(node.text);
          for (const definition of target?.declarations ?? []) {
            if (
              visitedDeclarations.has(definition) ||
              definition.getSourceFile().fileName.includes('/node_modules/')
            )
              continue;
            visitedDeclarations.add(definition);
            // Declaration emit may expand aliases (for example a signal input
            // containing Record<string, RenderViewEntry>). Follow their checked
            // type syntax, including an authored function's return annotation.
            if (ts.isTypeAliasDeclaration(definition)) walk(definition.type);
            else if (
              (ts.isFunctionDeclaration(definition) ||
                ts.isMethodDeclaration(definition)) &&
              definition.type
            )
              walk(definition.type);
          }
        }
        ts.forEachChild(node, walk);
      };
      walk(declaration);
      const visitedTypes = new Set<ts.Type>();
      const visitType = (type: ts.Type, depth: number): void => {
        if (visitedTypes.has(type) || depth > 8 || visitedTypes.size > 300)
          return;
        visitedTypes.add(type);
        for (const target of [type.getSymbol(), type.aliasSymbol]) {
          if (!target) continue;
          const targets =
            target.declarations?.flatMap(
              (item) => sources.symbols.get(declarationIdentity(item)) ?? []
            ) ?? [];
          if (targets.length)
            references?.set(target.name, [
              ...(references.get(target.name) ?? []),
              ...targets,
            ]);
          else if (
            target.declarations?.length &&
            target.declarations.every((item) =>
              item.getSourceFile().fileName.includes('/node_modules/')
            )
          )
            externals.add(target.name);
        }
        if (type.isUnionOrIntersection())
          type.types.forEach((child) => visitType(child, depth + 1));
        type.aliasTypeArguments?.forEach((child) =>
          visitType(child, depth + 1)
        );
        if (
          type.flags & ts.TypeFlags.Object &&
          (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference
        )
          checker
            .getTypeArguments(type as ts.TypeReference)
            .forEach((child) => visitType(child, depth + 1));
        checker
          .getIndexInfosOfType(type)
          .forEach((info) => visitType(info.type, depth + 1));
        const target = type.getSymbol();
        if (
          !target ||
          target.declarations?.some(
            (item) => !item.getSourceFile().fileName.includes('/node_modules/')
          )
        ) {
          checker
            .getPropertiesOfType(type)
            .forEach((property) =>
              visitType(
                checker.getTypeOfSymbolAtLocation(property, declaration),
                depth + 1
              )
            );
        }
      };
      visitType(checker.getTypeAtLocation(declaration), 0);
      originReferences.set(declaration, references);
    }
    const candidates = references.get(text);
    const exactName = candidates?.filter((symbol) => symbol.name === text);
    return choose(exactName?.length ? exactName : candidates, current)?.href;
  };
  const resolve = (reference: string, current: string): string | undefined => {
    const direct = choose(canonical.get(reference), current);
    if (direct) return direct.href;
    const normalized = reference.replace(/\s/g, '');
    const target = choose(names.get(normalized), current);
    if (target) return target.href;
    const parts = normalized.split('.');
    for (let cut = parts.length - 1; cut > 0; cut--) {
      const owner = choose(names.get(parts.slice(0, cut).join('.')), current);
      if (!owner) continue;
      const path = parts.slice(cut);
      let members = owner.declarations.flatMap(
        (declaration) => declaration.members
      );
      let href = owner.href;
      for (const part of path) {
        const index = members.findIndex((member) => member.name === part);
        if (index < 0) return undefined;
        const member = members[index];
        href = `${owner.href}#${apiMemberAnchor(member, index)}`;
        members = member.members;
      }
      return href;
    }
    const match = normalized.match(/^(.+)!([^:]+)(?::(.+))?$/);
    if (match) {
      const [, , name] = match;
      const candidates = names
        .get(name)
        ?.filter(
          (symbol) =>
            entries.find((entry) => entry.id === symbol.entrypointId)
              ?.packageName === match[1]
        );
      return choose(candidates, current)?.href;
    }
    return undefined;
  };
  const docs = (value: string, current: string): string =>
    value.replace(
      /\{@link\s+([^}|]+)(?:\|\s*([^}]+))?\}/g,
      (_whole, rawTarget: string, rawLabel?: string) => {
        const target = rawTarget.trim();
        const label = rawLabel?.trim() ?? target;
        if (/^https?:\/\//i.test(target)) return `[${label}](${target})`;
        const href = resolve(target, current);
        if (href) return `[${label}](${href})`;
        if (
          target.startsWith('@threadplane/') ||
          names.has(target.split('.')[0])
        )
          throw new Error(
            `Unresolved SDK documentation link in ${current}: ${target}`
          );
        return label;
      }
    );
  for (const symbol of symbols) {
    const walk = (member: ApiMember): void => {
      member.excerptTokens.forEach((token: ApiToken) => {
        if (!token.canonicalReference) return;
        const href =
          resolveOrigin(member, token.text, symbol.entrypointId) ??
          resolve(token.canonicalReference, symbol.entrypointId);
        if (href) token.href = href;
        else {
          const localName =
            token.canonicalReference.match(/!~?([^:#.(]+)/)?.[1];
          const origin = sources.origins.get(member);
          const external =
            origin?.getSourceFile().fileName.includes('/node_modules/') ||
            (origin && externalReferences.get(origin)?.has(token.text));
          if (
            !external &&
            token.canonicalReference.startsWith('@threadplane/') &&
            localName &&
            names.has(localName)
          )
            throw new Error(
              `Unresolved documented API reference ${
                token.canonicalReference
              } in ${symbol.entrypointId}#${symbol.name} at ${JSON.stringify(
                member.source
              )}`
            );
        }
      });
      for (const key of [
        'summary',
        'remarks',
        'deprecated',
        'returns',
      ] as const)
        member.docs[key] = docs(member.docs[key], symbol.entrypointId);
      for (const key of ['examples', 'see'] as const)
        member.docs[key] = member.docs[key].map((value) =>
          docs(value, symbol.entrypointId)
        );
      for (const key of ['params', 'typeParams'] as const)
        member.docs[key].forEach(
          (item) =>
            (item.description = docs(item.description, symbol.entrypointId))
        );
      member.members.forEach(walk);
    };
    symbol.declarations.forEach(walk);
    symbol.summary = apiSummary(symbol.declarations);
  }
}
export function directoryFiles(directory: string, base = directory): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((item) =>
      item.isDirectory()
        ? directoryFiles(path.join(directory, item.name), base)
        : [
            path
              .relative(base, path.join(directory, item.name))
              .split(path.sep)
              .join('/'),
          ]
    )
    .sort();
}
function publish(staged: string, output: string, check: boolean): void {
  const expected = directoryFiles(staged);
  const existing = directoryFiles(output);
  if (check) {
    const changes = [...new Set([...expected, ...existing])]
      .sort()
      .filter(
        (file) =>
          !expected.includes(file) ||
          !existing.includes(file) ||
          !fs
            .readFileSync(path.join(staged, file))
            .equals(fs.readFileSync(path.join(output, file)))
      );
    if (changes.length)
      throw new Error(`API reference output is stale:\n${changes.join('\n')}`);
    return;
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const next = `${output}.next-${process.pid}`;
  const previous = `${output}.previous-${process.pid}`;
  fs.rmSync(next, { recursive: true, force: true });
  fs.cpSync(staged, next, { recursive: true });
  if (fs.existsSync(output)) fs.renameSync(output, previous);
  try {
    fs.renameSync(next, output);
  } catch (error) {
    if (fs.existsSync(previous)) fs.renameSync(previous, output);
    throw error;
  }
  fs.rmSync(previous, { recursive: true, force: true });
}
export async function generateApiReference(
  options: GenerateOptions
): Promise<ApiIndex> {
  const root = path.resolve(options.root);
  const entries = options.entrypoints ?? SDK_ENTRYPOINTS;
  if (options.validate !== false) validateRegistry(root, entries);
  const tempRoot = path.join(root, 'tmp/api-reference');
  fs.mkdirSync(tempRoot, { recursive: true });
  const staging = fs.mkdtempSync(path.join(tempRoot, 'generation-'));
  try {
    const program = compile(root, entries, staging);
    console.log(`Checked API declarations: ${entries.length} entrypoints`);
    const context: ExtractionContext = { diagnostics: new Set() };
    const sources: SourceRegistry = {
      origins: new WeakMap(),
      symbols: new Map(),
    };
    const symbols = entries.flatMap((entry) => {
      const raw = extract(root, entry, entries, staging, context);
      // API Extractor chooses a single name when the same declaration is exported
      // twice. Extract the alias in isolation to preserve its actual excerpt/model.
      for (const [name, declarations] of exportedDeclarations(
        program,
        path.join(root, entry.source)
      )) {
        if (
          !name.startsWith('ɵ') &&
          declarations.some(isPublicDeclaration) &&
          !raw.some((item) => item.name === name)
        ) {
          const bundled = declarations.flatMap((declaration) => {
            const parts = declaration
              .getSourceFile()
              .fileName.split('/node_modules/');
            const packagePath =
              parts.length > 1 ? parts[parts.length - 1].split('/') : [];
            return packagePath.length
              ? [
                  packagePath[0].startsWith('@')
                    ? packagePath.slice(0, 2).join('/')
                    : packagePath[0],
                ]
              : [];
          });
          raw.push(
            ...extract(root, entry, entries, staging, context, name, [
              ...new Set(bundled),
            ])
          );
        }
      }
      return symbolsFor(entry, raw, root, program, sources);
    });
    resolveLinks(symbols, entries, program, sources);
    const hrefs = new Set<string>();
    for (const symbol of symbols) {
      if (hrefs.has(symbol.href))
        throw new Error(`Duplicate API URL: ${symbol.href}`);
      hrefs.add(symbol.href);
    }
    const index: ApiIndex = {
      schemaVersion: 1,
      entrypoints: entries.map((entry) => ({
        id: entry.id,
        importPath: entry.importPath,
        packageName: entry.packageName,
        project: entry.project,
        framework: entry.framework,
        version: entry.version,
        status: entry.status,
        docLibrary: entry.docLibrary,
      })),
      symbols: symbols.map((symbol) => ({
        name: symbol.name,
        entrypointId: symbol.entrypointId,
        kind: symbol.kind,
        href: symbol.href,
        canonicalReference: symbol.canonicalReference,
        isDeprecated: symbol.isDeprecated,
        isTypeOnly: symbol.isTypeOnly,
        summary: symbol.summary,
      })),
      undocumented: symbols
        .filter((symbol) => !symbol.summary)
        .map((symbol) => `${symbol.entrypointId}#${symbol.name}`)
        .sort(),
    };
    const output = path.join(staging, 'output');
    fs.mkdirSync(output);
    const write = (file: string, value: unknown) => {
      const content = `${JSON.stringify(value, null, 2)}\n`;
      assertPublicDocOutput(file, content);
      fs.mkdirSync(path.dirname(path.join(output, file)), { recursive: true });
      fs.writeFileSync(path.join(output, file), content);
    };
    write('index.json', index);
    write('entrypoints.json', index.entrypoints);
    const outputPaths = new Set<string>(['index.json', 'entrypoints.json']);
    for (const symbol of symbols) {
      const file = `${symbol.entrypointId}/${apiSymbolFileName(symbol.name)}`;
      const identity = file.toLowerCase();
      if (outputPaths.has(identity))
        throw new Error(`API output path collision: ${file}`);
      outputPaths.add(identity);
      write(file, symbol);
    }
    publish(
      output,
      options.output ?? path.join(root, 'apps/website/content/api'),
      options.check ?? false
    );
    console.log(
      `API reference: ${entries.length} entrypoints, ${
        symbols.length
      } symbols, ${index.undocumented.length} missing summaries${
        options.check ? ' (checked)' : ''
      }`
    );
    return index;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
