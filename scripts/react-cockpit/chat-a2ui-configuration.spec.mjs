import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { reactCockpitConfiguration } from './configuration.mjs';

const read = (path) => readFileSync(path, 'utf8');
test('Website includes native A2UI build and installed terminal preparation edges', () => {
  const project = JSON.parse(read('apps/website/project.json'));
  assert.ok(project.implicitDependencies.includes('cockpit-chat-a2ui-react'));
  const edges = project.targets.e2e.dependsOn;
  assert.ok(edges.find(edge => edge.target === 'build').projects.includes('cockpit-chat-a2ui-react'));
  assert.deepEqual(edges.find(edge => edge.target === 'fixture-test'), { target: 'fixture-test', projects: ['cockpit-chat-a2ui-react'] });
});
test('A2UI has one frozen authored native frontend allocation', () => {
  assert.deepEqual(reactCockpitConfiguration('chat-a2ui'), {
    topic: 'a2ui', library: 'chat', adapter: 'langgraph',
    appPath: 'cockpit/chat/a2ui/react', base: '/chat/a2ui/react/',
    port: 4646, project: 'cockpit-chat-a2ui-react',
  });
  assert.ok(Object.isFrozen(reactCockpitConfiguration('chat-a2ui')));
  for (const key of ['a2ui', '../chat-a2ui', 'chat-a2ui/../debug', '/chat/a2ui/react/', 'chat-a2ui-remote'])
    assert.throws(() => reactCockpitConfiguration(key), /Unsupported/);
  assert.equal(reactCockpitConfiguration('chat-debug').port, 4645);
});
test('A2UI build and e2e depend on the installed package and terminal admission suites', () => {
  const project = JSON.parse(read('cockpit/chat/a2ui/react/project.json'));
  assert.ok(project.tags.includes('scope:cockpit-e2e'));
  assert.equal(project.targets.build.cache, false);
  assert.deepEqual(project.targets.build.dependsOn, [{ target: 'build', projects: ['core', 'content', 'react', 'a2ui'] }]);
  assert.equal(project.targets.build.options.command, 'node scripts/react-cockpit/build.mjs chat-a2ui');
  assert.deepEqual(project.targets.e2e.dependsOn, ['build', 'fixture-test']);
  assert.equal(project.targets.e2e.options.skipInstall, true);
  assert.equal(project.targets.e2e.options.config, 'cockpit/chat/a2ui/react/e2e/playwright.config.ts');
  assert.equal(project.targets['fixture-test'].options.command, 'node --test cockpit/chat/a2ui/react/fixtures/terminal-admission.spec.mjs');
  assert.deepEqual(project.targets['fixture-test'].dependsOn, project.targets.build.dependsOn);
});
test('only the A2UI topic packs its optional peer and selects the native A2UI profile', () => {
  const build = read('scripts/react-cockpit/build.mjs');
  assert.match(build, /const nativeA2ui = topic === 'a2ui'/);
  assert.match(build, /optionalPeers: nativeA2ui \? \['a2ui'\] : \[\]/);
  assert.match(build, /'react-native-a2ui-langgraph'/);
  for (const file of ['create-surfaces.js', 'parser.js', 'create-render-state.js', 'render-spec.js'])
    assert.ok(build.includes(file), 'Emitted implementation assertion: ' + file);
  assert.match(build, /module\.renderedLength > 0/);
});
test('production source copying excludes testing and preserves private fixture isolation', () => {
  const visit = (directory) => readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? visit(path) : /\.spec\.|fixture\.json$/.test(path) ? [] : [path];
  });
  for (const path of visit('cockpit/chat/a2ui/react/src'))
    assert.doesNotMatch(read(path), /chat-a2ui-(?:wire|fixture)|\/__(?:configure|reset|requests|captures|lifetime)/);
  const build = read('scripts/react-cockpit/build.mjs');
  assert.doesNotMatch(build, /chat-a2ui-(?:fixture|wire)/);
  assert.match(build, /testing/);
  const serve = read('scripts/react-cockpit/serve.mjs');
  assert.match(serve, /const isChatA2ui = configuration.library === 'chat' && configuration.topic === 'a2ui'/);
  assert.equal((serve.match(/createChatA2uiFixture\(\{ configuration: chatA2uiConfiguration \}\)/g) ?? []).length, 2);
  assert.match(serve, /chatA2uiConfiguration = Object.freeze\(fixtureConfiguration\(\)\)/);
  assert.match(serve, /await chatA2uiFixture.close\(\)/);
  assert.match(serve, /'\/__hold\/stream'/);
  assert.match(serve, /heldStreams/);
  assert.match(serve, /closedWorkers/);
});

test('shared aviation presentation is package-less and copied at its authored layout', () => {
  const project = JSON.parse(read('libs/cockpit-a2ui-react/project.json'));
  assert.equal(project.name,'cockpit-a2ui-react');
  assert.ok(!readdirSync('libs/cockpit-a2ui-react').includes('package.json'));
  assert.deepEqual(JSON.parse(read('cockpit/chat/a2ui/react/project.json')).implicitDependencies,['cockpit-a2ui-react']);
  const build = read('scripts/react-cockpit/build.mjs');
  assert.match(build,/join\(root, 'libs\/cockpit-a2ui-react\/src'\)/);
  assert.match(build,/join\(consumer, 'libs\/cockpit-a2ui-react\/src'\)/);
  assert.match(build,/\['testing', 'fixtures'\]/);
  const terminal=read('cockpit/chat/a2ui/react/src/terminal.ts');
  assert.match(terminal,/libs\/cockpit-a2ui-react\/src\/data\.js/);
  assert.doesNotMatch(terminal,/cockpit-a2ui-react\/src\/index/);
  const probe=read('scripts/react-cockpit/chat-a2ui-native-probe.mjs');
  assert.match(probe,/compiled\/cockpit\/chat\/a2ui\/react\/src\/terminal\.js/);
  assert.match(probe,/libs\/cockpit-a2ui-react\/src\/data\.ts/);
});
