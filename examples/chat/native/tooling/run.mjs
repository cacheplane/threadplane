import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  preparationEnvironment,
  validateServeOptions,
  selectedFramework,
} from './commands.mjs';
import { readProxyConfiguration } from './proxy.mjs';
export { preparationEnvironment, foundationCommands } from './commands.mjs';

export function parseOptions(args, env = process.env) {
  const mode = args[0];
  if (!['build', 'serve', 'test'].includes(mode))
    throw new Error('Expected build, serve or test');
  let explicit, port, testNamePattern, framework;
  for (let index = 1; index < args.length; index++) {
    const arg = args[index];
    if (arg.startsWith('--framework=')) {
      if (framework !== undefined)
        throw new Error('Duplicate framework selection');
      framework = selectedFramework(arg.slice('--framework='.length));
      continue;
    }
    if (
      mode === 'test' &&
      (arg === '--test-name-pattern' || arg.startsWith('--test-name-pattern='))
    ) {
      const value =
        arg === '--test-name-pattern'
          ? args[++index]
          : arg.slice('--test-name-pattern='.length);
      if (testNamePattern !== undefined || !value || value.startsWith('--'))
        throw new Error('Invalid or duplicate test-name-pattern');
      testNamePattern = value;
      continue;
    }
    if (mode === 'serve' && arg.startsWith('--port=')) {
      const value = arg.slice('--port='.length);
      if (
        port !== undefined ||
        !/^[1-9]\d*$/.test(value) ||
        Number(value) > 65535
      )
        throw new Error('Invalid or duplicate serve port');
      port = Number(value);
      continue;
    }
    if (!arg.startsWith('--configuration=') || explicit !== undefined)
      throw new Error(`Unsupported or duplicate ${mode} argument`);
    explicit = arg.slice('--configuration='.length);
  }
  const fromNx = env.NX_TASK_TARGET_CONFIGURATION;
  if (explicit && fromNx && explicit !== fromNx)
    throw new Error(`Conflicting ${mode} configurations`);
  const configuration =
    explicit ?? fromNx ?? (mode === 'serve' ? 'development' : 'production');
  if (!['development', 'production'].includes(configuration))
    throw new Error('Unsupported build configuration');
  const assistantId = env.NATIVE_ASSISTANT_ID?.trim() ?? '';
  if (mode === 'serve') {
    if (configuration !== 'development')
      throw new Error('Serve requires development configuration');
    readProxyConfiguration(env);
    if (!assistantId)
      throw new Error(
        'Set NATIVE_ASSISTANT_ID to a non-empty assistant identifier.'
      );
    // Installed Vite treats zero as its default port; require a strict positive port.
    return validateServeOptions({
      ...(framework === undefined ? {} : { framework }),
      configuration,
      assistantId,
      port: port ?? (framework === 'angular' ? 4302 : 4301),
    });
  }
  return {
    ...(framework === undefined ? {} : { framework }),
    configuration,
    assistantId,
    ...(testNamePattern === undefined ? {} : { testNamePattern }),
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const options = parseOptions(process.argv.slice(2));
    const root = fileURLToPath(new URL('../../../../', import.meta.url));
    if (process.argv[2] === 'serve') {
      const { startServe } = await import('./serve.mjs');
      const lifetime = startServe({ root, options });
      await lifetime.closed;
    } else {
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL('./consumer.mjs', import.meta.url)),
          process.argv[2] === 'test' ? '--test-worker' : '--worker',
          root,
          JSON.stringify(options),
        ],
        {
          cwd: root,
          env: preparationEnvironment(),
          stdio: 'inherit',
        }
      );
      if (result.error) throw result.error;
      process.exitCode = result.status ?? 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
