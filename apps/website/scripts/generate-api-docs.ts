/* eslint-disable @typescript-eslint/no-explicit-any -- TypeDoc reflection API is untyped */
import { Application, TSConfigReader, ReflectionKind } from 'typedoc';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'node:url';
import {
  assertPublicDocOutput,
  projectPublicDocEntries,
} from './public-doc-projection';

interface ApiParam {
  name: string;
  type: string;
  description: string;
  optional?: boolean;
}

interface ApiMethod {
  name: string;
  signature: string;
  description: string;
  params?: ApiParam[];
}

interface ApiDocEntry {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'const';
  description: string;
  signature?: string;
  params?: ApiParam[];
  returns?: { type: string; description: string };
  examples?: string[];
  properties?: ApiParam[];
  methods?: ApiMethod[];
}

function extractDescription(comment: any): string {
  if (!comment?.summary) return '';
  return comment.summary.map((p: any) => p.text ?? '').join('').trim();
}

function extractExamples(comment: any): string[] {
  if (!comment?.blockTags) return [];
  return comment.blockTags
    .filter((t: any) => t.tag === '@example')
    .map((t: any) => t.content.map((c: any) => c.text ?? '').join('').trim());
}

function isInternalReflection(ref: any): boolean {
  if (typeof ref?.name === 'string' && ref.name.startsWith('ɵ')) return true;
  const modifierTags = ref?.comment?.modifierTags;
  if (
    modifierTags !== undefined &&
    typeof modifierTags.has === 'function' &&
    modifierTags.has('@internal')
  ) return true;
  // TypeDoc attaches callable comments to signatures rather than declarations.
  // A private overload must not hide public siblings on the same declaration.
  return !!ref?.signatures?.length && ref.signatures.every(isInternalReflection);
}

function firstPublicSignature(ref: any): any {
  return ref?.signatures?.find((sig: any) => !isInternalReflection(sig));
}

/** Renders a single parameter for a signature string, preserving rest (`...`) syntax. */
function paramToSigString(p: any): string {
  return `${p.flags?.isRest ? '...' : ''}${p.name}: ${extractType(p.type)}`;
}

/** Builds a `(a: A, ...rest: B[]): R` signature body from a TypeDoc signature reflection. */
function signatureToString(name: string, sig: any): string {
  const params = (sig?.parameters ?? []).map(paramToSigString).join(', ');
  const ret = sig?.type ? `: ${extractType(sig.type)}` : '';
  return `${name}(${params})${ret}`;
}

function extractType(typeObj: any): string {
  if (!typeObj) return 'unknown';
  if (typeObj.type === 'intrinsic') return typeObj.name;
  if (typeObj.type === 'reference') return typeObj.name + (typeObj.typeArguments ? `<${typeObj.typeArguments.map(extractType).join(', ')}>` : '');
  if (typeObj.type === 'union') return typeObj.types.map(extractType).join(' | ');
  if (typeObj.type === 'literal') return JSON.stringify(typeObj.value);
  if (typeObj.type === 'reflection') {
    // Function-typed property/value: render its call signature, e.g. `(event: RenderEvent) => void`.
    const sig = firstPublicSignature(typeObj.declaration);
    if (sig) {
      const params = (sig.parameters ?? []).map(paramToSigString).join(', ');
      return `(${params}) => ${extractType(sig.type)}`;
    }
    return 'object';
  }
  if (typeObj.type === 'array') return `${extractType(typeObj.elementType)}[]`;
  return typeObj.toString?.() ?? 'unknown';
}

function extractParams(sig: any): ApiParam[] {
  if (!sig?.parameters) return [];
  return sig.parameters
    .filter((p: any) => !isInternalReflection(p))
    .map((p: any) => ({
      name: `${p.flags?.isRest ? '...' : ''}${p.name}`,
      type: extractType(p.type),
      description: extractDescription(p.comment),
      // A parameter is optional if explicitly marked `?` OR it has a default
      // value (e.g. `opts: MockAgentOptions = {}`) — TypeDoc only sets the
      // `isOptional` flag for the former, so check `defaultValue` for the latter.
      optional:
        (p.flags?.isOptional ?? false) || p.defaultValue !== undefined,
    }));
}

