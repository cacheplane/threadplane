import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { deriveCockpitCaps, selectCockpitCaps } from './cockpit-matrix.mjs';
test('Chat Interrupts owns an explicit native React identity separate from LangGraph', async () => {
  const { reactCockpitConfiguration } = await import('./react-cockpit/configuration.mjs');
  assert.deepEqual(reactCockpitConfiguration('chat-interrupts'), {
    topic: 'interrupts', library: 'chat', adapter: 'langgraph', appPath: 'cockpit/chat/interrupts/react',
    base: '/chat/interrupts/react/', port: 4622, project: 'cockpit-chat-interrupts-react',
  });
  assert.equal(reactCockpitConfiguration('interrupts').appPath, 'cockpit/langgraph/interrupts/react');
  for (const key of ['chat/interrupts', '../chat-interrupts'])
    assert.throws(() => reactCockpitConfiguration(key), /Unsupported React cockpit topic/);
});
test('Chat Input owns a closed native React identity', async () => {
  const { reactCockpitConfiguration } = await import('./react-cockpit/configuration.mjs');
  assert.deepEqual(reactCockpitConfiguration('chat-input'), {
    topic: 'input', adapter: 'langgraph', appPath: 'cockpit/chat/input/react',
    base: '/chat/input/react/', port: 4621, project: 'cockpit-chat-input-react',
  });
  for (const key of ['input', 'chat/input', '../chat-input'])
    assert.throws(() => reactCockpitConfiguration(key), /Unsupported React cockpit topic/);
});
test('Chat Messages owns a closed native React identity', async () => {
  const { reactCockpitConfiguration } = await import('./react-cockpit/configuration.mjs');
  assert.deepEqual(reactCockpitConfiguration('chat-messages'), {
    topic: 'messages', adapter: 'langgraph', appPath: 'cockpit/chat/messages/react',
    base: '/chat/messages/react/', port: 4620, project: 'cockpit-chat-messages-react',
  });
  for (const key of ['messages', 'chat/messages', '../chat-messages'])
    assert.throws(() => reactCockpitConfiguration(key), /Unsupported React cockpit topic/);
});
test('Computed Functions owns a closed static React identity', async () => {
  const { reactCockpitConfiguration } = await import('./react-cockpit/configuration.mjs');
  assert.deepEqual(reactCockpitConfiguration('render-computed-functions'), {
    topic: 'computed-functions', adapter: 'none',
    appPath: 'cockpit/render/computed-functions/react',
    base: '/render/computed-functions/react/', port: 4619,
    project: 'cockpit-render-computed-functions-react',
  });
  for (const key of ['computed-functions', 'render/computed-functions', '../render-computed-functions'])
    assert.throws(() => reactCockpitConfiguration(key), /Unsupported React cockpit topic/);
});

test('Element Rendering has a closed local nineteenth React identity', async () => {
  const { reactCockpitConfiguration } = await import(
    './react-cockpit/configuration.mjs'
  );
  assert.deepEqual(reactCockpitConfiguration('render-element-rendering'), {
    topic: 'element-rendering',
    adapter: 'none',
    appPath: 'cockpit/render/element-rendering/react',
    base: '/render/element-rendering/react/',
    port: 4618,
    project: 'cockpit-render-element-rendering-react',
  });
  for (const key of [
    'element-rendering',
    'render/element-rendering',
    '../render-element-rendering',
  ])
    assert.throws(
      () => reactCockpitConfiguration(key),
      /Unsupported React cockpit topic/
    );
});
test('Registry has a closed local eighteenth React identity', async () => {
  const { reactCockpitConfiguration } = await import('./react-cockpit/configuration.mjs');
  assert.deepEqual(reactCockpitConfiguration('render-registry'), {
    topic: 'registry', adapter: 'none', appPath: 'cockpit/render/registry/react',
    base: '/render/registry/react/', port: 4617, project: 'cockpit-render-registry-react',
  });
  for (const key of ['registry', 'render/registry', '../render-registry'])
    assert.throws(() => reactCockpitConfiguration(key), /Unsupported React cockpit topic/);
});
test('Repeat Loops has a closed local seventeenth React identity', async () => {
  const { reactCockpitConfiguration } = await import('./react-cockpit/configuration.mjs');
  assert.deepEqual(reactCockpitConfiguration('render-repeat-loops'), {
    topic: 'repeat-loops', adapter: 'none', appPath: 'cockpit/render/repeat-loops/react',
    base: '/render/repeat-loops/react/', port: 4616, project: 'cockpit-render-repeat-loops-react',
  });
  for (const key of ['repeat-loops', 'render/repeat-loops', '../render-repeat-loops'])
    assert.throws(() => reactCockpitConfiguration(key), /Unsupported React cockpit topic/);
});
test('State Management has a closed local sixteenth React identity', async () => {
  const { reactCockpitConfiguration } = await import('./react-cockpit/configuration.mjs');
  assert.deepEqual(reactCockpitConfiguration('render-state-management'), {
    topic: 'state-management', adapter: 'none',
    appPath: 'cockpit/render/state-management/react',
    base: '/render/state-management/react/', port: 4615,
    project: 'cockpit-render-state-management-react',
  });
  for (const key of ['state-management', 'render/state-management', '../render-state-management'])
    assert.throws(() => reactCockpitConfiguration(key), /Unsupported React cockpit topic/);
});
test('Spec Rendering has a closed local fifteenth React identity', async () => {
  const { reactCockpitConfiguration } = await import('./react-cockpit/configuration.mjs');
  assert.deepEqual(reactCockpitConfiguration('render-spec-rendering'), {
    topic: 'spec-rendering', adapter: 'none',
    appPath: 'cockpit/render/spec-rendering/react',
    base: '/render/spec-rendering/react/', port: 4614,
    project: 'cockpit-render-spec-rendering-react',
  });
  for (const key of ['spec-rendering', 'render/spec-rendering', '../render-spec-rendering'])
    assert.throws(() => reactCockpitConfiguration(key), /Unsupported React cockpit topic/);
});
test('Subagents has a closed fourteenth React identity', async () => {
  const { reactCockpitConfiguration } = await import('./react-cockpit/configuration.mjs');
  assert.deepEqual(reactCockpitConfiguration('ag-ui-subagents'), { topic: 'subagents', adapter: 'ag-ui', appPath: 'cockpit/ag-ui/subagents/react', base: '/ag-ui/subagents/react/', port: 4613, project: 'cockpit-ag-ui-subagents-react' });
  for (const key of ['subagents', 'ag-ui/subagents', '../ag-ui-subagents']) assert.throws(() => reactCockpitConfiguration(key), /Unsupported React cockpit topic/);
});

