import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const read = (name: string) =>
  readFileSync(new URL(name, import.meta.url), 'utf8');
it('uses a desktop chat/sidebar grid and bounded mobile stacking', () => {
  const css = read('./styles.css');
  expect(css).toMatch(
    /\.skills-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*2fr\)\s+minmax\(0,\s*1fr\)/
  );
  expect(css).toMatch(/\.skill-panels\s*\{[^}]*flex-direction:\s*column/);
  expect(css).toMatch(
    /@media[^}]*\.skills-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/
  );
  expect(css).toMatch(
    /\.skill-panels\s*>\s*section\s*\{[^}]*max-height:[^}]*overflow:\s*auto/
  );
  expect(css).toMatch(
    /\.skills-demo\s+\.tp-chat-list\s*\{[^}]*max-height:[^}]*overflow:\s*auto/
  );
});
it('mounts only after runtime configuration, marks readiness, and releases on pagehide', () => {
  const source = read('./main.tsx');
  expect(source).toContain('awaitConfiguration()');
  expect(source.indexOf('awaitConfiguration()')).toBeLessThan(
    source.indexOf('root.render(')
  );
  expect(source).toContain('bridge.markReady()');
  expect(source).toContain("'pagehide'");
  expect(source).toContain('root.unmount()');
  expect(source).toContain('bridge.dispose()');
  expect(source).toContain('GENERATED_RUNTIME_PARENT_ORIGINS');
});
it('uses native React surfaces and keeps ownership inside the Skills app', () => {
  const source = read('./app.tsx');
  for (const name of [
    'useAgent',
    'MessageList',
    'Markdown',
    'ChatInput',
    'ToolObservation',
  ])
    expect(source).toContain(name);
  expect(source).not.toMatch(
    /subagents|deep_agents\.skills|dangerouslySetInnerHTML/
  );
  expect(read('./styles.css')).toContain('overflow-wrap: anywhere');
  expect(read('./styles.css')).toContain('@media');
});