function reflectionToEntry(ref: any): ApiDocEntry | null {
  const kind = ref.kind;
  const desc = extractDescription(ref.comment);
  const examples = extractExamples(ref.comment);

  if (kind === ReflectionKind.Function) {
    const sig = firstPublicSignature(ref);
    return {
      name: ref.name,
      kind: 'function',
      description: desc || extractDescription(sig?.comment),
      signature: sig ? signatureToString(ref.name, sig) : ref.name,
      params: extractParams(sig),
      returns: sig?.type ? { type: extractType(sig.type), description: '' } : undefined,
      examples: examples.length ? examples : extractExamples(sig?.comment),
    };
  }

  if (kind === ReflectionKind.Class) {
    const props = (ref.children ?? [])
      .filter(
        (c: any) =>
          c.kind === ReflectionKind.Property && !isInternalReflection(c)
      )
      .map((c: any) => ({ name: c.name, type: extractType(c.type), description: extractDescription(c.comment), optional: c.flags?.isOptional }));
    const methods = (ref.children ?? [])
      .filter(
        (c: any) =>
          c.kind === ReflectionKind.Method && !isInternalReflection(c)
      )
      .map((c: any) => {
        const sig = firstPublicSignature(c);
        return { name: c.name, signature: signatureToString(c.name, sig), description: extractDescription(c.comment) || extractDescription(sig?.comment), params: extractParams(sig) };
      });
    const ctorSig = firstPublicSignature((ref.children ?? []).find((c: any) => c.kind === ReflectionKind.Constructor));
    return {
      name: ref.name,
      kind: 'class',
      description: desc,
      params: ctorSig ? extractParams(ctorSig) : undefined,
      examples,
      properties: props,
      methods,
    };
  }

  if (kind === ReflectionKind.Interface) {
    const children = ref.children ?? [];
    const props = children
      .filter(
        (c: any) =>
          c.kind !== ReflectionKind.Method && !isInternalReflection(c)
      )
      .map((c: any) => ({
        name: c.name,
        type: extractType(c.type),
        description: extractDescription(c.comment),
        optional: c.flags?.isOptional,
      }));
    const methods = children
      .filter(
        (c: any) =>
          c.kind === ReflectionKind.Method && !isInternalReflection(c)
      )
      .map((c: any) => {
        const sig = firstPublicSignature(c);
        return {
          name: c.name,
          signature: signatureToString(c.name, sig),
          description: extractDescription(c.comment) || extractDescription(sig?.comment),
          params: extractParams(sig),
        };
      });
    return { name: ref.name, kind: 'interface', description: desc, properties: props, methods: methods.length ? methods : undefined, examples };
  }

  if (kind === ReflectionKind.TypeAlias) {
    return { name: ref.name, kind: 'type', description: desc, signature: extractType(ref.type), examples };
  }

  if (kind === ReflectionKind.Variable) {
    return { name: ref.name, kind: 'const', description: desc, signature: extractType(ref.type), examples };
  }

  return null;
}

/** Convert exported reflections into the website's public API entries. */
export function collectApiEntries(reflections: any[]): ApiDocEntry[] {
  return reflections.flatMap((ref) => {
    if (isInternalReflection(ref)) return [];
    const entry = reflectionToEntry(ref);
    if (entry) return [entry];
    return collectApiEntries(ref.children ?? []);
  });
}

interface LibraryEntryConfig {
  /** Doc-site library slug (e.g. 'agent', 'chat') — used as the output folder under apps/website/content/docs/. */
  docSlug: string;
  /** TypeDoc entry points — usually libs/<name>/src/public-api.ts. */
  entryPoints: string[];
  /** Optional TypeScript config override when a package has multiple published entrypoint groups. */
  tsconfig?: string;
}

