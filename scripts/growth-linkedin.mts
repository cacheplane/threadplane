import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile as readFileFs, realpath } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  addDenyEntry,
  createDatabaseExecutor,
  decideLead,
  deleteLead,
  ingestManualEngagement,
  listDenyEntries,
  listLeads,
  parseLinkedInNotification,
  removeDenyEntry,
  type DecideLeadInput,
  type DecideLeadResult,
  type LinkedInDenyEntry,
  type LinkedInDenyKind,
  type LinkedInLeadStatus,
  type LinkedInLeadSummary,
  type LinkedInParseResult,
  type LinkedInParserInput,
  type SqlExecutor,
} from '../libs/growth/src/index.ts';

import { parseEml } from './growth-linkedin-eml.mts';

const execFileAsync = promisify(execFile);

export type GrowthLinkedInTarget = 'preview' | 'production';

export interface GrowthLinkedInOperations {
  denyImport(
    lines: string[],
    addedBy: string
  ): Promise<{ added: number; existing: number; invalid: number }>;
  denyAdd(
    kind: LinkedInDenyKind,
    value: string,
    reason?: string
  ): Promise<{ id: string; created: boolean }>;
  denyRemove(kind: LinkedInDenyKind, value: string): Promise<boolean>;
  denyList(includeRemoved: boolean): Promise<LinkedInDenyEntry[]>;
  leads(
    status?: LinkedInLeadStatus,
    limit?: number
  ): Promise<LinkedInLeadSummary[]>;
  decide(input: DecideLeadInput): Promise<DecideLeadResult>;
  deleteLead(profileUrl: string): Promise<boolean>;
  ingestManual(
    input: Parameters<typeof ingestManualEngagement>[1]
  ): Promise<{ recorded: number; dropped: number }>;
}

export interface GrowthLinkedInRunnerDependencies {
  operations: GrowthLinkedInOperations;
  readFile(path: string): Promise<string>;
  /** Repo-root containment OR `git rev-parse --is-inside-work-tree` === 'true'. */
  isInsideGitWorktree(path: string): Promise<boolean>;
  /** Minimal RFC 5322 reader; null when the message cannot be read. */
  parseEml(raw: string): LinkedInParserInput | null;
  parse(input: LinkedInParserInput): LinkedInParseResult;
  now(): Date;
  writeOutput(line: string): void;
  writeError(line: string): void;
}

const DENY_KINDS: readonly LinkedInDenyKind[] = [
  'profile_url',
  'company_name',
  'company_domain',
];
const LEAD_STATUSES: readonly LinkedInLeadStatus[] = [
  'new',
  'approved',
  'rejected',
  'denied',
];

export type ParsedCommand =
  | { verb: 'deny-import'; target: GrowthLinkedInTarget; file: string }
  | {
      verb: 'deny-add';
      target: GrowthLinkedInTarget;
      kind: LinkedInDenyKind;
      value: string;
      reason?: string;
    }
  | {
      verb: 'deny-remove';
      target: GrowthLinkedInTarget;
      kind: LinkedInDenyKind;
      value: string;
    }
  | {
      verb: 'deny-list';
      target: GrowthLinkedInTarget;
      includeRemoved: boolean;
    }
  | {
      verb: 'leads';
      target: GrowthLinkedInTarget;
      status?: LinkedInLeadStatus;
      limit: number;
    }
  | {
      verb: 'decide';
      target: GrowthLinkedInTarget;
      leadId: string;
      decision: 'approve' | 'reject' | 'deny';
      variant?: 'connection' | 'message';
      textFile?: string;
    }
  | { verb: 'delete-lead'; target: GrowthLinkedInTarget; profileUrl: string }
  | { verb: 'replay'; file: string }
  | { verb: 'ingest'; target: GrowthLinkedInTarget; file: string };

class GrowthLinkedInUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GrowthLinkedInUsageError';
  }
}