test('JSON Render has a closed thirteenth React identity and all routes remain unique',async()=>{
  const {reactCockpitConfiguration}=await import('./react-cockpit/configuration.mjs');
  assert.deepEqual(reactCockpitConfiguration('ag-ui-json-render'),{
    topic:'json-render',adapter:'ag-ui',appPath:'cockpit/ag-ui/json-render/react',base:'/ag-ui/json-render/react/',port:4612,project:'cockpit-ag-ui-json-render-react',
  });
  const configurations=['streaming','interrupts','memory','client-tools','persistence','durable-execution','subgraphs','time-travel','deployment-runtime','ag-ui-streaming','ag-ui-interrupts','ag-ui-tool-views','ag-ui-json-render','ag-ui-subagents'].map(reactCockpitConfiguration);
  for(const field of ['appPath','base','port','project'])assert.equal(new Set(configurations.map(configuration=>configuration[field])).size,14);
  for(const key of ['json-render','ag-ui/json-render','../ag-ui-json-render'])assert.throws(()=>reactCockpitConfiguration(key),/Unsupported React cockpit topic/);
});

test('AG-UI Tool Views has a closed twelfth identity with no overlapping runtime', async () => {
  const { reactCockpitConfiguration } = await import('./react-cockpit/configuration.mjs');
  assert.deepEqual(reactCockpitConfiguration('ag-ui-tool-views'), {
    topic: 'tool-views', adapter: 'ag-ui', appPath: 'cockpit/ag-ui/tool-views/react',
    base: '/ag-ui/tool-views/react/', port: 4611, project: 'cockpit-ag-ui-tool-views-react',
  });
  const configurations = [
    'streaming', 'interrupts', 'memory', 'client-tools', 'persistence',
    'durable-execution', 'subgraphs', 'time-travel', 'deployment-runtime',
    'ag-ui-streaming', 'ag-ui-interrupts', 'ag-ui-tool-views',
  ].map(reactCockpitConfiguration);
  for (const field of ['appPath', 'base', 'port', 'project'])
    assert.equal(new Set(configurations.map(configuration => configuration[field])).size, 12);
  for (const key of ['ag-ui/tool-views', '../ag-ui-tool-views', 'tool-views'])
    assert.throws(() => reactCockpitConfiguration(key), /Unsupported React cockpit topic/);
});

