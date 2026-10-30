import type { SqlExecutor } from '../../sql.ts';

export interface CommandDeps {
  ex: SqlExecutor;
  now: Date;
  stdout: (line: string) => void;
  readFile: (path: string) => Promise<Buffer>;
  /** Uploads PNG bytes to `pathname` and returns the public URL. */
  upload: (bytes: Buffer, pathname: string) => Promise<string>;
}

export interface Args {
  positional: string[];
  flags: Record<string, string>;
}

export function parseArgs(argv: readonly string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/su.exec(arg);
    if (match) flags[match[1]] = match[2] ?? 'true';
    else positional.push(arg);
  }
  return { positional, flags };
}

export function requireFlag(args: Args, name: string): string {
  const value = args.flags[name];
  if (!value || value === 'true') throw new Error(`--${name} is required`);
  return value;
}

export function requireWeek(args: Args): string {
  const week = requireFlag(args, 'week');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(week)) throw new Error('--week must be YYYY-MM-DD (a Monday)');
  return week;
}

export function requireId(args: Args): string {
  const id = args.positional[1];
  if (!id) throw new Error(`${args.positional[0]} requires a post id`);
  return id;
}