const USAGE = `Usage: npm run growth:linkedin -- <verb> --target=preview|production
  deny-import --file <path>
  deny-add --kind <k> --value <v> [--reason <text>]
  deny-remove --kind <k> --value <v>
  deny-list [--include-removed]
  leads [--status new|approved|rejected|denied] [--limit 50]
  decide --lead <id> (--approve --variant connection|message --text-file <path> | --reject | --deny)
  delete-lead --profile-url <url>
  replay --file <eml>   (no --target)
  ingest --file <eml> [--source manual]`;

const VALUE_FLAGS = new Set([
  'target',
  'file',
  'kind',
  'value',
  'reason',
  'status',
  'limit',
  'lead',
  'variant',
  'text-file',
  'profile-url',
  'source',
]);
const BOOLEAN_FLAGS = new Set(['include-removed', 'approve', 'reject', 'deny']);

function readFlags(argv: readonly string[]): {
  values: Map<string, string>;
  booleans: Set<string>;
} {
  const values = new Map<string, string>();
  const booleans = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) {
      throw new GrowthLinkedInUsageError(`Unexpected argument. ${USAGE}`);
    }
    const equals = argument.indexOf('=');
    const name = argument.slice(2, equals === -1 ? undefined : equals);
    if (BOOLEAN_FLAGS.has(name) && equals === -1) {
      booleans.add(name);
      continue;
    }
    if (!VALUE_FLAGS.has(name)) {
      throw new GrowthLinkedInUsageError(`Unknown flag --${name}. ${USAGE}`);
    }
    let value: string | undefined;
    if (equals !== -1) {
      value = argument.slice(equals + 1);
    } else {
      value = argv[index + 1];
      index += 1;
    }
    if (!value || (equals === -1 && value.startsWith('--'))) {
      throw new GrowthLinkedInUsageError(`--${name} requires a value`);
    }
    if (values.has(name)) {
      throw new GrowthLinkedInUsageError(`--${name} was given twice`);
    }
    values.set(name, value);
  }
  return { values, booleans };
}

export function parseArguments(argv: readonly string[]): ParsedCommand {
  const verb = argv[0];
  const { values, booleans } = readFlags(argv.slice(1));
  const need = (name: string): string => {
    const value = values.get(name);
    if (!value) throw new GrowthLinkedInUsageError(`--${name} is required`);
    return value;
  };
  const allowed = (names: string[], flags: string[] = []): void => {
    for (const name of [...values.keys(), ...booleans]) {
      if (!names.includes(name) && !flags.includes(name)) {
        throw new GrowthLinkedInUsageError(
          `--${name} is not valid for ${verb}`
        );
      }
    }
  };
  const kind = (): LinkedInDenyKind => {
    const value = need('kind');
    if (!(DENY_KINDS as readonly string[]).includes(value)) {
      throw new GrowthLinkedInUsageError(
        `--kind must be one of ${DENY_KINDS.join(', ')}`
      );
    }
    return value as LinkedInDenyKind;
  };
  const target = (): GrowthLinkedInTarget => {
    const value = need('target');
    if (value !== 'preview' && value !== 'production') {
      throw new GrowthLinkedInUsageError(
        `--target must be preview or production, got "${value}"`
      );
    }
    return value;
  };

  switch (verb) {
    case 'replay':
      allowed(['file']);
      return { verb, file: need('file') };
    case 'deny-import':
      allowed(['target', 'file']);
      return { verb, target: target(), file: need('file') };
    case 'deny-add':
      allowed(['target', 'kind', 'value', 'reason']);
      return {
        verb,
        target: target(),
        kind: kind(),
        value: need('value'),
        reason: values.get('reason'),
      };
    case 'deny-remove':
      allowed(['target', 'kind', 'value']);
      return { verb, target: target(), kind: kind(), value: need('value') };
    case 'deny-list':
      allowed(['target'], ['include-removed']);
      return {
        verb,
        target: target(),
        includeRemoved: booleans.has('include-removed'),
      };
    case 'leads': {
      allowed(['target', 'status', 'limit']);
      const status = values.get('status');
      if (status && !(LEAD_STATUSES as readonly string[]).includes(status)) {
        throw new GrowthLinkedInUsageError(
          `--status must be one of ${LEAD_STATUSES.join(', ')}`
        );
      }
      const limit = Number(values.get('limit') ?? '50');
      if (!Number.isInteger(limit) || limit < 1) {
        throw new GrowthLinkedInUsageError(
          '--limit must be a positive integer'
        );
      }
      return {
        verb,
        target: target(),
        status: status as LinkedInLeadStatus | undefined,
        limit,
      };
    }
    case 'decide': {
      allowed(
        ['target', 'lead', 'variant', 'text-file'],
        ['approve', 'reject', 'deny']
      );
      const chosen = ['approve', 'reject', 'deny'].filter((name) =>
        booleans.has(name)
      ) as ('approve' | 'reject' | 'deny')[];
      if (chosen.length !== 1) {
        throw new GrowthLinkedInUsageError(
          'decide needs exactly one of --approve, --reject, --deny'
        );
      }
      const decision = chosen[0];
      const base = { verb, target: target(), leadId: need('lead'), decision };
      if (decision !== 'approve') {
        if (values.has('variant') || values.has('text-file')) {
          throw new GrowthLinkedInUsageError(
            '--variant and --text-file are valid only with --approve'
          );
        }
        return base;
      }
      const variant = need('variant');
      if (variant !== 'connection' && variant !== 'message') {
        throw new GrowthLinkedInUsageError(
          '--variant must be connection or message'
        );
      }
      return { ...base, variant, textFile: need('text-file') };
    }
    case 'delete-lead':
      allowed(['target', 'profile-url']);
      return { verb, target: target(), profileUrl: need('profile-url') };
    case 'ingest': {
      allowed(['target', 'file', 'source']);
      const source = values.get('source');
      if (source && source !== 'manual') {
        throw new GrowthLinkedInUsageError('--source must be manual');
      }
      return { verb, target: target(), file: need('file') };
    }
    default:
      throw new GrowthLinkedInUsageError(USAGE);
  }
}

