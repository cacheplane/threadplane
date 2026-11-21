import { extname } from 'node:path';
import { selectedFramework } from './commands.mjs';

const native = 'examples/chat/native/';
const tokens = 'libs/design-tokens/src/lib/tokens.css';
const extensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.css',
  '.json',
  '.html',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.txt',
]);
const authored = (path) =>
  /^(?:examples\/chat\/native\/(?:shared|(?:react|angular)\/(?:src|public)))(?:\/|$)/.test(
    path
  );
// A backend's install-bridge stubs are tracked sources its runtime imports, so
// they are inputs. Everything else under `.install-collector` is generated,
// machine-specific collector output and stays out. The folder itself is
// walked so the stubs can be reached; each other file in it is excluded.
const installCollector = /^libs\/[^/]+\/\.install-collector$/;
const installStub =
  /^libs\/[^/]+\/\.install-collector\/development-install\.(?:mjs|d\.ts|d\.mts)$/;
export const excludedSourcePath = (path) =>
  !installCollector.test(path) &&
  !installStub.test(path) &&
  path
    .split('/')
    .some(
      (part) =>
        (authored(path) &&
          (part.startsWith('.') || /(?:~|\.sw[pox])$|^#.+#$/.test(part))) ||
        /(?:^|\.)env(?:\.|$)/i.test(part) ||
        [
          '.git',
          '.nx',
          '.cache',
          '.install-collector',
          'node_modules',
          'dist',
          'out',
          'coverage',
          'build',
        ].includes(part) ||
        /\.(?:pem|key|p12|pfx|tsbuildinfo)$/i.test(part)
    );

export function mirrorDestination(path, framework) {
  const selected = selectedFramework(framework);
  if (excludedSourcePath(path)) return undefined;
  if (path === tokens) return 'shared/tokens.css';
  if (!path.startsWith(native)) return undefined;
  const local = path.slice(native.length);
  if (selected === 'react' && local === 'react/index.html') return local;
  if (local === 'shared/browser-config.json' || local === 'shared/tokens.css')
    return undefined;
  return (local.startsWith('shared/') ||
    local.startsWith(selected + '/src/') ||
    local.startsWith(selected + '/public/')) &&
    extensions.has(extname(local))
    ? local
    : undefined;
}
