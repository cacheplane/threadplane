import path from 'node:path';
import ts from 'typescript';
import type {
  ApiAngularMetadata,
  ApiBinding,
  ApiSource,
} from '../../src/lib/api-reference-model';

export function isPublicDeclaration(node: ts.Node): boolean {
  const name =
    'name' in node ? (node.name as ts.Node | undefined)?.getText() : '';
  if (name?.startsWith('ɵ')) return false;
  if (ts.getJSDocTags(node).some((tag) => tag.tagName.text === 'internal'))
    return false;
  const flags = ts.canHaveModifiers(node)
    ? ts.getCombinedModifierFlags(node as ts.Declaration)
    : 0;
  return !(flags & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected));
}
export function sourceLocation(
  root: string,
  declaration?: ts.Node
): ApiSource | undefined {
  if (!declaration) return undefined;
  const file = declaration.getSourceFile();
  const relative = path.relative(root, file.fileName).split(path.sep).join('/');
  if (relative.startsWith('../') || path.isAbsolute(relative))
    throw new Error(`API source outside workspace: ${file.fileName}`);
  return {
    path: relative,
    line:
      file.getLineAndCharacterOfPosition(declaration.getStart(file)).line + 1,
  };
}
export function exportedDeclarations(
  program: ts.Program,
  source: string
): Map<string, readonly ts.Declaration[]> {
  const checker = program.getTypeChecker();
  const file = program.getSourceFile(source);
  if (!file) throw new Error(`Missing checked entrypoint: ${source}`);
  const module = checker.getSymbolAtLocation(file);
  if (!module) throw new Error(`No exported module in ${source}`);
  return new Map(
    checker.getExportsOfModule(module).map((symbol) => {
      const target =
        symbol.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(symbol)
          : symbol;
      return [symbol.name, target.declarations ?? []];
    })
  );
}
/** The export site can restrict a value-bearing external declaration to types. */
export function isTypeOnlyExport(
  program: ts.Program,
  source: string,
  name: string,
  seen = new Set<string>()
): boolean {
  const key = `${source}#${name}`;
  if (seen.has(key)) return false;
  seen.add(key);
  const checker = program.getTypeChecker();
  const file = program.getSourceFile(source);
  if (!file) return false;
  for (const statement of file.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    const module =
      statement.moduleSpecifier &&
      checker.getSymbolAtLocation(statement.moduleSpecifier);
    const moduleFile = module?.declarations?.find(ts.isSourceFile);
    if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      const specifier = statement.exportClause.elements.find(
        (item) => item.name.text === name
      );
      if (!specifier) continue;
      if (statement.isTypeOnly || specifier.isTypeOnly) return true;
      if (moduleFile)
        return isTypeOnlyExport(
          program,
          moduleFile.fileName,
          (specifier.propertyName ?? specifier.name).text,
          seen
        );
      const imported = file.statements
        .filter(ts.isImportDeclaration)
        .flatMap((item) => {
          const bindings = item.importClause?.namedBindings;
          return bindings && ts.isNamedImports(bindings)
            ? bindings.elements.map((binding) => ({
                binding,
                clause: item.importClause,
              }))
            : [];
        })
        .find(
          (item) =>
            item.binding.name.text ===
            (specifier.propertyName ?? specifier.name).text
        );
      if (
        imported &&
        (imported.binding.isTypeOnly || imported.clause?.isTypeOnly)
      )
        return true;
    } else if (
      !statement.exportClause &&
      module &&
      moduleFile &&
      checker.getExportsOfModule(module).some((item) => item.name === name)
    ) {
      return (
        statement.isTypeOnly ||
        isTypeOnlyExport(program, moduleFile.fileName, name, seen)
      );
    }
  }
  const module = checker.getSymbolAtLocation(file);
  const exported =
    module &&
    checker.getExportsOfModule(module).find((symbol) => symbol.name === name);
  if (!exported) return false;
  const target =
    exported.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(exported)
      : exported;
  return !(target.flags & ts.SymbolFlags.Value);
}
export function memberDeclaration(
  declarations: readonly ts.Declaration[],
  name: string,
  index = 0,
  kind?: string
): ts.Declaration | undefined {
  const matches = declarations
    .flatMap((declaration) => {
      if ('members' in declaration)
        return [...(declaration.members as ts.NodeArray<ts.Declaration>)];
      if (
        ts.isModuleDeclaration(declaration) &&
        declaration.body &&
        ts.isModuleBlock(declaration.body)
      )
        return declaration.body.statements.flatMap((statement) =>
          ts.isVariableStatement(statement)
            ? [...statement.declarationList.declarations]
            : [statement as unknown as ts.Declaration]
        );
      return [];
    })
    .filter(
      (node) =>
        (kind === 'Constructor' && ts.isConstructorDeclaration(node)) ||
        (kind === 'CallSignature' && ts.isCallSignatureDeclaration(node)) ||
        (kind === 'ConstructSignature' &&
          ts.isConstructSignatureDeclaration(node)) ||
        (kind === 'IndexSignature' && ts.isIndexSignatureDeclaration(node)) ||
        ('name' in node &&
          (node.name as ts.Node | undefined)
            ?.getText()
            .replace(/^['"]|['"]$/g, '') === name)
    );
  return matches[index] ?? matches.find(isPublicDeclaration);
}
function objectValue(
  object: ts.ObjectLiteralExpression | undefined,
  key: string
): ts.Expression | undefined {
  const property = object?.properties.find(
    (prop) =>
      ts.isPropertyAssignment(prop) &&
      prop.name.getText().replace(/^['"]|['"]$/g, '') === key
  );
  return property && ts.isPropertyAssignment(property)
    ? property.initializer
    : undefined;
}
function textValue(expression?: ts.Expression): string | undefined {
  return expression && ts.isStringLiteralLike(expression)
    ? expression.text
    : undefined;
}
function bindingValueType(
  member: ts.ClassElement,
  checker: ts.TypeChecker
): string {
  const type = checker.getTypeAtLocation(member);
  const name = type.getSymbol()?.name ?? type.aliasSymbol?.name;
  const arguments_ =
    type.flags & ts.TypeFlags.Object &&
    (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference
      ? checker.getTypeArguments(type as ts.TypeReference)
      : type.aliasTypeArguments ?? [];
  const value =
    name === 'InputSignalWithTransform'
      ? arguments_[1]
      : [
          'InputSignal',
          'ModelSignal',
          'OutputEmitterRef',
          'EventEmitter',
        ].includes(name ?? '')
      ? arguments_[0]
      : undefined;
  return checker.typeToString(value ?? type);
}
function callName(expression: ts.Expression, checker: ts.TypeChecker): string {
  const leaf = ts.isPropertyAccessExpression(expression)
    ? expression.expression
    : expression;
  let symbol = checker.getSymbolAtLocation(leaf);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias)
    symbol = checker.getAliasedSymbol(symbol);
  return symbol?.name ?? leaf.getText();
}
export function angularMetadata(
  declaration: ts.Declaration | undefined,
  checker: ts.TypeChecker,
  seen = new Set<ts.Declaration>()
): ApiAngularMetadata | undefined {
  if (
    !declaration ||
    !ts.isClassDeclaration(declaration) ||
    seen.has(declaration)
  )
    return undefined;
  seen.add(declaration);
  let selector = '';
  const inputs = new Map<string, ApiBinding>();
  const outputs = new Map<string, ApiBinding>();
  for (const heritage of declaration.heritageClauses ?? []) {
    for (const type of heritage.types) {
      const base = checker
        .getTypeAtLocation(type)
        .symbol?.declarations?.find(ts.isClassDeclaration);
      const metadata = angularMetadata(base, checker, seen);
      if (metadata) {
        metadata.inputs.forEach((item) => inputs.set(item.name, item));
        metadata.outputs.forEach((item) => outputs.set(item.name, item));
      }
    }
  }
  for (const decorator of ts.canHaveDecorators(declaration)
    ? ts.getDecorators(declaration) ?? []
    : []) {
    if (!ts.isCallExpression(decorator.expression)) continue;
    const call = decorator.expression;
    if (
      !['Component', 'Directive'].includes(callName(call.expression, checker))
    )
      continue;
    const options =
      call.arguments[0] && ts.isObjectLiteralExpression(call.arguments[0])
        ? call.arguments[0]
        : undefined;
    selector = textValue(objectValue(options, 'selector')) ?? '';
    for (const [key, bindings] of [
      ['inputs', inputs],
      ['outputs', outputs],
    ] as const) {
      const values = objectValue(options, key);
      if (values && ts.isArrayLiteralExpression(values))
        for (const value of values.elements) {
          if (!ts.isStringLiteralLike(value)) continue;
          const [name, alias = name] = value.text
            .split(':')
            .map((part) => part.trim());
          const member = declaration.members.find(
            (node) => node.name?.getText() === name
          );
          bindings.set(name, {
            name,
            alias,
            required: false,
            type: member
              ? checker.typeToString(checker.getTypeAtLocation(member))
              : '',
          });
        }
    }
  }
  for (const member of declaration.members) {
    if (!isPublicDeclaration(member) || !member.name) continue;
    const name = member.name.getText().replace(/^['"]|['"]$/g, '');
    const type = bindingValueType(member, checker);
    if (
      ts.isPropertyDeclaration(member) &&
      member.initializer &&
      ts.isCallExpression(member.initializer)
    ) {
      const call = member.initializer;
      const factory = callName(call.expression, checker);
      if (
        ['input', 'model', 'output', 'outputFromObservable'].includes(factory)
      ) {
        const options = [...call.arguments]
          .reverse()
          .find(ts.isObjectLiteralExpression);
        const binding = {
          name,
          alias: textValue(objectValue(options, 'alias')) ?? name,
          required:
            ts.isPropertyAccessExpression(call.expression) &&
            call.expression.name.text === 'required',
          type,
        };
        (factory === 'output' || factory === 'outputFromObservable'
          ? outputs
          : inputs
        ).set(name, binding);
        if (factory === 'model')
          outputs.set(`${name}Change`, {
            ...binding,
            name: `${name}Change`,
            alias: `${binding.alias}Change`,
            required: false,
          });
      }
    }
    for (const decorator of ts.canHaveDecorators(member)
      ? ts.getDecorators(member) ?? []
      : []) {
      if (!ts.isCallExpression(decorator.expression)) continue;
      const call = decorator.expression;
      const factory = callName(call.expression, checker);
      if (!['Input', 'Output'].includes(factory)) continue;
      const options =
        call.arguments[0] && ts.isObjectLiteralExpression(call.arguments[0])
          ? call.arguments[0]
          : undefined;
      (factory === 'Input' ? inputs : outputs).set(name, {
        name,
        alias:
          textValue(call.arguments[0]) ??
          textValue(objectValue(options, 'alias')) ??
          name,
        required:
          objectValue(options, 'required')?.kind === ts.SyntaxKind.TrueKeyword,
        type,
      });
    }
  }
  return selector || inputs.size || outputs.size
    ? {
        selector,
        inputs: [...inputs.values()].sort((a, b) =>
          a.name.localeCompare(b.name)
        ),
        outputs: [...outputs.values()].sort((a, b) =>
          a.name.localeCompare(b.name)
        ),
      }
    : undefined;
}