test('AG-UI Streaming has a closed React identity distinct from LangGraph Streaming', async () => {
  const { reactCockpitConfiguration } = await import(
    './react-cockpit/configuration.mjs'
  );
  assert.deepEqual(reactCockpitConfiguration('ag-ui-streaming'), {
    topic: 'streaming',
    adapter: 'ag-ui',
    appPath: 'cockpit/ag-ui/streaming/react',
    base: '/ag-ui/streaming/react/',
    port: 4609,
    project: 'cockpit-ag-ui-streaming-react',
  });
  assert.equal(
    reactCockpitConfiguration('streaming').appPath,
    'cockpit/langgraph/streaming/react'
  );
  for (const key of [
    'ag-ui/streaming',
    'ag-ui/interrupts',
    '../ag-ui-streaming',
  ])
    assert.throws(
      () => reactCockpitConfiguration(key),
      /Unsupported React cockpit topic/
    );
});

test('AG-UI Interrupts has a closed identity and all eleven React previews remain unique', async () => {
  const { reactCockpitConfiguration } = await import(
    './react-cockpit/configuration.mjs'
  );
  assert.deepEqual(reactCockpitConfiguration('ag-ui-interrupts'), {
    topic: 'interrupts',
    adapter: 'ag-ui',
    appPath: 'cockpit/ag-ui/interrupts/react',
    base: '/ag-ui/interrupts/react/',
    port: 4610,
    project: 'cockpit-ag-ui-interrupts-react',
  });
  assert.equal(
    reactCockpitConfiguration('interrupts').appPath,
    'cockpit/langgraph/interrupts/react'
  );
  const configurations = [
    'streaming',
    'interrupts',
    'memory',
    'client-tools',
    'persistence',
    'durable-execution',
    'subgraphs',
    'time-travel',
    'deployment-runtime',
    'ag-ui-streaming',
    'ag-ui-interrupts',
  ].map(reactCockpitConfiguration);
  for (const field of ['appPath', 'base', 'port', 'project'])
    assert.equal(
      new Set(configurations.map((configuration) => configuration[field])).size,
      11
    );
  for (const key of [
    'ag-ui/interrupts',
    '../ag-ui-interrupts',
    'ag-ui-unknown',
  ])
    assert.throws(
      () => reactCockpitConfiguration(key),
      /Unsupported React cockpit topic/
    );
});

test('React cockpit configuration accepts only the nine authored topics', async () => {
  const { reactCockpitConfiguration } = await import(
    './react-cockpit/configuration.mjs'
  );
  assert.equal(reactCockpitConfiguration().topic, 'streaming');
  assert.equal(reactCockpitConfiguration().port, 4600);
  assert.deepEqual(reactCockpitConfiguration('deployment-runtime'), {
    topic: 'deployment-runtime',
    appPath: 'cockpit/langgraph/deployment-runtime/react',
    base: '/langgraph/deployment-runtime/react/',
    port: 4608,
    project: 'cockpit-langgraph-deployment-runtime-react',
  });
  assert.deepEqual(reactCockpitConfiguration('time-travel'), {
    topic: 'time-travel',
    appPath: 'cockpit/langgraph/time-travel/react',
    base: '/langgraph/time-travel/react/',
    port: 4607,
    project: 'cockpit-langgraph-time-travel-react',
  });
  assert.deepEqual(reactCockpitConfiguration('subgraphs'), {
    topic: 'subgraphs',
    appPath: 'cockpit/langgraph/subgraphs/react',
    base: '/langgraph/subgraphs/react/',
    port: 4606,
    project: 'cockpit-langgraph-subgraphs-react',
  });
  assert.deepEqual(reactCockpitConfiguration('durable-execution'), {
    topic: 'durable-execution',
    appPath: 'cockpit/langgraph/durable-execution/react',
    base: '/langgraph/durable-execution/react/',
    port: 4605,
    project: 'cockpit-langgraph-durable-execution-react',
  });
  assert.deepEqual(reactCockpitConfiguration('persistence'), {
    topic: 'persistence',
    appPath: 'cockpit/langgraph/persistence/react',
    base: '/langgraph/persistence/react/',
    port: 4604,
    project: 'cockpit-langgraph-persistence-react',
  });
  assert.deepEqual(reactCockpitConfiguration('interrupts'), {
    topic: 'interrupts',
    appPath: 'cockpit/langgraph/interrupts/react',
    base: '/langgraph/interrupts/react/',
    port: 4601,
    project: 'cockpit-langgraph-interrupts-react',
  });
  assert.deepEqual(reactCockpitConfiguration('memory'), {
    topic: 'memory',
    appPath: 'cockpit/langgraph/memory/react',
    base: '/langgraph/memory/react/',
    port: 4602,
    project: 'cockpit-langgraph-memory-react',
  });
  assert.deepEqual(reactCockpitConfiguration('client-tools'), {
    topic: 'client-tools',
    appPath: 'cockpit/langgraph/client-tools/react',
    base: '/langgraph/client-tools/react/',
    port: 4603,
    project: 'cockpit-langgraph-client-tools-react',
  });
  for (const topic of [
    'unknown',
    '../streaming',
    '/tmp',
    '',
    'streaming/react',
  ])
    assert.throws(
      () => reactCockpitConfiguration(topic),
      /Unsupported React cockpit topic/
    );
});

