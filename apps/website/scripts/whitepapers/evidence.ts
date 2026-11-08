import { createHash } from 'node:crypto';
import { WHITEPAPERS } from '../../src/lib/whitepapers';

export interface PaperEvidence {
  reviewedAt: string;
  reviewDue: string;
  sourceSha256: string;
  sources: string[];
  claimCategories: string[];
}
export interface EvidenceManifest {
  schemaVersion: number;
  baselineRevision: string;
  papers: Record<string, PaperEvidence>;
  packages: { file: string; pointer: string[]; value: string | boolean }[];
}
const ids = Object.keys(WHITEPAPERS);
const sourcePath = (id: string) => `apps/website/content/whitepapers/${id}.md`;

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === 'string')
  );
}

/** JSON is untrusted until its structure has been checked at runtime. */
function hasEvidenceShape(
  value: unknown,
  issues: string[]
): value is EvidenceManifest {
  if (!isRecord(value)) {
    issues.push('Evidence manifest must be an object');
    return false;
  }
  if (typeof value.schemaVersion !== 'number')
    issues.push('schemaVersion must be a number');
  if (typeof value.baselineRevision !== 'string')
    issues.push('baselineRevision must be a string');
  if (!isRecord(value.papers)) issues.push('papers must be an object');
  else
    for (const [id, paper] of Object.entries(value.papers)) {
      if (!isRecord(paper)) {
        issues.push(`${id}: evidence record must be an object`);
        continue;
      }
      for (const field of ['reviewedAt', 'reviewDue', 'sourceSha256']) {
        if (typeof paper[field] !== 'string')
          issues.push(`${id}: ${field} must be a string`);
      }
      if (!isStringArray(paper.sources))
        issues.push(`${id}: sources must be a string array`);
      if (!isStringArray(paper.claimCategories))
        issues.push(`${id}: claim categories must be a string array`);
    }
  if (!Array.isArray(value.packages)) issues.push('packages must be an array');
  else
    value.packages.forEach((entry: unknown, index: number) => {
      const label = `packages[${index}]`;
      if (!isRecord(entry)) {
        issues.push(`${label}: evidence record must be an object`);
        return;
      }
      if (typeof entry.file !== 'string')
        issues.push(`${label}: file must be a string`);
      if (
        !isStringArray(entry.pointer) ||
        !entry.pointer.length ||
        entry.pointer.some((part) => !part.trim())
      ) {
        issues.push(`${label}: pointer must be a nonempty string array`);
      }
      if (typeof entry.value !== 'string' && typeof entry.value !== 'boolean') {
        issues.push(`${label}: value must be a string or boolean`);
      }
    });
  return issues.length === 0;
}

/** Third-party citations only; local docs are checked by publication tests. */
export function evidenceSources(source: string): string[] {
  return [
    ...new Set(
      [...source.matchAll(/https:\/\/[^\s)<>]+/g)]
        .map(([url]) => url)
        .filter((url) => new URL(url).hostname !== 'threadplane.ai')
    ),
  ].sort();
}

/** Deterministic CI checks. This does not fetch sources or assess their currency. */
export function validateEvidence(
  manifest: unknown,
  read: (file: string) => string
): string[] {
  const issues: string[] = [];
  if (!hasEvidenceShape(manifest, issues)) return issues;
  if (manifest.schemaVersion !== 1)
    issues.push('Unsupported evidence schema version');
  if (!/^[a-f0-9]{40}$/.test(manifest.baselineRevision))
    issues.push('Invalid baseline revision');
  for (const id of Object.keys(manifest.papers)) {
    if (!ids.includes(id)) issues.push(`${id}: unknown paper`);
  }
  for (const id of ids) {
    const paper = manifest.papers[id];
    if (!paper) {
      issues.push(`${id}: missing evidence record`);
      continue;
    }
    if (!validDate(paper.reviewedAt) || !validDate(paper.reviewDue))
      issues.push(`${id}: invalid review date`);
    else if (paper.reviewDue <= paper.reviewedAt)
      issues.push(`${id}: review due must follow review date`);
    if (!/^[a-f0-9]{64}$/.test(paper.sourceSha256))
      issues.push(`${id}: invalid authored-content hash`);
    if (new Set(paper.sources).size !== paper.sources.length)
      issues.push(`${id}: duplicate sources`);
    if (
      !paper.claimCategories?.length ||
      paper.claimCategories.some((category) => !category.trim())
    )
      issues.push(`${id}: missing claim categories`);
    try {
      const current = evidenceSources(read(sourcePath(id)));
      for (const url of current) {
        if (!paper.sources.includes(url))
          issues.push(`${id}: cited source missing from evidence: ${url}`);
      }
      for (const url of paper.sources) {
        if (!current.includes(url))
          issues.push(`${id}: evidence source no longer cited: ${url}`);
      }
    } catch {
      issues.push(`${id}: cannot read authored source or its URLs`);
    }
  }
  for (const entry of manifest.packages) {
    if (
      !/^(?:libs\/[a-z0-9-]+\/)?package(?:-lock)?\.json$/.test(entry.file) ||
      entry.pointer.length === 0
    ) {
      issues.push('Invalid package evidence path');
      continue;
    }
    try {
      JSON.parse(read(entry.file));
    } catch {
      issues.push(`${entry.file}: cannot read package evidence`);
    }
  }
  return issues;
}

/** Explicit maintenance review: changed facts require a human evidence check. */
export function reviewEvidence(
  value: unknown,
  read: (file: string) => string,
  today: string
): string[] {
  if (!validDate(today)) throw new Error('Invalid audit date; use YYYY-MM-DD');
  const issues = validateEvidence(value, read);
  if (issues.length) return issues;
  const manifest = value as EvidenceManifest;
  for (const id of ids) {
    const paper = manifest.papers[id];
    if (paper.reviewedAt > today)
      issues.push(`${id}: review date is in the future`);
    if (paper.reviewDue <= today)
      issues.push(`${id}: review due ${paper.reviewDue}`);
    const hash = createHash('sha256')
      .update(read(sourcePath(id)))
      .digest('hex');
    if (hash !== paper.sourceSha256)
      issues.push(`${id}: authored content changed since review`);
  }
  for (const entry of manifest.packages) {
    let current: unknown = JSON.parse(read(entry.file));
    for (const part of entry.pointer) {
      current =
        current !== null && typeof current === 'object'
          ? (current as Record<string, unknown>)[part]
          : undefined;
    }
    if (current !== entry.value)
      issues.push(
        `${entry.file}/${entry.pointer.join('/')} changed: ${JSON.stringify(
          entry.value
        )} → ${JSON.stringify(current)}`
      );
  }
  return issues;
}
