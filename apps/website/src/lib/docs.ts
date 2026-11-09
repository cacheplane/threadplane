import fs from 'fs';
import path from 'path';
import type { Metadata } from 'next';
import { type DocsPage, getLibraryConfig, specialDocsPages } from './docs-config';
import {
  getDocumentVariant,
  getNarrativeDocuments,
  resolveNarrativeDocument,
  type DocsScope,
  type DocumentVariant,
} from './docs-catalog';
import { clampMetaDescription, createPageMetadata } from './site-metadata';

const resolveContentDir = (): string => {
  const workspacePath = path.join(
    process.cwd(),
    'apps',
    'website',
    'content',
    'docs'
  );
  if (fs.existsSync(workspacePath)) return workspacePath;
  return path.join(process.cwd(), 'content', 'docs');
};

/** Fallback description for a docs page whose library declares none. */
export const DEFAULT_DOCS_DESCRIPTION = 'Threadplane documentation';

export interface ResolvedDoc {
  page: DocsPage;
  document: DocumentVariant;
  /** Raw file contents, frontmatter included — the description is read from it. */
  content: string;
  /** `content` with any frontmatter removed. This is what gets rendered. */
  body: string;
  title: string;
}

export type ResolvedDocMetadata = Metadata;

/**
 * A leading `---` fence and its closing partner. Matched as a whole block, then
 * searched for keys — the previous single pattern spliced the two together and
 * required a key to FOLLOW `description:`, so the last key in a block never
 * matched. Every real block in content/docs/ ends on `description:`.
 */
const FRONTMATTER_BLOCK_PATTERN = /^---\s*\n(?<body>[\s\S]*?)\n---\s*(?:\n|$)/;

/**
 * The value is captured whole and unquoted afterwards. Excluding quote
 * characters from the capture instead made every description containing a
 * possessive unreadable, so those pages fell back to their first paragraph.
 */
const FRONTMATTER_DESCRIPTION_PATTERN =
  /^description:[^\S\n]*(?<description>\S.*?)[^\S\n]*$/m;

