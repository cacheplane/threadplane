/** Shared local/CI prerequisite; no inherited Library fixture environment. */
import { execFileSync, spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const project = resolve(root, 'cockpit/ag-ui/client-tools/python');
export const environment = resolve(project, '.venv');
export function prepareClientToolsFixture() {
  execFileSync('uv', ['sync', '--frozen', '--no-install-project', '--project', project], {
    cwd: root, stdio: 'inherit', timeout: 180000,
    env: {...process.env, UV_PYTHON: '3.12', UV_PROJECT_ENVIRONMENT: environment},
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareClientToolsFixture();
  if (process.argv.includes('--serve')) {
    const child = spawn(process.execPath, [resolve(root, 'scripts/react-cockpit/serve.mjs'), 'ag-ui-client-tools', '--no-parent'], {cwd: root, stdio:'inherit'});
    process.once('SIGTERM', () => child.kill('SIGTERM'));
    process.once('SIGINT', () => child.kill('SIGINT'));
    child.once('exit', code => process.exit(code ?? 1));
    child.once('error', () => process.exit(1));
  }
}