// ---- runner ------------------------------------------------------------------

const DENY_IMPORT_ACTOR = 'founder_cli_import';

function parseDenyLine(
  line: string
): { kind: LinkedInDenyKind; value: string; reason?: string } | null {
  const [kind, value, ...reason] = line.trim().split(/\s+/);
  if (!kind || !value) return null;
  if (!(DENY_KINDS as readonly string[]).includes(kind)) return null;
  return {
    kind: kind as LinkedInDenyKind,
    value,
    reason: reason.length > 0 ? reason.join(' ') : undefined,
  };
}

function significantLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

export function createGrowthLinkedInOperations(
  executor: SqlExecutor
): GrowthLinkedInOperations {
  return {
    async denyImport(lines, addedBy) {
      const counts = { added: 0, existing: 0, invalid: 0 };
      for (const line of lines) {
        const entry = parseDenyLine(line);
        if (!entry) {
          counts.invalid += 1;
          continue;
        }
        try {
          const result = await addDenyEntry(executor, { ...entry, addedBy });
          if (result.created) counts.added += 1;
          else counts.existing += 1;
        } catch {
          counts.invalid += 1;
        }
      }
      return counts;
    },
    denyAdd: (kind, value, reason) =>
      addDenyEntry(executor, { kind, value, reason, addedBy: 'founder_cli' }),
    denyRemove: (kind, value) => removeDenyEntry(executor, { kind, value }),
    denyList: (includeRemoved) => listDenyEntries(executor, { includeRemoved }),
    leads: (status, limit) => listLeads(executor, { status, limit }),
    decide: (input) => decideLead(executor, input),
    deleteLead: (profileUrl) => deleteLead(executor, { profileUrl }),
    ingestManual: (input) => ingestManualEngagement(executor, input),
  };
}

async function readEml(
  dependencies: GrowthLinkedInRunnerDependencies,
  path: string
): Promise<{ raw: string; input: LinkedInParserInput }> {
  const raw = await dependencies.readFile(path);
  const input = dependencies.parseEml(raw);
  if (!input) throw new Error('Could not read the file as an email');
  return { raw, input };
}

