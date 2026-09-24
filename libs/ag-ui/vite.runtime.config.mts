import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  test: {
    environment: 'node',
    reporters: ['default'],
    include: ['src/runtime/**/*.spec.ts'],
    passWithNoTests: false,
  },
});