test('CI discovers twelve React previews across both protocols with their own Python backends', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cockpit-react-topics-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const topic of [
    'streaming',
    'interrupts',
    'memory',
    'client-tools',
    'persistence',
    'durable-execution',
    'subgraphs',
    'time-travel',
    'deployment-runtime',
  ]) {
    for (const frontend of ['angular', 'react', 'python']) {
      const directory = join(root, 'cockpit/langgraph', topic, frontend);
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, 'project.json'),
        JSON.stringify({
          name: `cockpit-langgraph-${topic}-${frontend}`,
          targets: frontend === 'python' ? {} : { e2e: {} },
        })
      );
    }
  }
  for (const topic of ['streaming', 'interrupts', 'tool-views','json-render','subagents']) for (const frontend of ['angular', 'react', 'python']) {
    const directory = join(root, 'cockpit/ag-ui', topic, frontend);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'project.json'),
      JSON.stringify({
        name: `cockpit-ag-ui-${topic}-${frontend}`,
        targets: frontend === 'python' ? {} : { e2e: {} },
      })
    );
  }
  const caps = deriveCockpitCaps(root);
  assert.equal(caps.length, 28);
  const agUi = selectCockpitCaps(
    caps,
    new Set(['cockpit-ag-ui-streaming-python']),
    { fullFleet: false }
  );
  assert.equal(agUi.length, 2);
  assert.ok(
    agUi.every((cap) => cap.python === 'cockpit/ag-ui/streaming/python')
  );
  assert.ok(
    agUi.some((cap) => cap.angular === 'cockpit-ag-ui-streaming-react')
  );
  const interrupts = selectCockpitCaps(caps, new Set(['cockpit-ag-ui-interrupts-python']), { fullFleet: false });
  assert.equal(interrupts.length, 2);
  assert.ok(interrupts.every(cap => cap.python === 'cockpit/ag-ui/interrupts/python'));
  assert.ok(interrupts.some(cap => cap.angular === 'cockpit-ag-ui-interrupts-react'));
  const toolViews = selectCockpitCaps(caps, new Set(['cockpit-ag-ui-tool-views-python']), { fullFleet: false });
  assert.equal(toolViews.length, 2);
  assert.ok(toolViews.every(cap => cap.python === 'cockpit/ag-ui/tool-views/python'));
  assert.ok(toolViews.some(cap => cap.angular === 'cockpit-ag-ui-tool-views-react'));
  const jsonRender=selectCockpitCaps(caps,new Set(['cockpit-ag-ui-json-render-python']),{fullFleet:false});
  assert.equal(jsonRender.length,2);
  assert.ok(jsonRender.every(cap=>cap.python==='cockpit/ag-ui/json-render/python'));
  assert.ok(jsonRender.some(cap=>cap.angular==='cockpit-ag-ui-json-render-react'));
  for (const topic of [
    'streaming',
    'interrupts',
    'memory',
    'client-tools',
    'persistence',
    'durable-execution',
    'subgraphs',
    'time-travel',
    'deployment-runtime',
  ]) {
    const selected = selectCockpitCaps(
      caps,
      new Set([`cockpit-langgraph-${topic}-python`]),
      { fullFleet: false }
    );
    assert.equal(selected.length, 2);
    assert.ok(
      selected.every(
        (cap) => cap.python === `cockpit/langgraph/${topic}/python`
      )
    );
    assert.ok(
      selected.some((cap) => cap.angular === `cockpit-langgraph-${topic}-react`)
    );
  }
});

test('CI discovers both streaming frontends and attributes their shared backend', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cockpit-frontends-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const frontend of ['angular', 'react', 'python']) {
    const directory = join(root, 'cockpit/langgraph/streaming', frontend);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'project.json'),
      JSON.stringify({
        name: `cockpit-langgraph-streaming-${frontend}`,
        targets: frontend === 'python' ? {} : { e2e: {} },
      })
    );
  }
  const caps = deriveCockpitCaps(root);
  assert.deepEqual(
    caps.map((cap) => cap.angular),
    ['cockpit-langgraph-streaming-angular', 'cockpit-langgraph-streaming-react']
  );
  assert.ok(
    caps.every((cap) => cap.python === 'cockpit/langgraph/streaming/python')
  );
  assert.deepEqual(
    selectCockpitCaps(caps, new Set(['cockpit-langgraph-streaming-python']), {
      fullFleet: false,
    }),
    caps
  );
  assert.deepEqual(
    selectCockpitCaps(caps, new Set(['cockpit-langgraph-streaming-react']), {
      fullFleet: false,
    }),
    [caps[1]]
  );
});