export async function runGrowthLinkedIn(
  argv: readonly string[],
  dependencies: GrowthLinkedInRunnerDependencies
): Promise<number> {
  const emit = (value: unknown): void =>
    dependencies.writeOutput(JSON.stringify(value));
  try {
    const command = parseArguments(argv);
    const { operations } = dependencies;
    switch (command.verb) {
      case 'deny-import': {
        if (await dependencies.isInsideGitWorktree(command.file)) {
          throw new GrowthLinkedInUsageError(
            'Refusing to read a deny list from inside a git worktree; keep it outside the repository'
          );
        }
        const lines = significantLines(
          await dependencies.readFile(command.file)
        );
        const counts = await operations.denyImport(lines, DENY_IMPORT_ACTOR);
        emit({ command: 'deny-import', ...counts });
        return 0;
      }
      case 'deny-add': {
        const result = await operations.denyAdd(
          command.kind,
          command.value,
          command.reason
        );
        emit({ command: 'deny-add', id: result.id, created: result.created });
        return 0;
      }
      case 'deny-remove': {
        const removed = await operations.denyRemove(
          command.kind,
          command.value
        );
        emit({ command: 'deny-remove', removed });
        return removed ? 0 : 1;
      }
      case 'deny-list': {
        for (const entry of await operations.denyList(command.includeRemoved)) {
          emit({
            kind: entry.kind,
            value: entry.value,
            reason: entry.reason,
            addedBy: entry.addedBy,
            addedAt: entry.addedAt,
            removedAt: entry.removedAt,
          });
        }
        return 0;
      }
      case 'leads': {
        for (const lead of await operations.leads(
          command.status,
          command.limit
        )) {
          emit(lead);
        }
        return 0;
      }
      case 'decide': {
        const now = dependencies.now();
        let input: DecideLeadInput;
        if (command.decision === 'approve') {
          const text = (
            await dependencies.readFile(command.textFile ?? '')
          ).trim();
          if (!text) {
            throw new GrowthLinkedInUsageError('--text-file is empty');
          }
          input = {
            leadId: command.leadId,
            decision: 'approve',
            variant: command.variant ?? 'connection',
            text,
            decidedBy: 'founder_cli',
            now,
          };
        } else {
          input = {
            leadId: command.leadId,
            decision: command.decision,
            decidedBy: 'founder_cli',
            now,
          };
        }
        const result = await operations.decide(input);
        emit({ command: 'decide', leadId: command.leadId, result });
        return result === 'not_found' || result === 'denied_by_list' ? 1 : 0;
      }
      case 'delete-lead': {
        const deleted = await operations.deleteLead(command.profileUrl);
        emit({ command: 'delete-lead', deleted });
        return deleted ? 0 : 1;
      }
      case 'replay': {
        const { input } = await readEml(dependencies, command.file);
        emit(dependencies.parse(input));
        return 0;
      }
      case 'ingest': {
        const { raw, input } = await readEml(dependencies, command.file);
        const result = dependencies.parse(input);
        if (result.outcome !== 'parsed') {
          emit({
            command: 'ingest',
            outcome: 'unparsed',
            reason: result.reason,
          });
          return 1;
        }
        const dated = new Date(input.headers['date'] ?? '');
        const counts = await operations.ingestManual({
          receiptId: `manual:${createHash('sha256')
            .update(raw)
            .digest('hex')
            .slice(0, 32)}`,
          receivedAt: Number.isNaN(dated.getTime())
            ? dependencies.now()
            : dated,
          kind: result.kind,
          actors: result.actors,
          post: result.post,
        });
        emit({ command: 'ingest', outcome: 'parsed', ...counts });
        return 0;
      }
    }
  } catch (error) {
    dependencies.writeError(
      error instanceof Error ? error.message : 'Unknown error'
    );
    return error instanceof GrowthLinkedInUsageError ? 2 : 1;
  }
}

// ---- target + main -----------------------------------------------------------

type Env = Record<string, string | undefined>;

const TARGET_ENV: Record<GrowthLinkedInTarget, string> = {
  preview: 'GROWTH_DATABASE_URL_PREVIEW',
  production: 'GROWTH_DATABASE_URL_PRODUCTION',
};

