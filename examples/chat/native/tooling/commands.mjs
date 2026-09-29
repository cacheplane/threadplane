import { join } from 'node:path';

export function validateServeOptions(options) {
  if (options?.configuration !== 'development')
    throw new Error('Serve requires development configuration');
  if (
    !Number.isInteger(options.port) ||
    options.port < 1 ||
    options.port > 65535
  )
    throw new Error('Serve requires a port from 1 to 65535');
  if (typeof options.assistantId !== 'string' || !options.assistantId.trim())
    throw new Error('Serve requires a non-empty assistant identifier');
  return { ...options, assistantId: options.assistantId.trim() };
}

// Shared by launchers and workers; importing this module has no effects.
export function preparationEnvironment(env = process.env) {
  const allowed = [
    'PATH',
    'HOME',
    'USERPROFILE',
    'TMPDIR',
    'TMP',
    'TEMP',
    'SystemRoot',
    'COMSPEC',
    'PATHEXT',
    'LANG',
    'LC_ALL',
  ];
  return {
    ...Object.fromEntries(
      allowed
        .filter((key) => env[key] !== undefined)
        .map((key) => [key, env[key]])
    ),
    CI: 'true',
    NX_DAEMON: 'false',
    NX_TUI: 'false',
    NX_LOAD_DOT_ENV_FILES: 'false',
    NX_NO_CLOUD: 'true',
    // Nx's root dotenv loader must not reinstate the parent's proxy credential.
    NATIVE_LANGGRAPH_API_KEY: '',
    npm_config_legacy_peer_deps: 'false',
    NPM_CONFIG_LEGACY_PEER_DEPS: 'false',
  };
}

export function foundationCommands(root) {
  return ['core', 'content', 'react'].map((project) => ({
    command: process.execPath,
    args: [
      join(root, 'node_modules/nx/bin/nx.js'),
      'build',
      project,
      '--excludeTaskDependencies',
      '--skip-nx-cache',
      '--outputStyle=stream',
    ],
    cwd: root,
  }));
}
