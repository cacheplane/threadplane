import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';

const article = readFileSync(resolve(__dirname, '../../content/blog/2026-11-05-debugging-angular-agent-ui-ag-ui-devtools.mdx'), 'utf8');

function armHelper() {
  const source = article.match(/async function armNextRuns\([\s\S]+?\n}/)?.[0];
  if (!source) throw new Error('Missing documented approval helper');
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  // Execute the exact authored example, not a second implementation of it.
  return new Function(`${js}\nreturn armNextRuns;`)() as (
    page: { evaluate: (callback: (runs: unknown[]) => Promise<void>, runs: unknown[]) => Promise<void> },
    runs: unknown[]
  ) => Promise<void>;
}

const page = {
  evaluate: (callback: (runs: unknown[]) => Promise<void>, runs: unknown[]) => callback(runs),
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('DevTools article executable examples', () => {
  it('uses valid JavaScript for both browser-console examples', () => {
    const samples = [...article.matchAll(/```js\n([\s\S]+?)\n```/g)]
      .map((match) => match[1])
      .filter((source) => source.includes("window.addEventListener('threadplane:devtools'"));
    expect(samples).toHaveLength(2);
    for (const source of samples) expect(() => new Function(source)).not.toThrow();
  });

  it.each(['armed', 'rejected'] as const)('handles a matching %s acknowledgement and removes its listener', async (state) => {
    vi.useFakeTimers();
    const remove = vi.spyOn(window, 'removeEventListener');
    const onArm = (event: Event) => {
      const { armId } = (event as CustomEvent).detail;
      window.dispatchEvent(new CustomEvent('threadplane:devtools:ack', {
        detail: { armId: 'unrelated', state: 'armed' },
      }));
      window.dispatchEvent(new CustomEvent('threadplane:devtools:ack', {
        detail: { armId, state, reason: 'invalid event sequence' },
      }));
    };
    window.addEventListener('threadplane:devtools:arm', onArm);
    try {
      const pending = armHelper()(page, []);
      if (state === 'armed') await expect(pending).resolves.toBeUndefined();
      else await expect(pending).rejects.toThrow('invalid event sequence');
      expect(remove).toHaveBeenCalledWith('threadplane:devtools:ack', expect.any(Function));
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      window.removeEventListener('threadplane:devtools:arm', onArm);
    }
  });

  it('fails with a bounded timeout when the development hooks are absent', async () => {
    vi.useFakeTimers();
    const remove = vi.spyOn(window, 'removeEventListener');
    const rejected = expect(armHelper()(page, [])).rejects.toThrow('development agent hooks');
    await vi.advanceTimersByTimeAsync(3000);
    await rejected;
    expect(remove).toHaveBeenCalledWith('threadplane:devtools:ack', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
});
