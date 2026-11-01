import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveWebsiteDir } from './website-dir';
import {
  apiSymbolHref,
  apiSymbolFileName,
  apiDeclarationTokens,
  type ApiEntrypoint,
  type ApiIndex,
  type ApiMember,
  type ApiSource,
  type ApiSymbol,
  type ApiSymbolSummary,
} from './api-reference-model';

const referenceRoot = () => join(resolveWebsiteDir(), 'content', 'api');
const indexCache = new Map<string, { fingerprint: string; index: ApiIndex }>();

/** Load the generated index; missing output is a build error, not an empty API. */
export function readApiIndex(root = referenceRoot()): ApiIndex {
  const file = join(root, 'index.json');
  const stat = statSync(file);
  const fingerprint = `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  const cached = indexCache.get(root);
  if (cached?.fingerprint === fingerprint) return cached.index;
  const index = JSON.parse(readFileSync(file, 'utf8')) as ApiIndex;
  if (
    index.schemaVersion !== 1 ||
    !Array.isArray(index.entrypoints) ||
    !Array.isArray(index.symbols)
  ) {
    throw new Error(
      'Invalid API reference index. Run npm run generate-api-docs.'
    );
  }
  indexCache.set(root, { fingerprint, index });
  return index;
}

/** Only read symbol files present in the generated registry. */
export function readApiSymbol(
  entrypointId: string,
  name: string,
  root = referenceRoot()
): ApiSymbol | null {
  let href: string;
  try {
    href = apiSymbolHref(entrypointId, name);
  } catch {
    return null;
  }
  const summary = readApiIndex(root).symbols.find(
    (symbol) => symbol.href === href
  );
  if (!summary) return null;
  const file = join(
    root,
    ...summary.entrypointId.split('/'),
    apiSymbolFileName(summary.name)
  );
  if (!existsSync(file))
    throw new Error(`Missing generated API symbol: ${href}`);
  const symbol = JSON.parse(readFileSync(file, 'utf8')) as ApiSymbol;
  if (symbol.href !== href || !Array.isArray(symbol.declarations))
    throw new Error(`Invalid generated API symbol: ${href}`);
  return symbol;
}

export type ApiPage =
  | { kind: 'index'; entrypoint?: ApiEntrypoint }
  | { kind: 'symbol'; entrypoint: ApiEntrypoint; symbol: ApiSymbolSummary };

/** Resolve explicit package URLs without conflating names across import paths. */
export function resolveApiPage(
  segments: readonly string[],
  index: ApiIndex
): ApiPage | null {
  if (segments.length === 0) return { kind: 'index' };
  const entrypoint = index.entrypoints.find(
    (entry) => entry.id === segments.join('/')
  );
  if (entrypoint) return { kind: 'index', entrypoint };
  const name = segments[segments.length - 1];
  const owner = index.entrypoints.find(
    (entry) => entry.id === segments.slice(0, -1).join('/')
  );
  if (!owner) return null;
  const symbol = index.symbols.find(
    (item) => item.entrypointId === owner.id && item.name === name
  );
  return symbol ? { kind: 'symbol', entrypoint: owner, symbol } : null;
}

/** Revision URLs are computed at render time to keep generated data stable. */
export function apiSourceUrl(
  source: ApiSource | undefined,
  revision = process.env.THREADPLANE_DOCS_BUILD_REVISION
): string | null {
  if (
    !source ||
    source.path.startsWith('node_modules/') ||
    !/^[a-f0-9]{40}$/u.test(revision ?? '') ||
    source.line < 1 ||
    source.path.startsWith('/') ||
    source.path.split(/[\\/]/u).some((part) => part === '..' || part === '.')
  )
    return null;
  return `https://github.com/cacheplane/threadplane/blob/${revision}/${source.path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}#L${source.line}`;
}

/** A copyable import reflects whether this is an exclusively type declaration. */
export function apiImport(
  symbol: ApiSymbolSummary,
  entrypoint: ApiEntrypoint
): string {
  const name = symbol.name.split('.')[0];
  const typeOnly =
    symbol.isTypeOnly ?? ['Interface', 'TypeAlias'].includes(symbol.kind);
  return `import ${typeOnly ? 'type ' : ''}{ ${name} } from '${
    entrypoint.importPath
  }';`;
}

/** Preserve extracted excerpts; container punctuation adds no invented types. */
export function apiMemberCode(member: ApiMember): string {
  return apiDeclarationTokens(member)
    .map((token) => token.text)
    .join('')
    .trim();
}

function memberMarkdown(member: ApiMember, depth = 2): string {
  const docs = member.docs;
  return [
    `${'#'.repeat(Math.min(depth, 6))} ${member.name}${
      member.overloadIndex ? ` · overload ${member.overloadIndex}` : ''
    }`,
    docs.summary,
    docs.deprecated && `**Deprecated:** ${docs.deprecated}`,
    `\`\`\`typescript\n${apiMemberCode(member)}\n\`\`\``,
    ...docs.typeParams.map(
      (param) => `- Type parameter **${param.name}**: ${param.description}`
    ),
    ...docs.params.map((param) => `- **${param.name}**: ${param.description}`),
    docs.returns && `**Returns:** ${docs.returns}`,
    docs.remarks,
    member.angular && `**Angular selector:** \`${member.angular.selector}\``,
    ...(member.angular?.inputs ?? []).map(
      (input) =>
        `- Input \`${input.alias}\`${input.required ? ' (required)' : ''}: \`${
          input.type
        }\``
    ),
    ...(member.angular?.outputs ?? []).map(
      (output) => `- Output \`${output.alias}\`: \`${output.type}\``
    ),
    ...docs.examples,
    ...docs.see.map((see) => `See also: ${see}`),
    ...member.members.map((child) => memberMarkdown(child, depth + 1)),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Markdown, LLM context and browser pages all consume the same declarations. */
export function apiSymbolMarkdown(
  symbol: ApiSymbol,
  entrypoint: ApiEntrypoint
): string {
  return [
    `# ${symbol.name}`,
    `Package: \`${entrypoint.importPath}\` · ${entrypoint.version}`,
    entrypoint.status === 'development'
      ? '**Unpublished development API.**'
      : '',
    `Reference: ${symbol.href}`,
    `\`\`\`typescript\n${apiImport(symbol, entrypoint)}\n\`\`\``,
    ...symbol.declarations.map((member) => memberMarkdown(member)),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Package and top-level Markdown indexes use the same generated destinations. */
export function apiIndexMarkdown(
  index: ApiIndex,
  entrypoint?: ApiEntrypoint
): string {
  const entries = entrypoint ? [entrypoint] : index.entrypoints;
  return [
    '# API Reference',
    ...entries.map((entry) =>
      [
        `## ${entry.importPath}`,
        entry.status === 'development'
          ? '**Unpublished development API.**'
          : `Version: ${entry.version}`,
        ...index.symbols
          .filter((symbol) => symbol.entrypointId === entry.id)
          .map(
            (symbol) =>
              `- [${symbol.name}](${symbol.href}) — ${symbol.kind}${
                symbol.isDeprecated ? ' (deprecated)' : ''
              }`
          ),
      ].join('\n\n')
    ),
  ].join('\n\n');
}

/** All generated destinations, including package indexes and namespace pages. */
export function apiPagePaths(index: ApiIndex): string[] {
  return [
    '/docs/api',
    ...index.entrypoints.map((entry) => apiSymbolHref(entry.id)),
    ...index.symbols.map((symbol) => symbol.href),
  ];
}
