import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  events: [] as string[],
  generated: '',
  exec: vi.fn(),
  manifest: vi.fn(),
}));
vi.mock('node:child_process', () => ({ execFileSync: state.exec }));
vi.mock('node:fs', async (original) => ({
  ...(await original<typeof import('node:fs')>()),
  readFileSync: () =>
    JSON.stringify({ baseOrigins: ['https://threadplane.ai'] }),
  writeFileSync: (_path: string, contents: string) => {
    state.generated = contents;
    state.events.push('policy');
  },
}));
vi.mock('./example-build-artifacts', async (original) => ({
  ...(await original<typeof import('./example-build-artifacts')>()),
  writeExampleBuildManifest: state.manifest,
}));
const argv = process.argv;
beforeEach(() => {
  vi.resetModules();
  state.events.length = 0;
  state.generated = '';
  state.exec.mockReset();
  state.manifest
    .mockReset()
    .mockImplementation(() => state.events.push('manifest'));
  process.argv = [argv[0], 'build-example-shard.ts', '1'];
  vi.stubEnv(
    'RUNTIME_PARENT_PREVIEW_ORIGINS',
    'https://threadplane-pr-test-cacheplane.vercel.app'
  );
});
afterEach(() => {
  process.argv = argv;
  vi.unstubAllEnvs();
});

it.each([false, true])(
  'compiles the preview policy before building and emits proof only after success (failure=%s)',
  async (failure) => {
    state.exec.mockImplementation((command: string) => {
      if (command === 'npx') {
        expect(state.generated).toContain(
          'https://threadplane-pr-test-cacheplane.vercel.app'
        );
        state.events.push('build');
        if (failure) throw new Error('build failed');
      } else {
        expect(command).toBe('git');
        state.events.push('revision');
        return 'a'.repeat(40) + '\n';
      }
    });
    if (failure) {
      await expect(import('./build-example-shard')).rejects.toThrow(
        'build failed'
      );
      expect(state.events).toEqual(['policy', 'build']);
      expect(state.manifest).not.toHaveBeenCalled();
    } else {
      await import('./build-example-shard');
      expect(state.events).toEqual(['policy', 'build', 'revision', 'manifest']);
      expect(state.exec.mock.calls[0][1]).toEqual(
        expect.arrayContaining(['--skip-nx-cache'])
      );
      expect(state.manifest.mock.calls[0][4]).toBe('a'.repeat(40));
    }
  }
);
