import { defineConfig } from 'vitest/config';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: [
      {
        find: /^@threadplane\/langgraph$/,
        replacement: fileURLToPath(
          new URL(
            '../../../../libs/langgraph/src/runtime/create-session.ts',
            import.meta.url
          )
        ),
      },
    ],
  },
  plugins: [nxViteTsPaths()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.tsx'],
    passWithNoTests: false,
  },
});