const LIBRARIES: LibraryEntryConfig[] = [
  { docSlug: 'langgraph', entryPoints: ['libs/langgraph/src/public-api.ts'] },
  { docSlug: 'chat',      entryPoints: ['libs/chat/src/public-api.ts', 'libs/chat/testing/public-api.ts'] },
  { docSlug: 'render',    entryPoints: ['libs/render/src/public-api.ts'] },
  { docSlug: 'ag-ui',     entryPoints: ['libs/ag-ui/src/public-api.ts'] },
  { docSlug: 'a2ui',      entryPoints: ['libs/a2ui/src/index.ts'] },
  { docSlug: 'middleware', entryPoints: ['libs/middleware/src/langgraph/index.ts'] },
];

async function generateForLibrary(cfg: LibraryEntryConfig): Promise<void> {
  const outDir = `apps/website/content/docs/${cfg.docSlug}/api`;
  const missingEntryPoints = cfg.entryPoints.filter((entryPoint) => !fs.existsSync(entryPoint));
  if (missingEntryPoints.length > 0) {
    console.warn(`Entry point not found for ${cfg.docSlug}: ${missingEntryPoints.join(', ')} — writing empty api-docs.json`);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'api-docs.json'), JSON.stringify([], null, 2));
    return;
  }

  const libDir = findPackageRoot(cfg.entryPoints[0]);
  const libTsconfig = cfg.tsconfig ?? (fs.existsSync(path.join(libDir, 'tsconfig.lib.json'))
    ? path.join(libDir, 'tsconfig.lib.json')
    : undefined);

  const app = await Application.bootstrapWithPlugins({
    entryPoints: cfg.entryPoints,
    skipErrorChecking: true,
    ...(libTsconfig ? { tsconfig: libTsconfig } : {}),
  });
  app.options.addReader(new TSConfigReader());
  const project = await app.convert();
  if (!project) throw new Error(`TypeDoc failed to convert ${cfg.docSlug}`);

  const entries = collectApiEntries(project.children ?? []);

  // TSDoc is written as code comments but published as copy. Fail on the raw
  // entries first: a barred claim in a doc comment also ships in the .d.ts and
  // in every IDE tooltip, and the projection below cannot reach either. Silently
  // cleaning the website would hide the claim rather than remove it, so the
  // author is sent back to the source.
  assertPublicDocOutput(`${cfg.docSlug} (source TSDoc)`, JSON.stringify(entries));

  // Then project and check again, so anything the patterns above phrase
  // differently still cannot reach the published file.
  const publicEntries = projectPublicDocEntries(entries);
  const serialized = JSON.stringify(publicEntries, null, 2);
  assertPublicDocOutput(cfg.docSlug, serialized);

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'api-docs.json'), serialized);
  console.log(`✓ ${cfg.docSlug}/api/api-docs.json (${publicEntries.length} entries)`);
}

function findPackageRoot(entryPoint: string): string {
  let dir = path.dirname(entryPoint);
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return path.dirname(path.dirname(entryPoint));
}

function selectedLibrarySlugs(args: readonly string[]): ReadonlySet<string> | null {
  const flags = args.filter((arg) => arg.startsWith('--libraries='));
  if (flags.length === 0) return null;
  if (flags.length !== 1) throw new Error('Pass --libraries at most once');
  const selected = new Set(
    flags[0]
      .slice('--libraries='.length)
      .split(',')
      .map((slug) => slug.trim())
      .filter(Boolean)
  );
  const known = new Set(LIBRARIES.map((library) => library.docSlug));
  const unknown = [...selected].filter((slug) => !known.has(slug));
  if (selected.size === 0 || unknown.length > 0) {
    throw new Error(
      `Unknown or empty API-doc library selection: ${unknown.join(', ')}`
    );
  }
  return selected;
}

async function main() {
  const selected = selectedLibrarySlugs(process.argv.slice(2));
  for (const cfg of LIBRARIES) {
    if (selected !== null && !selected.has(cfg.docSlug)) continue;
    await generateForLibrary(cfg);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
