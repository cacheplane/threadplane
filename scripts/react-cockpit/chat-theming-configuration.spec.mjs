import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { reactCockpitConfiguration } from './configuration.mjs';

test('theming is an exact closed native LangGraph topic', () => {
  assert.deepEqual(reactCockpitConfiguration('chat-theming'), {
    topic: 'theming',
    library: 'chat',
    adapter: 'langgraph',
    appPath: 'cockpit/chat/theming/react',
    base: '/chat/theming/react/',
    port: 4644,
    project: 'cockpit-chat-theming-react',
  });
  assert.ok(Object.isFrozen(reactCockpitConfiguration('chat-theming')));
  for (const topic of [
    'theming',
    '../chat-theming',
    'chat-theming/../../',
    'chat-theming-remote',
  ])
    assert.throws(() => reactCockpitConfiguration(topic), /Unsupported/);
  assert.equal(reactCockpitConfiguration('chat-messages').port, 4620);
  assert.equal(reactCockpitConfiguration('runtimes-aws-strands').port, 4643);
});

test('theming production inputs exclude local fixture and controls', () => {
  const root = resolve('cockpit/chat/theming/react/src');
  const visit = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const path = resolve(dir, name);
      return statSync(path).isDirectory()
        ? visit(path)
        : /\.spec\./.test(path)
        ? []
        : [path];
    });
  for (const path of visit(root))
    assert.doesNotMatch(
      readFileSync(path, 'utf8'),
      /chat-theming-(?:wire|fixture)|\/__(?:release|history|requests|graph-proof|lifetime)/
    );
  const build = readFileSync('scripts/react-cockpit/build.mjs', 'utf8');
  assert.match(build, /cpSync\(join\(root, appPath, 'src'\)/);
  assert.doesNotMatch(build, /chat-theming-fixture|chat-theming-wire/);
});
