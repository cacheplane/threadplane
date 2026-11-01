import type { SqlExecutor, SqlTransaction } from '../database.ts';
import {
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

/** Returns the first matching active deny id, or null. One query. */
export async function matchDeny(
  tx: SqlTransaction,
  probe: DenyProbe
): Promise<string | null> {
  const company = companyNameFromHeadline(probe.headline);
  const companyName = company ? normalizeCompanyName(company) : '';
  const result = await tx.execute<{ id: string }>(
    `/* growth:linkedin-deny-match */
select id from growth_linkedin_deny
where removed_at is null
  and ((kind = 'profile_url' and value = $1)
    or (kind = 'company_domain' and value = any($2::text[]))
    or (kind = 'company_name' and value = any($3::text[])))
order by added_at
limit 1`,
    [
      normalizeLinkedInProfileUrl(probe.profileUrl) ?? probe.profileUrl,
      domainsInText(probe.headline),
      companyName ? [companyName] : [],
    ]
  );
  return result.rows[0]?.id ?? null;
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
