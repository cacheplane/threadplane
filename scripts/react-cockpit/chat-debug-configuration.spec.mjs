import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { reactCockpitConfiguration } from './configuration.mjs';

test('debug has one exact closed native LangGraph allocation', () => {
  assert.deepEqual(reactCockpitConfiguration('chat-debug'), {
    topic: 'debug',
    library: 'chat',
    adapter: 'langgraph',
    appPath: 'cockpit/chat/debug/react',
    base: '/chat/debug/react/',
    port: 4645,
    project: 'cockpit-chat-debug-react',
    backend: {
      kind: 'aimock-langgraph',
      python: 'cockpit/chat/debug/python',
      fixtures: 'cockpit/chat/debug/angular/e2e/fixtures',
      langgraphPort: 5645,
    },
  });
  assert.ok(Object.isFrozen(reactCockpitConfiguration('chat-debug')));
  for (const key of [
    'debug',
    '../chat-debug',
    'chat-debug/../../',
    'chat-debug-remote',
    '/chat/debug/react/',
  ])
    assert.throws(() => reactCockpitConfiguration(key), /Unsupported/);
  assert.equal(reactCockpitConfiguration('chat-theming').port, 4644);
  assert.equal(reactCockpitConfiguration('chat-messages').port, 4620);
  assert.equal(reactCockpitConfiguration('runtimes-aws-strands').port, 4643);
  const registry = readFileSync(
    'libs/cockpit-registry/src/lib/capability-registry.ts',
    'utf8'
  );
  assert.match(
    registry,
    /id: 'c-debug'[^\n]+port: 4509, react: \{ project: 'cockpit-chat-debug-react', port: 4645 \}, pythonPort: 5509/
  );
});

test('debug production inputs exclude local test backends and controls', () => {
  const visit = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const path = resolve(dir, name);
      return statSync(path).isDirectory()
        ? visit(path)
        : /\.spec\.|fixture\.json$/.test(path)
        ? []
        : [path];
    });
  for (const path of visit(resolve('cockpit/chat/debug/react/src')))
    assert.doesNotMatch(
      readFileSync(path, 'utf8'),
      /aimock-backend|langgraph-proxy|\/__(?:release|hold|reset|requests|captures|lifetime)/
    );
  assert.doesNotMatch(
    readFileSync('scripts/react-cockpit/build.mjs', 'utf8'),
    /aimock-backend|langgraph-proxy/
  );
});