export function resolveTarget(
  value: string,
  env: Env
): { target: GrowthLinkedInTarget; envVar: string; databaseUrl: string } {
  if (value !== 'preview' && value !== 'production') {
    throw new Error(`--target must be preview or production, got "${value}"`);
  }
  const envVar = TARGET_ENV[value];
  const databaseUrl = env[envVar];
  if (!databaseUrl)
    throw new Error(`${envVar} must be set for --target=${value}`);
  return { target: value, envVar, databaseUrl };
}

/** Hostname only; never credentials, path, or the raw string. */
export function databaseHost(databaseUrl: string): string {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    return '(unparseable URL)';
  }
}

const scriptDirectory = dirname(new URL(import.meta.url).pathname);

async function defaultIsInsideGitWorktree(path: string): Promise<boolean> {
  const repoRoot = await realpath(resolve(scriptDirectory, '..'));
  let real: string;
  try {
    real = await realpath(resolve(path));
  } catch {
    real = resolve(path);
  }
  if (real === repoRoot || real.startsWith(`${repoRoot}${sep}`)) return true;
  try {
    const { stdout } = await execFileAsync('git', [
      '-C',
      dirname(real),
      'rev-parse',
      '--is-inside-work-tree',
    ]);
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

export interface GrowthLinkedInMainDependencies {
  env: Env;
  createExecutor(databaseUrl: string): SqlExecutor;
  createOperations(executor: SqlExecutor): GrowthLinkedInOperations;
  readFile(path: string): Promise<string>;
  isInsideGitWorktree(path: string): Promise<boolean>;
  now(): Date;
  writeOutput(line: string): void;
  writeError(line: string): void;
}

const DEFAULT_MAIN_DEPENDENCIES: GrowthLinkedInMainDependencies = {
  env: process.env,
  createExecutor: (databaseUrl) => createDatabaseExecutor(databaseUrl),
  createOperations: createGrowthLinkedInOperations,
  readFile: (path) => readFileFs(path, 'utf8'),
  isInsideGitWorktree: defaultIsInsideGitWorktree,
  now: () => new Date(),
  writeOutput: (line) => process.stdout.write(`${line}\n`),
  writeError: (line) => process.stderr.write(`${line}\n`),
};

const NO_DATABASE: GrowthLinkedInOperations = new Proxy(
  {} as GrowthLinkedInOperations,
  {
    get() {
      throw new Error('This verb does not use a database');
    },
  }
);

export async function mainGrowthLinkedIn(
  argv: readonly string[] = process.argv.slice(2),
  dependencies: GrowthLinkedInMainDependencies = DEFAULT_MAIN_DEPENDENCIES
): Promise<number> {
  let command: ParsedCommand;
  try {
    command = parseArguments(argv);
  } catch (error) {
    dependencies.writeError(error instanceof Error ? error.message : USAGE);
    return error instanceof GrowthLinkedInUsageError ? 2 : 1;
  }

  const runnerDependencies = (
    operations: GrowthLinkedInOperations
  ): GrowthLinkedInRunnerDependencies => ({
    operations,
    readFile: dependencies.readFile,
    isInsideGitWorktree: dependencies.isInsideGitWorktree,
    parseEml,
    parse: parseLinkedInNotification,
    now: dependencies.now,
    writeOutput: dependencies.writeOutput,
    writeError: dependencies.writeError,
  });

  if (command.verb === 'replay') {
    return runGrowthLinkedIn(argv, runnerDependencies(NO_DATABASE));
  }

  let resolved: ReturnType<typeof resolveTarget>;
  try {
    resolved = resolveTarget(command.target, dependencies.env);
  } catch (error) {
    dependencies.writeError(
      error instanceof Error ? error.message : 'Invalid target'
    );
    return 1;
  }
  dependencies.writeOutput(
    `target: ${resolved.target} (${databaseHost(resolved.databaseUrl)})`
  );
  const executor = dependencies.createExecutor(resolved.databaseUrl);
  try {
    return await runGrowthLinkedIn(
      argv,
      runnerDependencies(dependencies.createOperations(executor))
    );
  } finally {
    await executor.close?.();
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  void mainGrowthLinkedIn().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : 'Unknown error'}\n`
      );
      process.exitCode = 1;
    }
  );
}
