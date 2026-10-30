import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Atomic per-target checkpoints survive termination without publishing partial JSON. */
export async function writeDocsAuditEvidence(
  output: string,
  report: unknown,
  sanitizedEvents: readonly unknown[],
  sanitizedServerLog: string
): Promise<void> {
  await mkdir(output, { recursive: true });
  const files = [
    ['report.json', JSON.stringify(report, null, 2)],
    ['trace.json', JSON.stringify(sanitizedEvents, null, 2)],
    ['server.log', sanitizedServerLog],
  ];
  await Promise.all(
    files.map(async ([name, content]) => {
      const path = join(output, name);
      const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporary, content);
      await rename(temporary, path);
    })
  );
}
