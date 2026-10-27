import { defineConfig } from 'vite';

// Runs inside the installed React consumer: no workspace aliases or plugins.
export default defineConfig({
  plugins: [
    {
      name: 'verify-installed-text-transcript',
      generateBundle(_options, bundle) {
        const modules = Object.values(bundle).flatMap((output) =>
          output.type === 'chunk' ? Object.keys(output.modules) : []
        );
        if (
          !modules.some((path) =>
            path.includes(
              '/node_modules/@threadplane/react/src/chat/text-transcript.js'
            )
          )
        ) {
          throw new Error(
            'React app must use the installed chat component artifact'
          );
        }
      },
    },
  ],
  esbuild: { jsx: 'automatic' },
  build: { outDir: 'dist', emptyOutDir: true },
});