function unquote(value: string): string {
  return (
    value.match(/^(?<quote>['"])(?<inner>.*)\k<quote>$/)?.groups?.inner ?? value
  );
}

/**
 * Remove a frontmatter block so the rest can be handed to the MDX pipeline.
 *
 * `next-mdx-remote` does not strip frontmatter unless asked, and Markdown reads
 * an unstripped block as an `<hr>` followed by a setext `<h2>` — a junk heading
 * above the page's real `<h1>`, in its table of contents and heading anchors.
 *
 * A body that merely opens with a thematic break is left alone: a leading `---`
 * is only frontmatter when a closing fence follows it.
 */
export function stripFrontmatter(source: string): string {
  return source.replace(FRONTMATTER_BLOCK_PATTERN, '');
}

/**
 * The `description` a page declares for itself, or `null` when it declares
 * none. Exported so the content guard can assert on the same parse the page
 * metadata uses rather than a second copy of these patterns.
 */
export function readFrontmatterDescription(content: string): string | null {
  const body = content.match(FRONTMATTER_BLOCK_PATTERN)?.groups?.body;
  if (!body) return null;
  const description = body.match(FRONTMATTER_DESCRIPTION_PATTERN)?.groups
    ?.description;
  return description ? unquote(description) : null;
}

function normalizeDescription(description: string): string {
  const value = description
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  let text = '';
  let spanStart = 0;
  let tagStart = -1;
  // Drop complete markup spans without a partial multi-character sanitizer.
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '<' && tagStart === -1) tagStart = index;
    else if (value[index] === '>' && tagStart !== -1) {
      text += value.slice(spanStart, tagStart);
      spanStart = index + 1;
      tagStart = -1;
    }
  }
  // Malformed or unmatched delimiters must not survive in plain metadata.
  return (text + value.slice(spanStart))
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractFirstParagraph(content: string): string | null {
  const withoutImports = stripFrontmatter(content).replace(
    /^import\s.+$/gm,
    ''
  );
  const paragraphs = withoutImports.split(/\n{2,}/);

  for (const paragraph of paragraphs) {
    const normalized = normalizeDescription(paragraph);
    if (
      normalized.length < 40 ||
      normalized.startsWith('#') ||
      normalized.startsWith('|') ||
      normalized.startsWith('```') ||
      normalized.startsWith('<')
    ) {
      continue;
    }

    return clampMetaDescription(normalized);
  }

  return null;
}

function getDocDescription(content: string, fallback: string): string {
  // Clamped here (not only in createPageMetadata) so the docs JSON-LD, which
  // reads this value directly, stays byte-identical to the meta description.
  const frontmatterDescription = readFrontmatterDescription(content);
  if (frontmatterDescription)
    return clampMetaDescription(normalizeDescription(frontmatterDescription));
  return extractFirstParagraph(content) ?? clampMetaDescription(fallback);
}

function readDocument(
  document: DocumentVariant | undefined
): ResolvedDoc | null {
  if (!document) return null;
  const filePath = path.join(resolveContentDir(), document.source);
  if (!fs.existsSync(filePath)) return null;

  const content = fs.readFileSync(filePath, 'utf8');
  const titleMatch = content.match(/^#\s+(.+)$/m);
  return {
    document,
    page: {
      title: document.title,
      section: document.section,
      slug: document.slug,
    },
    content,
    body: stripFrontmatter(content),
    title: titleMatch?.[1] ?? document.title,
  };
}

/** Canonical paths select their exact source; legacy paths and missing variants return null. */
export function getDocByPath(pathname: string): ResolvedDoc | null {
  return readDocument(resolveNarrativeDocument(pathname));
}

/** Neutral pages share one registered source between their article and Markdown export. */
export function getSpecialDocByPath(pathname: string) {
  const page = specialDocsPages.find((candidate) => candidate.path === pathname);
  if (!page) return null;
  const filePath = path.join(resolveContentDir(), page.contentPath);
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  return { ...page, content, body: stripFrontmatter(content) };
}

/** Internal identity lookup, not a public legacy-route compatibility layer. */
export function getDocBySlug(
  library: string | null,
  section: string,
  slug: string,
  scope: DocsScope = 'angular'
): ResolvedDoc | null {
  return readDocument(
    getDocumentVariant(
      [library, section, slug].filter(Boolean).join('/'),
      scope
    )
  );
}

/**
 * The description a docs page advertises about itself: frontmatter when present,
 * otherwise its first real paragraph, otherwise the library blurb.
 *
 * A `ResolvedDoc` carries no `description` field of its own — it is derived from
 * the MDX body. Exported so the page's JSON-LD can state *exactly* the string
 * that {@link getDocMetadata} puts in `<meta name="description">`; two surfaces
 * describing the same page differently is a worse signal than either alone.
 */
export function resolveDocDescription(
  doc: ResolvedDoc,
  library: string | null = doc.document.library
): string {
  const lib = library ? getLibraryConfig(library) : undefined;
  return getDocDescription(
    doc.content,
    doc.document.description || lib?.description || DEFAULT_DOCS_DESCRIPTION
  );
}

export function getDocMetadata(
  library: string | null,
  section: string,
  slug: string,
  scope: DocsScope = 'angular'
): ResolvedDocMetadata | null {
  const doc = getDocBySlug(library, section, slug, scope);
  if (!doc) return null;

  return metadataForDocument(doc);
}

export function getDocMetadataByPath(
  pathname: string
): ResolvedDocMetadata | null {
  const doc = getDocByPath(pathname);
  return doc ? metadataForDocument(doc) : null;
}

function metadataForDocument(doc: ResolvedDoc): ResolvedDocMetadata {
  const lib = doc.document.library
    ? getLibraryConfig(doc.document.library)
    : undefined;
  const libraryTitle = lib?.title ?? 'Docs';
  const title = `${doc.title} — ${libraryTitle} Docs — Threadplane`;
  const description = resolveDocDescription(doc);
  const pathname = doc.document.href;

  return createPageMetadata({ title, description, pathname });
}

export function getAllDocSlugs(scope?: DocsScope): DocumentVariant[] {
  return getNarrativeDocuments(scope);
}
