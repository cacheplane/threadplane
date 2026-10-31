// Run via: npm run marketing:queue -- <command> --target=<preview|production>
import { runCli } from './cli/run.ts';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

runCli(process.argv.slice(2), process.env, {
  stdout: (line) => process.stdout.write(`${line}\n`),
  readStdin,
})
  .then(() => process.exit(0))
  .catch((error) => {
    process.stderr.write(`✗ ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
