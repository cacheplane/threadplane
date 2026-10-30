import { readFile } from 'node:fs/promises';
import { createAdapter } from '@threadplane-internal/marketing-channels';
import { uploadMedia } from '../blob.ts';
import { loadAdapterOptions } from '../credentials.ts';
import { defaultSlots } from '../schedule.ts';
import { loadCredentialKey, openContext } from './context.ts';
import { add, addBlog, edit } from './commands/draft.ts';
import { setDevtoKey } from './commands/devto-key.ts';
import { approve, cancel, confirm, list, reschedule } from './commands/manage.ts';
import { report } from './commands/report.ts';
import { parseArgs, requireWeek, type CommandDeps } from './commands/shared.ts';

type Env = Record<string, string | undefined>;

export interface CliIo {
  stdout: (line: string) => void;
  readStdin: () => Promise<string>;
}

const USAGE = `usage: npm run marketing:queue -- <command> --target=preview|production
  plan --week=YYYY-MM-DD
  add --week= --channel= --slot= --kind= --file=<draft.json> [--media=<png> --alt="..."] [--depends-on=<id>] [--campaign=<slug>]
  add-blog --week= --mdx=<path> [--kind=]
  edit <id> --file=<draft.json>
  confirm <id> --codes=a,b
  list --week=
  cancel <id>
  reschedule <id> --at=<ISO>
  approve --week=
  set-devto-key        (key on stdin)
  report --week=`;

/** Thin router: parses argv, wires real dependencies, delegates to command functions. */
export async function runCli(argv: readonly string[], env: Env, io: CliIo): Promise<void> {
  const args = parseArgs(argv);
  const command = args.positional[0];
  if (!command) return io.stdout(USAGE);

  if (command === 'plan') {
    for (const s of defaultSlots(requireWeek(args))) {
      io.stdout(`${s.slot.padEnd(14)} ${s.channel.padEnd(9)} ${s.publishAt.toISOString()}`);
    }
    return;
  }

  const ctx = openContext(argv, env, io.stdout);
  try {
    const deps: CommandDeps = {
      ex: ctx.ex,
      now: new Date(),
      stdout: io.stdout,
      readFile: (path) => readFile(path),
      upload: async (bytes, pathname) => {
        const token = env['BLOB_READ_WRITE_TOKEN'];
        if (!token) throw new Error('BLOB_READ_WRITE_TOKEN must be set to upload media');
        return uploadMedia(bytes, pathname, token);
      },
    };
    switch (command) {
      case 'add':
        return await add(args, deps);
      case 'add-blog':
        return await addBlog(args, deps);
      case 'edit':
        return await edit(args, deps);
      case 'confirm':
        return await confirm(args, deps);
      case 'list':
        return await list(args, deps);
      case 'cancel':
        return await cancel(args, deps);
      case 'reschedule':
        return await reschedule(args, deps);
      case 'approve':
        return await approve(args, deps);
      case 'set-devto-key':
        return await setDevtoKey(deps, loadCredentialKey(env), io.readStdin);
      case 'report': {
        const options = await loadAdapterOptions(ctx.ex, loadCredentialKey(env), env);
        const fetchMetrics = options.devto
          ? (postId: string) => createAdapter('devto', options).metrics(postId)
          : undefined;
        if (!fetchMetrics) io.stdout('dev.to credentials not stored; skipping metrics');
        return await report(args, deps, fetchMetrics);
      }
      default:
        throw new Error(`Unknown command "${command}"\n${USAGE}`);
    }
  } finally {
    await ctx.close();
  }
}
