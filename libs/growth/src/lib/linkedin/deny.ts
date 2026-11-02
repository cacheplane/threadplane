import type { SqlExecutor, SqlTransaction } from '../database.ts';
import {
  companyMatchesDenyName,
  companyNameFromHeadline,
  domainsInText,
  normalizeCompanyName,
  normalizeLinkedInProfileUrl,
} from './normalize.ts';

export type LinkedInDenyKind =
  | 'profile_url'
  | 'company_name'
  | 'company_domain';

export interface LinkedInDenyEntry {
  id: string;
  kind: LinkedInDenyKind;
  value: string;
  reason: string | null;
  addedBy: string;
  addedAt: Date;
  removedAt: Date | null;
}

const HOSTNAME = /^([a-z0-9-]+\.)+[a-z]{2,}$/;

/** Normalizes by kind; throws on an unusable value (bad profile URL, empty name, non-hostname). */
export function normalizeDenyValue(
  kind: LinkedInDenyKind,
  value: string
): string {
  if (kind === 'profile_url') {
    const url = normalizeLinkedInProfileUrl(value);
    if (!url) throw new Error(`Not a LinkedIn profile URL: ${value}`);
    return url;
  }
  if (kind === 'company_name') {
    const name = normalizeCompanyName(value);
    if (!name) throw new Error('Company name is empty after normalization');
    return name;
  }
  const host = value.trim().toLowerCase();
  if (!HOSTNAME.test(host)) throw new Error(`Not a hostname: ${value}`);
  return host;
}

/** Adds an active deny entry; an existing active entry is returned with `created: false`. */
export async function addDenyEntry(
  ex: SqlExecutor,
  input: {
    kind: LinkedInDenyKind;
    value: string;
    reason?: string;
    addedBy: string;
  }
): Promise<{ id: string; created: boolean }> {
  const value = normalizeDenyValue(input.kind, input.value);
  const inserted = await ex.execute<{ id: string }>(
    `/* growth:linkedin-deny-add */
insert into growth_linkedin_deny (kind, value, reason, added_by)
values ($1, $2, $3, $4)
on conflict (kind, value) where removed_at is null do nothing
returning id`,
    [input.kind, value, input.reason ?? null, input.addedBy]
  );
  if (inserted.rows[0]) return { id: inserted.rows[0].id, created: true };
  const existing = await ex.execute<{ id: string }>(
    `/* growth:linkedin-deny-add */
select id from growth_linkedin_deny
where kind = $1 and value = $2 and removed_at is null`,
    [input.kind, value]
  );
  return { id: existing.rows[0].id, created: false };
}

/** Soft-removes the active entry for a value; returns whether one was removed. */
export async function removeDenyEntry(
  ex: SqlExecutor,
  input: { kind: LinkedInDenyKind; value: string }
): Promise<boolean> {
  const value = normalizeDenyValue(input.kind, input.value);
  const result = await ex.execute<{ id: string }>(
    `/* growth:linkedin-deny-remove */
update growth_linkedin_deny set removed_at = now()
where kind = $1 and value = $2 and removed_at is null
returning id`,
    [input.kind, value]
  );
  return result.rows.length > 0;
}

interface DenyRow extends Record<string, unknown> {
  id: string;
  kind: LinkedInDenyKind;
  value: string;
  reason: string | null;
  added_by: string;
  added_at: Date;
  removed_at: Date | null;
}

/** Lists deny entries, active only unless `includeRemoved` is set. */
export async function listDenyEntries(
  ex: SqlExecutor,
  input: { includeRemoved?: boolean } = {}
): Promise<LinkedInDenyEntry[]> {
  const result = await ex.execute<DenyRow>(
    `/* growth:linkedin-deny-list */
select id, kind, value, reason, added_by, added_at, removed_at
from growth_linkedin_deny
where ($1::boolean or removed_at is null)
order by added_at, id`,
    [input.includeRemoved ?? false]
  );
  return result.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    value: row.value,
    reason: row.reason,
    addedBy: row.added_by,
    addedAt: row.added_at,
    removedAt: row.removed_at,
  }));
}

export interface DenyProbe {
  profileUrl: string;
  headline: string;
}

/**
 * Returns the earliest matching active deny id, or null. One query: profile
 * and domain matches are filtered in SQL; every active company_name row is
 * loaded and matched in TypeScript as whole words inside the headline's
 * current-company phrase, so deny `acme` matches `Staff Engineer at Acme AI`.
 * Former-employer phrasing yields no company and so never matches by name.
 */
export async function matchDeny(
  tx: SqlTransaction,
  probe: DenyProbe
): Promise<string | null> {
  const company = companyNameFromHeadline(probe.headline);
  const result = await tx.execute<{
    id: string;
    kind: LinkedInDenyKind;
    value: string;
  }>(
    `/* growth:linkedin-deny-match */
select id, kind, value from growth_linkedin_deny
where removed_at is null
  and ((kind = 'profile_url' and value = $1)
    or (kind = 'company_domain' and value = any($2::text[]))
    or kind = 'company_name')
order by added_at, id`,
    [
      normalizeLinkedInProfileUrl(probe.profileUrl) ?? probe.profileUrl,
      domainsInText(probe.headline),
    ]
  );
  const hit = result.rows.find((row) =>
    row.kind === 'company_name'
      ? company !== null && companyMatchesDenyName(company, row.value)
      : true
  );
  return hit?.id ?? null;
}

/** SQL predicate: lead alias `l` has no active profile_url deny row. */
export const LEAD_PROFILE_NOT_DENIED_SQL = `not exists (
    select 1 from growth_linkedin_deny d
    where d.kind = 'profile_url' and d.removed_at is null
      and d.value = l.profile_url)`;

/**
 * Drops rows whose stored company matches an active company_name deny value
 * (whole words, as in `matchDeny`). Pair with `LEAD_PROFILE_NOT_DENIED_SQL`;
 * every lead list that feeds drafting or the digest uses both.
 */
export async function excludeDeniedCompanies<
  T extends { company_name: string | null }
>(ex: SqlTransaction, rows: T[]): Promise<T[]> {
  const denied = await ex.execute<{ value: string }>(
    `/* growth:linkedin-deny-company-names */
select value from growth_linkedin_deny
where kind = 'company_name' and removed_at is null`
  );
  const names = denied.rows.map((row) => row.value);
  return rows.filter((row) => {
    const company = row.company_name;
    return (
      !company || !names.some((name) => companyMatchesDenyName(company, name))
    );
  });
}

/** Records that a receipt was dropped by a deny entry; carries no identity. */
export async function recordDrop(
  tx: SqlTransaction,
  input: { receiptId: string; denyId: string; droppedAt: Date }
): Promise<void> {
  await tx.execute(
    `/* growth:linkedin-drop */
insert into growth_linkedin_drops (receipt_id, deny_id, dropped_at)
values ($1, $2, $3)`,
    [input.receiptId, input.denyId, input.droppedAt]
  );
}
