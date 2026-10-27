import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { relative } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const consumer = fileURLToPath(new URL('..', import.meta.url));

// Only the future serve owner supplies this origin after binding its proxy.
// This helper is pure; production builds need no running proxy or upstream.
export function createApiProxy(ownedOrigin?: string) {
  if (ownedOrigin === undefined) return {};
  if (!/^http:\/\/127\.0\.0\.1:[1-9]\d*$/.test(ownedOrigin))
    throw new Error('Expected an owned loopback proxy origin.');
  let parsed: URL;
  try {
    parsed = new URL(ownedOrigin);
  } catch {
    throw new Error('Expected an owned loopback proxy origin.');
  }
  if (Number(parsed.port) > 65535 || parsed.origin !== ownedOrigin)
    throw new Error('Expected an owned loopback proxy origin.');
  return {
    '^/api(?:/|\\?|$)': {
      target: ownedOrigin,
      followRedirects: false,
    },
  };
}

export default defineConfig(({ mode }) => ({
  root,
  envDir: false,
  esbuild: { jsx: 'automatic' },
  server: { proxy: createApiProxy(process.env.NATIVE_PROXY_ORIGIN) },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: mode === 'production',
    sourcemap: false,
  },
  plugins: [
    {
      name: 'native-build-inputs',
      generateBundle() {
        const inputs = [...this.getModuleIds()]
          .filter((id) => !id.startsWith('\0'))
          .map((id) =>
            relative(consumer, id.split('?')[0]).replaceAll('\\', '/')
          );
        this.emitFile({
          type: 'asset',
          fileName: 'build-inputs.json',
          source: JSON.stringify([...new Set(inputs)].sort(), null, 2) + '\n',
        });
      },
    },
  ],
}));
