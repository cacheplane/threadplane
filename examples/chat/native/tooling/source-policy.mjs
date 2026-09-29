import { extname } from 'node:path';

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
  /^(?:examples\/chat\/native\/(?:shared|react\/(?:src|public)))(?:\/|$)/.test(
    path
  );
export const excludedSourcePath = (path) =>
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

export function mirrorDestination(path) {
  if (excludedSourcePath(path)) return undefined;
  if (path === tokens) return 'shared/tokens.css';
  if (!path.startsWith(native)) return undefined;
  const local = path.slice(native.length);
  if (local === 'react/index.html') return local;
  if (local === 'shared/browser-config.json' || local === 'shared/tokens.css')
    return undefined;
  return /^(?:shared\/|react\/(?:src|public)\/)/.test(local) &&
    extensions.has(extname(local))
    ? local
    : undefined;
}
