/**
 * Prepares what the live suite's backends run in, the way the repository
 * already prepares each: the uv environment of the client-tools candidate
 * proof, and the Mastra service's own dependencies. Safe to run again.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { environment, mastra, pythonProject } from './configuration.mjs';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} exited ${result.status}`);
}

const uv = {
  ...process.env,
  UV_PYTHON: '3.12',
  UV_PROJECT_ENVIRONMENT: environment,
};

// A temporary directory can lose the environment's marker file to cleanup
// while its packages stay. uv then reports the environment in sync although
// Python no longer reads it, so the marker is written again first.
if (existsSync(environment) && !existsSync(join(environment, 'pyvenv.cfg')))
  run('uv', ['venv', '--allow-existing', '--python', '3.12', environment], {
    env: uv,
  });

// The command ci.yml and fixtures/react-parity/ag-ui-candidate/README.md use.
run(
  'uv',
  ['sync', '--frozen', '--no-install-project', '--project', pythonProject],
  { env: uv }
);

// Fail here, with the reason, and not later as a backend that never starts.
run(
  'uv',
  [
    'run',
    '--frozen',
    '--no-sync',
    '--project',
    pythonProject,
    'python',
    '-c',
    'import ag_ui_langgraph, fastapi, langgraph, uvicorn',
  ],
  { env: uv }
);

// The Mastra service's tests, and the candidate proof, install it this way.
if (!existsSync(join(mastra, 'node_modules')))
  run('npm', ['ci', '--prefix', mastra, '--no-audit', '--no-fund']);
