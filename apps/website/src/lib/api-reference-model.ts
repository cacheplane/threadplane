/** Browser-safe contract shared by API Extractor generation and the website. */
export type ApiFramework = 'angular' | 'react' | 'shared' | 'backend';

export interface ApiEntrypoint {
  id: string;
  importPath: string;
  packageName: string;
  project: string;
  framework: ApiFramework;
  version: string;
  status: 'published' | 'development';
  docLibrary?: string;
}

export interface ApiToken {
  kind: 'Content' | 'Reference';
  text: string;
  canonicalReference?: string;
  /** Only assigned after all entrypoints have been extracted and indexed. */
  href?: string;
}

export interface ApiTokenRange {
  startIndex: number;
  endIndex: number;
}
export interface ApiDocs {
  summary: string;
  remarks: string;
  deprecated: string;
  returns: string;
  examples: string[];
  see: string[];
  params: { name: string; description: string }[];
  typeParams: { name: string; description: string }[];
}

export interface ApiSource {
  path: string;
  line: number;
}
export interface ApiBinding {
  name: string;
  alias: string;
  required: boolean;
  type: string;
}
export interface ApiAngularMetadata {
  selector: string;
  inputs: ApiBinding[];
  outputs: ApiBinding[];
}

/** API Extractor declaration excerpts remain verbatim, including overloads. */
export interface ApiMember {
  name: string;
  kind: string;
  canonicalReference: string;
  excerptTokens: ApiToken[];
  docs: ApiDocs;
  members: ApiMember[];
  overloadIndex?: number;
  isStatic?: boolean;
  isReadonly?: boolean;
  isOptional?: boolean;
  parameters?: {
    parameterName: string;
    isOptional: boolean;
    parameterTypeTokenRange: ApiTokenRange;
  }[];
  typeParameters?: {
    typeParameterName: string;
    constraintTokenRange: ApiTokenRange;
    defaultTypeTokenRange: ApiTokenRange;
  }[];
  returnTypeTokenRange?: ApiTokenRange;
  typeTokenRange?: ApiTokenRange;
  variableTypeTokenRange?: ApiTokenRange;
  source?: ApiSource;
  angular?: ApiAngularMetadata;
}

export interface ApiSymbolSummary {
  name: string;
  entrypointId: string;
  kind: string;
  href: string;
  canonicalReference: string;
  isDeprecated: boolean;
  summary: string;
  isTypeOnly?: boolean;
}
export interface ApiSymbol extends ApiSymbolSummary {
  declarations: ApiMember[];
  source?: ApiSource;
}
export interface ApiIndex {
  schemaVersion: 1;
  entrypoints: ApiEntrypoint[];
  symbols: ApiSymbolSummary[];
  /** Missing source summaries are reported honestly, never filled by a model. */
  undocumented: string[];
}

/** Merged declarations can document a later value or overload. */
export function apiSummary(declarations: readonly ApiMember[]): string {
  return (
    declarations.find((declaration) => declaration.docs.summary.trim())?.docs
      .summary ?? ''
  );
}

/** Container punctuation is shared by browser and Markdown renderers. */
export function apiDeclarationTokens(member: ApiMember): ApiToken[] {
  if (!['Class', 'Interface', 'Enum', 'Namespace'].includes(member.kind))
    return member.excerptTokens;
  return [
    ...member.excerptTokens,
    { kind: 'Content', text: ' {\n' },
    ...member.members.flatMap((child) => [
      { kind: 'Content' as const, text: '  ' },
      ...apiDeclarationTokens(child),
      { kind: 'Content' as const, text: member.kind === 'Enum' ? ',\n' : '\n' },
    ]),
    { kind: 'Content', text: '}' },
  ];
}

/** Stable import-path-qualified URL; names retain their exact exported case. */
export function apiSymbolHref(entrypointId: string, name?: string): string {
  const segments = entrypointId.split('/');
  if (name !== undefined) segments.push(name);
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === '.' ||
        segment === '..' ||
        /[\\/]/u.test(segment) ||
        segment.includes(String.fromCharCode(0))
    )
  ) {
    throw new Error(
      `Invalid API reference identity: ${entrypointId}/${name ?? ''}`
    );
  }
  return `/docs/api/${segments.map(encodeURIComponent).join('/')}`;
}

/** Member identity includes scope and overload to avoid duplicate HTML ids. */
function identityHash(value: string): string {
  let hash = 2166136261;
  for (const character of value)
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}

/** Case-sensitive export identities also work on case-insensitive filesystems. */
export function apiSymbolFileName(name: string): string {
  return `${encodeURIComponent(name)}-${identityHash(name)}.json`;
}

/** Member identity includes scope and overload to avoid duplicate HTML ids. */
export function apiMemberAnchor(
  member: { name: string; isStatic?: boolean; canonicalReference?: string },
  index: number
): string {
  return `${member.isStatic ? 'static' : 'member'}-${member.name.replace(
    /[^a-zA-Z0-9_-]/gu,
    '-'
  )}-${member.canonicalReference ? '' : `${index}-`}${identityHash(
    member.canonicalReference ?? member.name
  )}`;
}

/** Shared and backend entrypoints remain accessible alongside either frontend. */
export function filterApiSymbols<
  S extends Pick<ApiSymbolSummary, 'name' | 'kind' | 'entrypointId'>
>(
  symbols: readonly S[],
  entrypoints: readonly Pick<ApiEntrypoint, 'id' | 'framework'>[],
  filters: {
    query?: string;
    framework?: string;
    entrypoint?: string;
    kind?: string;
  }
): S[] {
  const query = filters.query?.trim().toLowerCase() ?? '';
  const frameworks = new Map(
    entrypoints.map((entry) => [entry.id, entry.framework])
  );
  return symbols.filter((symbol) => {
    const framework = frameworks.get(symbol.entrypointId);
    return (
      (!query ||
        `${symbol.name} @threadplane/${symbol.entrypointId}`
          .toLowerCase()
          .includes(query)) &&
      (!filters.entrypoint || symbol.entrypointId === filters.entrypoint) &&
      (!filters.kind || symbol.kind === filters.kind) &&
      (!filters.framework ||
        filters.framework === 'all' ||
        framework === filters.framework ||
        ((filters.framework === 'angular' || filters.framework === 'react') &&
          (framework === 'shared' || framework === 'backend')))
    );
  });
}
