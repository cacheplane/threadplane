import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { once } from 'node:events';
import { build } from 'vite';
import ts from 'typescript';
import { chromium, expect } from '@playwright/test';
import { createThreadRoutes, runThreadScenarios } from './thread-lifetime.mjs';
import { createCheckpointRoutes, runCheckpointScenarios } from './checkpoint-execution.mjs';

export function lockedReactManifest(lock) {
  const entries = (names) => Object.fromEntries(names.map((name) => {
    const version = lock.packages?.[`node_modules/${name}`]?.version;
    if (!version) throw new Error(`Missing root lock version for ${name}`);
    return [name, version];
  }));
  return {
    private: true, type: 'module',
    dependencies: entries(['react', 'react-dom']),
    devDependencies: entries(['@types/react', '@types/react-dom', 'vite', 'typescript']),
  };
}

const catalog = [{ name: 'weather', description: 'Current weather' }, { name: 'count', description: 'Count values' }];
const toolCall = { type: 'ai', id: 'assistant-tool', content: '', tool_calls: [{ id: 'call-weather', name: 'weather', args: { city: 'Paris' }, type: 'tool_call' }] };
const sse = (event, data, id) => `${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const resumableRunFields = { stream_resumable: true, on_disconnect: 'continue' };
const configuredRunFields = { config: { tags: ['runtime-review'], recursion_limit: 50, configurable: { user_id: 'review-user' } }, context: { locale: 'en', features: ['memory'] }, metadata: { source: 'runtime-review' } };
const textTrace = readFileSync(new URL('../../fixtures/react-parity/traces/langgraph-text-state.sse', import.meta.url), 'utf8');
const savedInterrupts = [
  { id: 'saved-approval', value: { question: 'Approve saved request?', choices: ['yes', 'no'] }, namespace: ['review', 'task-1'], when: 'during', resumable: true, ns: ['legacy-review'] },
  { id: 'saved-confirmation', value: 0, namespace: [], when: 'during', resumable: false, ns: [] },
];
const liveInterrupts = [
  { id: 'live-approval', value: { question: 'Approve action?', choices: ['yes', 'no'] }, namespace: ['review', 'live'], when: 'during', resumable: true, ns: ['legacy-live'] },
  { id: 'live-confirmation', value: false, namespace: [], when: 'during', resumable: false, ns: [] },
];
const savedHistory = [{
  values: { stage: 'saved', profile: { name: 'Saved user' }, messages: [
    { id: 'saved-human', type: 'human', content: 'Saved question' },
    { id: 'saved-tools', type: 'ai', content: 'Saved tool request', tool_calls: [
      { id: 'saved-weather', name: 'weather', args: { city: 'Paris' }, type: 'tool_call' },
      { id: 'saved-count', name: 'count', args: { values: ['saved'] }, type: 'tool_call' },
    ] },
    { id: 'saved-result', type: 'tool', tool_call_id: 'saved-weather', content: 'Raw historical weather result' },
    { id: 'saved-final', type: 'ai', reasoning: 'Saved reasoning', content: [
      'Saved ',
      { type: 'output_text', text: 'final' },
      { text: ' answer' },
      { type: 'text', text: '' },
      { type: 'reasoning', text: 'Hidden block reasoning' },
      { type: 'image', text: 'Hidden image caption', url: 'https://example.test/image.png' },
      { type: 'tool_use', id: 'ignored-block-call', name: 'savedTool', input: {}, text: 'Hidden tool request' },
      { type: 'tool_result', tool_use_id: 'ignored-block-call', text: 'Hidden tool result' },
    ], additional_kwargs: { sources: [{ refId: 'saved-source', name: 'Saved reference', publishedAt: '2026-09-24', extra: { provider: { labels: ['history'] } } }] } },
  ] },
  next: ['review', 'confirmation'],
  tasks: savedInterrupts.map((interrupt, index) => ({ id: `saved-task-${index}`, name: index === 0 ? 'review' : 'confirmation', error: null, checkpoint: null, state: null, interrupts: [interrupt] })),
  metadata: {},
  checkpoint: { thread_id: 'fixture-thread', checkpoint_ns: '', checkpoint_id: 'saved-checkpoint', checkpoint_map: {} },
  parent_checkpoint: { thread_id: 'fixture-thread', checkpoint_ns: '', checkpoint_id: 'saved-parent', checkpoint_map: null },
  created_at: '2026-09-21T00:00:00Z',
}, ...['saved-parent', 'saved-sibling'].map((id) => ({
  values: { messages: [{ type: 'ai', content: 'Older transcript must stay out of the current state' }], old: true },
  next: id === 'saved-parent' ? ['assistant'] : [],
  tasks: [{ id: 'old-task', name: 'old', error: 'PRIVATE_OLD_TASK_ERROR', interrupts: [] }],
  metadata: { old: true },
  checkpoint: { thread_id: 'fixture-thread', checkpoint_ns: '', checkpoint_id: id, checkpoint_map: { branch: ['owned'] } },
  parent_checkpoint: id === 'saved-parent' ? null : { thread_id: 'fixture-thread', checkpoint_ns: '', checkpoint_id: 'saved-parent', checkpoint_map: null },
  created_at: '2026-09-20T00:00:00Z',
}))];

/** A strict wire fixture: malformed/extra operations fail the browser run. */
export function runtimeResponse(body) {
  assert.equal(body.assistant_id, 'fixture-assistant');
  assert.deepEqual(body.stream_mode, ['values', 'messages-tuple', 'updates', 'custom', 'checkpoints']);
  assert.equal(body.stream_subgraphs, true);
  if (body.input === null) {
    const response = body.command?.resume;
    assert.deepEqual(body, { assistant_id: 'fixture-assistant', input: null, command: { resume: response }, stream_mode: ['values', 'messages-tuple', 'updates', 'custom', 'checkpoints'], stream_subgraphs: true, ...resumableRunFields, ...configuredRunFields }, 'exact resume run fields');
    if (Object.hasOwn(response ?? {}, 'live-approval')) {
      assert.deepEqual(response, { 'live-approval': 'yes', 'live-confirmation': false }, 'exact initial response map');
      return sse('values', { stage: 'final-approval', messages: [{ type: 'ai', id: 'resume-answer', content: 'One final approval', additional_kwargs: { reasoning_content: 'Approval reasoning', citations: [{ id: 'approval-source', title: 'Approval reference', publishedAt: 0 }] } }] })
        + sse('values|review:child', { stage: 'child-final-approval', messages: [{ type: 'ai', id: 'child-review', content: 'Child final approval' }] })
        + sse('updates|review:child', { __interrupt__: [{ id: 'child-final', value: 'Child confirmation' }] })
        + sse('updates', { __interrupt__: [{ id: 'final-approval', value: { question: 'Confirm final action?' } }] });
    }
    assert.deepEqual(response, { 'final-approval': true }, 'exact final response map');
    return sse('values|review:child', { stage: 'child-approved', messages: [{ type: 'ai', id: 'child-review', content: 'Child approved' }] })
      + sse('values', { stage: 'approved', messages: [{ type: 'ai', id: 'resume-answer', content: 'Approvals complete' }] });
  }
  assert.deepEqual(body.input?.client_tools, catalog, 'exact client tool catalog');
  assert.equal(body.input.messages.length, 1);
  const message = body.input.messages[0];
  const initialState = message.type === 'human' && ['Tool', 'Drop'].includes(message.content)
    ? { model: 'gpt-5-mini', reasoning_effort: 'minimal', gen_ui_mode: 'a2ui', itinerary: [{ id: 'paris', day: 1, place: 'Paris', note: 'Check the weather' }] }
    : {};
  const execution = message.type === 'tool' || ['Tool', 'Drop'].includes(message.content) ? configuredRunFields : {};
  assert.deepEqual(body, { assistant_id: 'fixture-assistant', input: { ...initialState, messages: [message], client_tools: catalog }, stream_mode: ['values', 'messages-tuple', 'updates', 'custom', 'checkpoints'], stream_subgraphs: true, ...resumableRunFields, ...execution }, 'unexpected run fields');
  if (message.type === 'tool') {
    assert.deepEqual(message, { id: 'client-tool-result-call-weather', type: 'tool', role: 'tool', tool_call_id: 'call-weather', content: '{"city":"Paris","temperature":20}' }, 'actual handler result continuation');
    return sse('values', { messages: [toolCall, message, { type: 'ai', id: 'answer', content: '20 degrees' }] });
  }
  assert.equal(message.type, 'human');
  assert.equal(typeof message.id, 'string');
  assert.deepEqual(message, { id: message.id, type: 'human', content: message.content }, 'exact user message fields');
  if (message.content === 'Send') return textTrace.replaceAll('message-parity', `answer-${message.id}`)
    + sse('values|child', { type: 'values', namespace: [], stage: 'child' })
    + sse('updates', { writer: { stage: 'node-update' } })
    + sse('custom', { __interrupt__: [], stage: 'custom' })
    + sse('values|child', { __interrupt__: [], stage: 'child-control' });
  if (message.content === 'Pause') return sse('values', { stage: 'approval', messages: [message, { type: 'ai', id: `pause-${message.id}`, content: 'Waiting for approvals' }] })
    + sse('messages|review:child', [{ type: 'AIMessageChunk', id: 'child-review', content: 'Child draft answer' }, { langgraph_node: 'review' }])
    + sse('values|review:child', { stage: 'child-approval', messages: [{ type: 'ai', id: 'child-review', content: 'Child draft' }] })
    + sse('updates|review:child', { __interrupt__: [{ id: 'child-approval', value: 'Child review' }] })
    + sse('values', { __interrupt__: [liveInterrupts[0]], stage: 'control-envelope' })
    + sse('updates', { __interrupt__: [liveInterrupts[1]] });
  if (message.content === 'Tool') return sse('values|research:one', { stage: 'first-child', messages: [{ type: 'ai', id: 'child-answer', content: 'Child one', tool_calls: [{ id: 'child-only-call', name: 'count', args: { values: ['child'] }, type: 'tool_call' }] }] })
    + sse('values|research:two|writer:nested', { stage: 'nested-child', messages: [{ type: 'ai', id: 'child-answer', content: 'Child two' }] })
    + sse('messages|research:failed', [{ type: 'AIMessageChunk', id: 'child-failed', content: 'Child failure partial' }, { langgraph_node: 'research' }])
    + sse('error|research:failed', { error: 'ChildFailure', message: 'PRIVATE child diagnostic' })
    + sse('values', { messages: [message, toolCall] });
  if (message.content === 'Error') return sse('error', { error: 'FixtureFailure', message: 'PRIVATE backend diagnostic' });
  if (message.content === 'Drop') return sse('messages', [{ type: 'AIMessageChunk', content: 'Dropped partial' }, { langgraph_node: 'assistant' }], '1')
    + sse('messages|research:drop', [{ type: 'AIMessageChunk', content: 'Child partial' }, { langgraph_node: 'research' }], '1-child')
    + sse('values', { stage: 'disconnected', messages: [message, { type: 'ai', content: 'Dropped partial' }] }, '2');
  if (message.content === 'Hold') return null;
  throw new Error(`Unexpected input ${message.content}`);
}

export function installedTypeSource(template, kind) {
  if (kind === 'core') return template;
  const binding = kind === 'react' ? 'useAgent' : 'observeAgent';
  const entry = kind === 'angular' ? './src/runtime-entry.js' : './runtime-entry.js';
  return template.replace('/* BINDING_IMPORT */', `import { ${binding} } from '@threadplane/${kind}';\nimport type { createFixtureSession } from '${entry}';`)
    .replace(
      '/* TOOL_OBSERVATION_TYPES */',
      `${
        kind === 'react'
          ? "import type { ToolObservationProps as ObservationProps } from '@threadplane/react/chat';"
          : "import type { ToolObservationComponent } from '@threadplane/angular/chat';\ntype ObservationProps = { readonly name: ReturnType<ToolObservationComponent['name']>; readonly argumentsText: ReturnType<ToolObservationComponent['argumentsText']>; readonly resultText?: ReturnType<ToolObservationComponent['resultText']>; readonly label?: ReturnType<ToolObservationComponent['label']> };"
      }
export function assertToolObservation() {
  const props: ObservationProps = { name: 'weather', argumentsText: '{"city":', resultText: '', label: 'Scoped weather' };
  // @ts-expect-error Props remain readonly.
  props.argumentsText = 'changed';
  // @ts-expect-error Name is required.
  const missingName: ObservationProps = { argumentsText: '' };
  // @ts-expect-error Arguments text is required.
  const missingArgs: ObservationProps = { name: 'weather' };
  // @ts-expect-error Structured values require caller formatting.
  const object: ObservationProps = { name: 'weather', argumentsText: {} };
  // @ts-expect-error Results must be text.
  const number: ObservationProps = { name: 'weather', argumentsText: '', resultText: 1 };
  // @ts-expect-error This is not an execution component.
  const callback: ObservationProps = { name: 'weather', argumentsText: '', execute: () => undefined };
  // @ts-expect-error No status inference contract.
  const status: ObservationProps = { name: 'weather', argumentsText: '', status: 'running' };
  // @ts-expect-error No session contract.
  const session: ObservationProps = { name: 'weather', argumentsText: '', session: {} };
  return [props, missingName, missingArgs, object, number, callback, status, session];
}`
    )
    .replace('/* TEXT_TRANSCRIPT_TYPES */', `${kind === 'react' ? "import type { TextTranscriptProps } from '@threadplane/react/chat';\ntype TranscriptRows = TextTranscriptProps['messages'];" : "import type { InputSignal } from '@angular/core';\nimport type { TextTranscriptComponent } from '@threadplane/angular/chat';\ntype TranscriptRows = TextTranscriptComponent['messages'] extends InputSignal<infer Rows> ? Rows : never;"}
export function assertTextTranscript(messages: readonly Message[]) {
  const narrow = [{ id: 'root', role: 'assistant', content: 'Hello', extra: true }] as const;
  const accepted: readonly TranscriptRows[] = [messages, narrow];
  // @ts-expect-error IDs are required by the installed component.
  const missingId: TranscriptRows = [{ role: 'user', content: 'Hello' }];
  // @ts-expect-error Content is required by the installed component.
  const missingContent: TranscriptRows = [{ id: 'a', role: 'user' }];
  // @ts-expect-error Rich objects are not plain text.
  const rich: TranscriptRows = [{ id: 'a', role: 'user', content: { text: 'Hello' } }];
  // @ts-expect-error Caller rows remain readonly.
  accepted[0][0].content = 'changed';
  return [accepted, missingId, missingContent, rich];
}`)
    .replace('export function assertSnapshot(snapshot: AgentSnapshot<FixtureTools>) {', `export function assertSnapshot(session: ReturnType<typeof createFixtureSession>) {\n  const snapshot = ${binding}(session)${kind === 'angular' ? '()' : ''};\n  const exact: AgentSnapshot<FixtureTools> = snapshot;\n  void exact;`)
    .replace('/* BACKEND_VALUES */', `const borrowed: AgentSession<FixtureTools> = session;
  void borrowed.submit('Borrowed text');
  const submitted: Promise<CompleteOutcome> = session.submit('Hello');
  void submitted;
  void session.submit({ message: '' });
  void session.submit({ message: 'Hello', state: { model: 'gpt-5-mini', itinerary: [{ day: 1, place: 'Paris' }] } } as const, { signal: new AbortController().signal });
  interface ItineraryStop { day: number; place: string }
  const stops: readonly ItineraryStop[] = [{ day: 1, place: 'Paris' }];
  // @ts-expect-error Interface records require projection into plain object data.
  void session.submit({ message: 'Hello', state: { itinerary: stops } });
  void session.submit({ message: 'Hello', state: { itinerary: stops.map(stop => ({ ...stop })) } });
  const runOptions = { config: { tags: ['memory'], recursion_limit: 50, configurable: { user_id: 'user-42' } }, context: { locale: 'en' }, metadata: { source: 'ui' } } as const;
  void session.submit('Hello', runOptions);
  void session.resume(true, runOptions);
  // @ts-expect-error Configuration cannot change owned thread routing.
  void session.submit('Hello', { config: { configurable: { thread_id: 'other' } } });
  // @ts-expect-error Configuration cannot bypass checkpoint execution ownership.
  void session.resume(true, { config: { configurable: { checkpoint_id: 'old' } } });
  // @ts-expect-error Run context remains plain data.
  void session.submit('Hello', { context: new Date() });
  // @ts-expect-error Metadata cannot contain callbacks.
  void session.resume(true, { metadata: { callback: () => true } });
  // @ts-expect-error Object input still requires a message.
  void session.submit({ state: { model: 'gpt-5-mini' } });
  // @ts-expect-error Message text must be a string.
  void session.submit({ message: 42 });
  // @ts-expect-error State contains only plain data.
  void session.submit({ message: 'Hello', state: { callback: () => true } });
  // @ts-expect-error State rejects SDK or application instances.
  void session.submit({ message: 'Hello', state: { date: new Date() } });
  // @ts-expect-error The state root must be a plain record.
  void session.submit({ message: 'Hello', state: new Date() });
  // @ts-expect-error The state root cannot be an array.
  void session.submit({ message: 'Hello', state: [] });
  // @ts-expect-error The runtime owns its messages.
  void session.submit({ message: 'Hello', state: { messages: [] } });
  // @ts-expect-error The runtime owns its tool catalog.
  void session.submit({ message: 'Hello', state: { client_tools: [] } });
  // @ts-expect-error Input does not expose transport overrides.
  void session.submit({ message: 'Hello', config: { configurable: { thread_id: 'other' } } });
  // @ts-expect-error Transport options do not contain application state.
  void session.submit('Hello', { state: { model: 'gpt-5-mini' } });
  // @ts-expect-error Submit does not expose transport command overrides.
  void session.submit({ message: 'Hello' }, { command: { goto: 'other' } });
  void session.resume();
  const reconnected: Promise<CompleteOutcome> = session.reconnect({ signal: new AbortController().signal });
  void reconnected;
  // @ts-expect-error Reconnect cannot attach an arbitrary run.
  void session.reconnect({ runId: 'unowned' });
  // @ts-expect-error Reconnect never accepts an interrupt response.
  void session.reconnect(false);
  const offeredRun: string | undefined = snapshot.reconnect?.runId;
  void offeredRun;
  // @ts-expect-error Availability belongs to the session.
  snapshot.reconnect = { runId: 'changed' };
  if (snapshot.reconnect) {
    // @ts-expect-error Retained run identity is readonly.
    snapshot.reconnect.runId = 'changed';
  }
  void session.resume(false);
  void session.resume(null);
  void session.resume({ approval: { choice: 'yes' } } as const, { signal: new AbortController().signal });
  // @ts-expect-error Responses must be portable authored data, not SDK instances.
  void session.resume(new Date());
  // @ts-expect-error Resume does not expose transport command overrides.
  void session.resume(true, { command: { goto: 'other' } });
  const direct = session.getSnapshot();
  const history = snapshot.history;
  const directHistory: typeof history = direct.history;
  // @ts-expect-error History belongs to the session.
  snapshot.history = [];
  if (history) {
    // @ts-expect-error Loaded pages remain readonly.
    history.pop();
    const entry = history[0];
    const forked: Promise<CompleteOutcome> = session.fork(entry.checkpoint, 'Fork A', runOptions);
    void forked;
    void session.fork(entry.checkpoint, { message: 'Fork A', state: { color: 'blue' } } as const);
    // @ts-expect-error Fork requires a checkpoint reference.
    void session.fork('A', 'Fork A');
    // @ts-expect-error Fork input must be authored text/plain data.
    void session.fork(entry.checkpoint, { message: 42 });
    // @ts-expect-error Fork cannot override thread routing.
    void session.fork(entry.checkpoint, 'Fork A', { config: { configurable: { thread_id: 'other' } } });
    // @ts-expect-error Fork cannot override checkpoint routing.
    void session.fork(entry.checkpoint, 'Fork A', { config: { configurable: { checkpoint_id: 'B' } } });
    // @ts-expect-error Fork cannot override root namespace.
    void session.fork(entry.checkpoint, 'Fork A', { config: { configurable: { checkpoint_ns: 'child' } } });
    // @ts-expect-error Fork cannot override checkpoint map.
    void session.fork(entry.checkpoint, 'Fork A', { config: { configurable: { checkpoint_map: {} } } });
    const checkpointId: string | null | undefined = entry.checkpoint.checkpoint_id;
    const parentId: string | null | undefined = entry.parent_checkpoint?.checkpoint_id;
    const checkpointData: PlainValue = entry.checkpoint.checkpoint_map?.['branch'];
    // @ts-expect-error References remain readonly.
    entry.checkpoint.checkpoint_id = 'changed';
    // @ts-expect-error Node lists remain readonly.
    entry.next.push('changed');
    // @ts-expect-error Reference map data remains readonly.
    if (entry.checkpoint.checkpoint_map) entry.checkpoint.checkpoint_map['branch'] = null;
    // @ts-expect-error Compact pages omit repeated transcripts/state.
    void entry.values;
    // @ts-expect-error Compact pages omit task subtrees.
    void entry.tasks;
    void [checkpointId, parentId, checkpointData];
  }
  void directHistory;
  const observedChildren: readonly { readonly namespace: readonly string[]; readonly messages: readonly Message[] }[] = snapshot.subgraphs;
  const directChildren = direct.subgraphs;
  // @ts-expect-error Child collection belongs to the session.
  snapshot.subgraphs = [];
  // @ts-expect-error Child observations are immutable.
  snapshot.subgraphs.push(directChildren[0]);
  for (const child of snapshot.subgraphs) {
    const childValues: Readonly<Record<string, PlainValue>> | undefined = child.values;
    const childInterrupt: PlainValue = child.interrupts[0]?.value;
    const childError: AgentError | undefined = child.error;
    const childInterruptNamespace: readonly string[] | undefined = child.interrupts[0]?.namespace;
    const childResumable: boolean | undefined = child.interrupts[0]?.resumable;
    // @ts-expect-error Child interrupt metadata is deeply readonly.
    child.interrupts[0]?.namespace?.push('changed');
    // @ts-expect-error Namespace tuples are immutable.
    child.namespace.push('changed');
    // @ts-expect-error Child messages are immutable.
    child.messages[0].content = 'changed';
    // @ts-expect-error Child streams have no execution commands.
    child.submit('Run');
    // @ts-expect-error Child streams have no executable tool list.
    void child.toolCalls;
    if (child.values) {
      // @ts-expect-error Child values are readonly plain data.
      child.values['stage'] = 'changed';
    }
    // @ts-expect-error Child interrupts cannot be mutated.
    child.interrupts.push({ value: true });
    void [childValues, childInterrupt, childError, childInterruptNamespace, childResumable];
  }
  void [observedChildren, directChildren];
  const directValues: Readonly<Record<string, PlainValue>> | undefined = direct.values;
  const values: Readonly<Record<string, PlainValue>> | undefined = snapshot.values;
  // @ts-expect-error No application schema is inferred from the broad values map.
  const assumedCounter: number = snapshot.values?.['counter'];
  // @ts-expect-error Concrete backend fields remain readonly.
  snapshot.values = {};
  if (snapshot.values) {
    // @ts-expect-error Application records remain readonly.
    snapshot.values['counter'] = 2;
    const nested = snapshot.values['profile'];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      // @ts-expect-error Nested application records remain readonly.
      nested['name'] = 'mutable';
    }
  }
  const directInterrupts: readonly { readonly value?: PlainValue }[] = direct.interrupts;
  const interrupts = snapshot.interrupts;
  const payload = interrupts[0]?.value;
  const plainPayload: PlainValue = payload;
  const id: string | undefined = interrupts[0]?.id;
  const namespace: readonly string[] | undefined = interrupts[0]?.namespace;
  const legacyNamespace: readonly string[] | undefined = interrupts[0]?.ns;
  const when: string | undefined = interrupts[0]?.when;
  const resumable: boolean | undefined = interrupts[0]?.resumable;
  // @ts-expect-error The concrete interrupt field remains readonly.
  snapshot.interrupts = [];
  // @ts-expect-error The batch remains readonly.
  interrupts.push({ value: false });
  // @ts-expect-error SDK namespace metadata remains readonly.
  interrupts[0].namespace?.push('changed');
  // @ts-expect-error Broad interrupt data does not infer an application schema.
  const assumedApproval: { approved: boolean } = payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    // @ts-expect-error Nested interrupt payloads remain readonly.
    payload['approved'] = true;
  }
  void [directValues, values, assumedCounter, directInterrupts, plainPayload, id, namespace, legacyNamespace, when, resumable, assumedApproval];`)
    .replace('  assertSnapshot(snapshot);', '  void snapshot;');
}

export function prepareInstalledTypes(root, consumer, kind) {
  const fixture = join(root, 'fixtures/react-parity/runtime');
  cpSync(join(fixture, 'scenarios.ts'), join(consumer, 'scenarios.ts'));
  writeFileSync(join(consumer, 'installed-types.ts'), installedTypeSource(readFileSync(join(fixture, 'installed-types.ts'), 'utf8'), kind));
  if (kind === 'react') {
    cpSync(join(fixture, 'message-action-types.tsx'), join(consumer, 'message-action-types.tsx'));
    cpSync(join(fixture, 'message-list-types.tsx'), join(consumer, 'message-list-types.tsx'));
    cpSync(join(fixture, 'json-types.ts'), join(consumer, 'json-types.ts'));
    cpSync(join(fixture, 'render-types.tsx'), join(consumer, 'render-types.tsx'));
  }
  writeFileSync(join(consumer, 'tsconfig.contracts.json'), JSON.stringify({ compilerOptions: {
    target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['ES2022', 'DOM'], types: [], strict: true, skipLibCheck: false, noEmit: true,
    ...(kind === 'react' ? { jsx: 'react-jsx' } : {}),
  }, files: ['installed-types.ts', ...(kind === 'react' ? ['message-list-types.tsx', 'json-types.ts', 'render-types.tsx', 'message-action-types.tsx'] : [])] }, null, 2));
}

/** Typecheck the private source against the *installed* public core declarations,
 * emit to temporary storage, and copy only the narrow entry declaration. This
 * resolution override is confined to checking private source; neither installed
 * consumer config has paths/aliases, and no core implementation is bundled. */
function emitRuntimeDeclaration(root, consumer, output) {
  const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ['lib.es2022.d.ts', 'lib.esnext.disposable.d.ts', 'lib.dom.d.ts'], types: [], strict: true, skipLibCheck: false, declaration: true, emitDeclarationOnly: true, rootDir: root, outDir: output };
  const host = ts.createCompilerHost(options);
  host.resolveModuleNames = (names, containingFile) => names.map((name) => ts.resolveModuleName(name,
    name === '@threadplane/core' || name === '@threadplane/core/tools' ? join(consumer, 'installed-types.ts') : containingFile, options, ts.sys).resolvedModule);
  const program = ts.createProgram([join(root, 'fixtures/react-parity/runtime/runtime-entry.ts')], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: (name) => name, getNewLine: () => '\n' }));
  const result = program.emit();
  assert.equal(result.emitSkipped, false, 'runtime fixture declaration emitted');
}

export async function prepareRuntimeConsumer(root, consumer, kind, options = {}) {
  const fixture = join(root, 'fixtures/react-parity/runtime');
  const temporary = mkdtempSync(join(tmpdir(), 'threadplane-runtime-bundle-'));
  try {
    emitRuntimeDeclaration(root, consumer, join(temporary, 'types'));
    const result = await build({ configFile: false, root, logLevel: 'warn', build: {
      outDir: join(temporary, 'bundle'), emptyOutDir: true, minify: false,
      lib: { entry: join(fixture, 'runtime-entry.ts'), formats: ['es'], fileName: () => 'runtime-entry.js' },
      rollupOptions: { external: ['@threadplane/core', '@threadplane/core/tools'] },
    } });
    const chunks = (Array.isArray(result) ? result : [result]).flatMap((entry) => entry.output);
    const modules = chunks.flatMap((chunk) => Object.keys(chunk.modules ?? {}));
    assert.ok(modules.some((path) => path.includes('/@langchain/langgraph-sdk/')), 'real SDK must be in private fixture bundle');
    assert.ok(modules.some((path) => path.endsWith('/transport/fetch-stream.transport.ts')), 'production transport must be in private fixture bundle');
    assert.ok(!modules.some((path) => /\/libs\/(?:core|react|angular)\//.test(path) || /\/node_modules\/(?:@angular|react|react-dom)\//.test(path)), 'fixture must externalize public core and exclude framework implementations');
    const destination = kind === 'angular' ? join(consumer, 'src') : consumer;
    cpSync(join(temporary, 'bundle/runtime-entry.js'), join(destination, 'runtime-entry.js'));
    cpSync(join(temporary, 'types/fixtures/react-parity/runtime/runtime-entry.d.ts'), join(destination, 'runtime-entry.d.ts'));
    const declaration = readFileSync(join(destination, 'runtime-entry.d.ts'), 'utf8');
    assert.doesNotMatch(declaration, /@langchain|libs\/|create-session/, 'emitted fixture declaration exposes no SDK/private references');
    prepareRuntimeViews(root, consumer, kind, options);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

// `a2ui` adds the surface fixture, which needs the optional @threadplane/a2ui package installed.
export function prepareRuntimeViews(root, consumer, kind, { a2ui = false } = {}) {
  const fixture = join(root, 'fixtures/react-parity/runtime');
  const destination = kind === 'angular' ? join(consumer, 'src') : consumer;
  cpSync(join(fixture, 'tools.ts'), join(destination, 'tools.ts'));
  cpSync(join(fixture, 'scenarios.ts'), join(destination, 'scenarios.ts'));
  cpSync(join(fixture, 'thread-owner.ts'), join(destination, 'thread-owner.ts'));
  const threadView = `${kind}-threads.${kind === 'react' ? 'tsx' : 'ts'}`;
  cpSync(join(fixture, threadView), join(destination, threadView));
  const checkpointView = `${kind}-checkpoints.${kind === 'react' ? 'tsx' : 'ts'}`;
  cpSync(join(fixture, checkpointView), join(destination, checkpointView));
  cpSync(join(fixture, 'review.css'), join(destination, 'review.css'));
  const app = `${kind}-app.${kind === 'react' ? 'tsx' : 'ts'}`;
  cpSync(join(fixture, app), join(destination, app));
  writeFileSync(join(destination, kind === 'react' ? 'main.tsx' : 'main.ts'),
    (kind === 'react' && a2ui ? `if (new URLSearchParams(location.search).has('a2ui')) {\n  void import('./react-a2ui-surface');\n} else ` : '') +
    (kind === 'react' ? `if (new URLSearchParams(location.search).has('message-action-icons')) {\n  if (new URLSearchParams(location.search).has('no-styles')) {\n    void import('./react-message-action-icons');\n  } else {\n    void import('./react-message-action-icons-styled');\n  }\n} else if (new URLSearchParams(location.search).has('message-controls')) {\n  void import('./react-message-controls');\n} else if (new URLSearchParams(location.search).has('message-spacing')) {\n  void import('./react-message-spacing');\n} else ` : '') +
    `if (new URLSearchParams(location.search).has('checkpoints')) {\n  void import('./${kind}-checkpoints');\n} else if (new URLSearchParams(location.search).has('threads')) {\n  void import('./${kind}-threads');\n} else {\n  void import('./${kind}-app');\n}\n`);
  if (kind === 'angular') {
    const configPath = join(consumer, 'angular.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.projects.consumer.architect.build.options.styles = ['src/review.css'];
    writeFileSync(configPath, JSON.stringify(config));
    const index = join(destination, 'index.html');
    writeFileSync(index, readFileSync(index, 'utf8').replace('<head>', '<head><meta name="viewport" content="width=device-width, initial-scale=1">'));
  }
  if (kind === 'react') {
    for (const name of ['react-message-action-icons.tsx', 'react-message-action-icons-styled.tsx']) cpSync(join(fixture, name), join(destination, name));
    cpSync(join(fixture, 'react-message-controls.tsx'), join(destination, 'react-message-controls.tsx'));
    cpSync(join(fixture, 'react-message-spacing.tsx'), join(destination, 'react-message-spacing.tsx'));
    cpSync(join(fixture, 'react-overflow-menu.tsx'), join(destination, 'react-overflow-menu.tsx'));
    if (a2ui) cpSync(join(fixture, 'react-a2ui-surface.tsx'), join(destination, 'react-a2ui-surface.tsx'));
    cpSync(join(fixture, 'react-confirm-dialog.tsx'), join(destination, 'react-confirm-dialog.tsx'));
    cpSync(join(fixture, 'vite.config.mts'), join(consumer, 'vite.config.mts'));
    writeFileSync(join(consumer, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>React installed consumer</title></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>');
    writeFileSync(join(consumer, 'tsconfig.app.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['ES2022', 'DOM'], types: [], strict: true, skipLibCheck: false, jsx: 'react-jsx', noEmit: true }, files: ['main.tsx'] }));
  }
}

/** Bounded fixture server: built files and deterministic history/run routes. */
export async function serveRuntimeConsumer(directory) {
  const threads = createThreadRoutes();
  const checkpoints = createCheckpointRoutes();
  const requests = [];
  const historyRequests = [];
  const joinRequests = [];
  const statusRequests = [];
  const errors = [];
  let dropped = false;
  let joined = false;
  const held = new Set();
  let notifyHeld;
  let notifyAborted;
  const holdStarted = new Promise((resolve) => { notifyHeld = resolve; });
  const holdAborted = new Promise((resolve) => { notifyAborted = resolve; });
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://fixture');
      const pathname = url.pathname;
      if (pathname.startsWith('/api/')) {
        if (await threads.handle(request, response, pathname)) return;
        if (await checkpoints.handle(request, response, pathname)) return;
        const runPath = '/api/threads/fixture-thread/runs/drop-run';
        if (pathname === runPath || pathname === `${runPath}/stream`) {
          assert.equal(request.method, 'GET', 'known-run recovery only performs GET');
          assert.ok(dropped, 'Drop must establish the known run before recovery');
          if (pathname === runPath) {
            assert.equal(url.search, '', 'exact status endpoint');
            const status = joined ? 'success' : 'running';
            assert.deepEqual(statusRequests, joined ? ['running'] : [], 'one exact-run inspection per closure');
            statusRequests.push(status);
            response.writeHead(200, { 'content-type': 'application/json' });
            return response.end(JSON.stringify({ run_id: 'drop-run', thread_id: 'fixture-thread', status }));
          }
          assert.deepEqual([...url.searchParams], [['cancel_on_disconnect', '0'], ['stream_mode', JSON.stringify(['values', 'messages-tuple', 'updates', 'custom', 'checkpoints'])]]);
          assert.equal(request.headers['last-event-id'], '2', 'exact committed cursor');
          assert.deepEqual(statusRequests, ['running'], 'initial closure must inspect the running run');
          assert.equal(joined, false, 'one explicit join, no replay');
          joined = true;
          joinRequests.push({ runId: 'drop-run', lastEventId: '2' });
          response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
          return response.end(sse('messages', [{ type: 'AIMessageChunk', content: ' recovered' }, { langgraph_node: 'assistant' }], '3')
            + sse('messages|research:drop', [{ type: 'AIMessageChunk', content: ' recovered' }, { langgraph_node: 'research' }], '3-child-1')
            + sse('values|research:drop', { stage: 'child-reconnected', messages: [{ type: 'ai', content: 'Child partial recovered' }] }, '3-child-2')
            + sse('values', { stage: 'reconnected', messages: [{ type: 'ai', content: 'Dropped partial recovered' }] }, '4'));
        }
        assert.equal(request.method, 'POST');
        assert.ok(['/api/threads/fixture-thread/history', '/api/threads/fixture-thread/runs/stream'].includes(pathname), 'only expected history/run endpoint');
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        if (pathname === '/api/threads/fixture-thread/history') {
          assert.deepEqual(body, { limit: 10 }, 'exact SDK history body');
          assert.ok(historyRequests.length < 3, 'only three explicit history reads');
          historyRequests.push(body);
          response.writeHead(200, { 'content-type': 'application/json' });
          return response.end(JSON.stringify(historyRequests.length < 3 ? savedHistory : []));
        }
        requests.push(body);
        const trace = runtimeResponse(body);
        const drop = body.input?.messages?.[0]?.content === 'Drop';
        if (drop) {
          assert.equal(dropped, false, 'one dropped run per review');
          dropped = true;
        }
        response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', ...(drop ? { 'content-location': '/threads/fixture-thread/runs/drop-run' } : {}) });
        if (trace !== null) return response.end(trace);
        held.add(response);
        response.once('close', () => { held.delete(response); notifyAborted(); });
        // Actual incremental network bytes, not a whole-response route.fulfill.
        response.write(sse('values', { stage: 'held', transient: true })
          + sse('messages', [{ type: 'AIMessageChunk', id: 'held-answer', content: 'Held partial' }, { langgraph_node: 'assistant' }])
          + sse('messages|research:held', [{ type: 'AIMessageChunk', id: 'child-held', content: 'Child held partial' }, { langgraph_node: 'research' }]));
        notifyHeld();
        return;
      }
      assert.equal(request.method, 'GET');
      if (pathname === '/favicon.ico') { response.writeHead(204); return response.end(); }
      const file = resolve(directory, `.${pathname === '/' ? '/index.html' : pathname}`);
      assert.ok(file.startsWith(resolve(directory) + sep) && existsSync(file), `Unexpected request ${pathname}`);
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ico': 'image/x-icon' }[extname(file)] ?? 'application/octet-stream';
      response.writeHead(200, { 'content-type': type });
      response.end(readFileSync(file));
    } catch (error) {
      errors.push(error);
      response.writeHead(500);
      response.end('Fixture request rejected');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${server.address().port}`, requests, historyRequests, joinRequests, statusRequests, errors, holdStarted, holdAborted, threads, checkpoints,
    async close() {
      threads.close();
      checkpoints.close();
      for (const response of held) response.destroy();
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}

function handshake(promise, label) {
  let timeout;
  return Promise.race([promise, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`Timed out awaiting ${label}`)), 10_000); })]).finally(() => clearTimeout(timeout));
}

export async function runConfirmDialogScenarios(page, url) {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 760 });
    await page.goto(`${url}/?menu&confirm`);
    const open = page.getByRole('button', { name: 'Open confirmation', exact: true });
    const modal = page.getByRole('alertdialog');
    const cancel = modal.getByRole('button', { name: 'Cancel', exact: true });
    const confirm = modal.getByRole('button', { name: 'Remove <literal>', exact: true });
    const confirmations = page.getByTestId('confirm-count');
    const cancellations = page.getByTestId('cancel-count');
    await open.click();
    await expect(modal).toHaveAccessibleName('Delete <literal> & history?');
    await expect(modal).toHaveAccessibleDescription('Permanent <body> & details.');
    await expect(cancel).toBeFocused();
    const panel = await modal.elementHandle();
    const cancelNode = await cancel.elementHandle();
    assert.ok(panel && cancelNode);
    assert.equal(await modal.evaluate(node => node.matches(':modal')), true);
    assert.deepEqual(await modal.evaluate(node => {
      const style = getComputedStyle(node);
      return { direction: style.direction, monospace: style.fontFamily.includes('monospace'), background: style.backgroundColor, color: style.color, literalElements: node.querySelectorAll('literal, body').length };
    }), { direction: 'rtl', monospace: true, background: 'rgb(241, 242, 243)', color: 'rgb(11, 22, 33)', literalElements: 0 });
    await page.keyboard.press('Shift+Tab');
    await expect(confirm).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cancel).toBeFocused();
    await page.keyboard.press('F2');
    await expect(modal).toHaveAttribute('aria-busy', 'true');
    await expect(confirm).toBeDisabled();
    await expect(cancel).toBeEnabled();
    await expect(cancel).toBeFocused();
    for (const key of ['Tab', 'Shift+Tab']) {
      await page.keyboard.press(key);
      await expect(cancel).toBeFocused();
      assert.equal(await page.evaluate(() => document.hasFocus()), true);
    }
    await page.keyboard.press('F3');
    await cancel.click();
    await expect(cancellations).toHaveText('1');
    await expect(modal).toBeVisible();
    const background = await page.getByRole('button', { name: 'Background action', includeHidden: true }).boundingBox();
    assert.ok(background);
    await page.mouse.click(background.x + background.width / 2, background.y + background.height / 2);
    await expect(page.getByTestId('background-count')).toHaveText('0');
    await expect(cancellations).toHaveText('2');
    await expect(modal).toBeVisible();
    await page.keyboard.press('F2');
    await expect(confirm).toBeEnabled();
    await confirm.focus();
    await page.keyboard.press('Space');
    await expect(confirmations).toHaveText('1');
    await page.keyboard.press('Enter');
    await expect(confirmations).toHaveText('2');
    await page.keyboard.down('Enter');
    await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    await expect(confirmations).toHaveText('3');
    // Verify browser default prevention for an IME Space press and release;
    // trusted ordinary native Space above independently proves activation.
    assert.deepEqual(await confirm.evaluate(node => {
      const down = new KeyboardEvent('keydown', { key: ' ', isComposing: true, bubbles: true, cancelable: true });
      const up = new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true });
      node.dispatchEvent(down);
      node.dispatchEvent(up);
      return [down.defaultPrevented, up.defaultPrevented];
    }), [true, true]);
    await expect(confirmations).toHaveText('3');
    await cancel.focus();
    await page.keyboard.press('F5');
    await expect(modal).toHaveAccessibleName(/Updated literal/);
    assert.equal(await panel.evaluate(node => node === document.querySelector('dialog')), true);
    assert.equal(await cancelNode.evaluate(node => node === document.activeElement), true);
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('shortcut-count')).toHaveText('0');
    const bounds = await modal.boundingBox();
    assert.ok(bounds && bounds.x >= 8 && bounds.y >= 8 && bounds.x + bounds.width <= width - 8 && bounds.y + bounds.height <= 752);
    for (const button of [cancel, confirm]) {
      const box = await button.boundingBox();
      assert.ok(box && box.height >= 40 && box.width >= 40);
    }
    await page.screenshot({ path: join(tmpdir(), `react-confirm-dialog-plain-${width}.png`), fullPage: false });
    await page.keyboard.press('F3');
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(cancellations).toHaveText('3');
    await expect(open).toBeFocused();
    await open.click();
    await page.keyboard.press('F4');
    await expect(open).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(confirmations).toHaveText('3');

    await page.goto(`${url}/?menu&confirm`);
    await open.click();
    await page.keyboard.press('F6');
    const replacement = page.getByRole('alertdialog', { name: 'Replacement confirmation', exact: true });
    await expect(replacement.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await page.keyboard.press('F7');
    await expect(page.locator('dialog')).toHaveCount(1);
    await expect(replacement.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Background action', exact: true }).click();
    await expect(page.getByTestId('background-count')).toHaveText('1');
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('shortcut-count')).toHaveText('1');
  }
  console.log('Installed confirmation dialog: native modal/Tab/background ownership, controlled cancellation/pending, literal content, keyboard/IME, stable DOM, local RTL/theme, removed invoker/replacement cleanup and 1280/390 containment passed.');
}

export async function runRenameFormScenarios(page, url) {
  await page.goto(`${url}/?menu&rename`);
  const fixture = page.getByRole('region', { name: 'Installed rename editor' });
  const input = fixture.getByRole('textbox', { name: 'Rename fixture title' });
  const save = fixture.getByRole('button', { name: 'Save', exact: true });
  const cancel = fixture.getByRole('button', { name: 'Cancel', exact: true });
  const submitted = page.getByTestId('rename-submissions');
  const cancelled = page.getByTestId('rename-cancels');
  await expect(input).toBeFocused();
  const node = await input.elementHandle();
  assert.ok(node);
  await input.fill('   ');
  await expect(save).toBeDisabled();
  await input.press('Enter');
  await expect(submitted).toHaveText('[]');
  await input.fill('  Literal <&> title  ');
  await input.press('Enter');
  await expect(submitted).toHaveText('["Literal <&> title"]');
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true });
  await expect(submitted).toHaveText('["Literal <&> title"]');
  await input.press('Escape');
  await expect(cancelled).toHaveText('1');
  await fixture.getByRole('checkbox', { name: 'Rename fixture error' }).check();
  await expect(fixture.getByRole('alert')).toHaveText('Rename fixture failure');
  await expect(input).toHaveValue('  Literal <&> title  ');
  await fixture.getByRole('checkbox', { name: 'Rename fixture pending' }).check();
  await expect(input).toBeDisabled();
  await expect(save).toBeDisabled();
  await expect(cancel).toBeEnabled();
  await cancel.click();
  await expect(cancelled).toHaveText('2');
  await fixture.getByRole('checkbox', { name: 'Rename fixture pending' }).uncheck();
  await fixture.getByRole('checkbox', { name: 'Rename fixture error' }).uncheck();
  await save.click();
  await expect(submitted).toHaveText('["Literal <&> title","Literal <&> title"]');
  assert.equal(await node.evaluate((node) => node.isConnected), true);
  for (const width of [390, 600, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const box = await input.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= width, `Rename input fits viewport ${width}`);
  }
  console.log('Installed rename editor: explicit submit/cancel, literal title, blank and IME guards, pending/error/retry, retained input and responsive containment passed.');
}

export async function runA2uiSurfaceScenarios(page, url) {
  await page.goto(`${url}/?menu&a2ui`);
  await expect(page.getByRole('heading', { name: 'Installed A2UI surface' })).toBeVisible();
  const surface = page.locator('.a2ui-surface');
  await expect(surface).toHaveAttribute('data-surface-id', 'trip');
  const rect = (locator) => locator.evaluate((node) => { const box = node.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height }; });
  const title = surface.getByRole('heading', { name: 'Lyon trip', exact: true });
  await expect(title).toHaveAttribute('aria-level', '2');
  await expect(surface.getByRole('heading')).toHaveCount(1);
  const card = surface.locator('.a2ui-card');
  const rule = surface.locator('hr.a2ui-divider--horizontal');
  const row = surface.locator('.a2ui-row');
  const depart = row.getByText('Depart', { exact: true });
  const bar = row.locator('.a2ui-divider--vertical');
  const time = row.getByText('09:40', { exact: true });
  // The data model supplies the card text; the stylesheet supplies the card surface.
  await expect(card).toHaveText('Two nights in Lyon');
  const cardStyle = await card.evaluate((node) => { const style = getComputedStyle(node); return { border: style.borderTopWidth, padding: style.paddingTop, radius: style.borderTopLeftRadius, background: style.backgroundColor }; });
  assert.deepEqual({ border: cardStyle.border, padding: cardStyle.padding, radius: cardStyle.radius }, { border: '1px', padding: '16px', radius: '12px' });
  assert.equal(await title.evaluate((node) => getComputedStyle(node).fontSize), '24px');
  // Column stacks in document order; the row lays its items out inline and spreads them.
  const layout = async () => ({ surface: await rect(surface), title: await rect(title), card: await rect(card), rule: await rect(rule), row: await rect(row), depart: await rect(depart), bar: await rect(bar), time: await rect(time) });
  const ltr = await layout();
  assert.ok(ltr.title.bottom <= ltr.card.top && ltr.card.bottom <= ltr.rule.top && ltr.rule.bottom <= ltr.row.top, `column order ${JSON.stringify(ltr)}`);
  assert.ok(ltr.depart.right <= ltr.bar.left && ltr.bar.right <= ltr.time.left, `row order ${JSON.stringify(ltr)}`);
  assert.ok(Math.abs(ltr.depart.left - ltr.row.left) < 1 && Math.abs(ltr.time.right - ltr.row.right) < 1, `row spreads ${JSON.stringify(ltr)}`);
  assert.ok(Math.abs(ltr.bar.width - 1) < 0.01 && ltr.bar.height >= ltr.depart.height, `vertical rule ${JSON.stringify(ltr)}`);
  assert.ok(Math.abs(ltr.rule.height - 1) < 0.01 && Math.abs(ltr.rule.width - ltr.surface.width) < 1, `horizontal rule ${JSON.stringify(ltr)}`);
  // A component this slice lacks keeps its child as literal text and adds no control.
  const unsupported = surface.locator('[data-a2ui-unsupported="extra"]');
  await expect(unsupported).toHaveText('Book <b>now</b>');
  await expect(surface.getByRole('button')).toHaveCount(0);
  assert.equal(await unsupported.locator('b').count(), 0);
  // A new snapshot replaces the bound text without remounting the card.
  const retained = await card.elementHandle();
  await page.getByRole('checkbox', { name: 'Long summary' }).check();
  await expect(card).toContainText('Three-nights-with-an-unbroken-summary');
  assert.equal(await card.evaluate((node, previous) => node === previous, retained), true);
  // Right to left mirrors the row.
  await page.getByRole('checkbox', { name: 'Right to left' }).check();
  const rtl = await layout();
  assert.ok(rtl.depart.left >= rtl.bar.right && rtl.bar.left >= rtl.time.right, `rtl row order ${JSON.stringify(rtl)}`);
  await page.getByRole('checkbox', { name: 'Right to left' }).uncheck();
  // A narrow viewport wraps the long text inside the card without page overflow.
  const size = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 640 });
  const narrow = await layout();
  assert.ok(narrow.card.left >= narrow.surface.left - 0.5 && narrow.card.right <= narrow.surface.right + 0.5, `narrow card ${JSON.stringify(narrow)}`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  if (size) await page.setViewportSize(size);
  // The dark scheme swaps the surface token.
  await page.emulateMedia({ colorScheme: 'dark' });
  const dark = await card.evaluate((node) => getComputedStyle(node).backgroundColor);
  assert.notEqual(dark, cardStyle.background);
  await page.emulateMedia({ colorScheme: null });
}

export async function runComposerSlotScenarios(page, url) {
  await page.goto(`${url}/?menu&slots`);
  await expect(page.getByRole('heading', { name: 'Installed composer slots' })).toBeVisible();
  const draft = page.getByRole('textbox', { name: 'Message', exact: true });
  const form = page.locator('form.tp-chat-input').first();
  const leading = page.getByTestId('slot-leading');
  const tools = form.getByRole('button', { name: /^Tools/ });
  const send = form.getByRole('button', { name: 'Send', exact: true });
  const footer = page.getByTestId('slot-footer');
  const sent = page.getByTestId('slots-sent');
  const rect = (locator) => locator.evaluate((node) => { const box = node.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom }; });
  const layout = async () => ({ pill: await rect(form.locator('.tp-chat-input__pill')), leading: await rect(leading), draft: await rect(draft), tools: await rect(tools), send: await rect(send), hint: await rect(form.locator('.tp-chat-input__hint')), footer: await rect(footer) });
  // Inline order follows the reading direction; the footer follows the hint; every part stays inside the surface.
  const inside = (box, pill) => box.left >= pill.left && box.right <= pill.right && box.top >= pill.top && box.bottom <= pill.bottom;
  const ltr = await layout();
  assert.ok(ltr.leading.right <= ltr.draft.left && ltr.draft.right <= ltr.tools.left && ltr.tools.right <= ltr.send.left, `ltr order ${JSON.stringify(ltr)}`);
  assert.ok(inside(ltr.leading, ltr.pill) && inside(ltr.tools, ltr.pill) && inside(ltr.send, ltr.pill), `inside surface ${JSON.stringify(ltr)}`);
  assert.ok(ltr.pill.bottom <= ltr.hint.top && ltr.hint.bottom <= ltr.footer.top, `footer after hint ${JSON.stringify(ltr)}`);
  assert.ok(ltr.draft.right - ltr.draft.left >= 120, `draft keeps usable width ${JSON.stringify(ltr)}`);
  // A composer without slots has no slot elements.
  const plain = page.locator('form.tp-chat-input').nth(1);
  await expect(plain.locator('.tp-chat-input__leading, .tp-chat-input__trailing, .tp-chat-input__footer')).toHaveCount(0);
  // Tab order: draft, app control, Send. A slot button keeps focus and never sends or clears.
  await draft.fill('Keep this');
  await draft.focus();
  await page.keyboard.press('Tab'); await expect(tools).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(tools).toHaveText('Tools 1');
  await expect(tools).toBeFocused();
  await expect(draft).toHaveValue('Keep this');
  await expect(sent).toHaveText('[]');
  await page.keyboard.press('Tab'); await expect(send).toBeFocused();
  // Send clears, returns focus to the draft and leaves slot state alone.
  await page.keyboard.press('Enter');
  await expect(sent).toHaveText(JSON.stringify(['Keep this']));
  await expect(draft).toHaveValue('');
  await expect(draft).toBeFocused();
  await expect(tools).toHaveText('Tools 1');
  await expect(footer).toHaveText('1 sent');
  // Busy shows Stop after the app control; the app control stays enabled and mounted.
  const retained = await tools.elementHandle();
  await page.getByRole('checkbox', { name: 'Busy' }).check();
  const stop = form.getByRole('button', { name: 'Stop', exact: true });
  await expect(stop).toBeVisible();
  await expect(tools).toBeEnabled();
  const busy = { tools: await rect(tools), stop: await rect(stop), send: await rect(send) };
  assert.ok(busy.tools.right <= busy.stop.left && busy.stop.right <= busy.send.left, `busy order ${JSON.stringify(busy)}`);
  await tools.click();
  await expect(tools).toHaveText('Tools 2');
  await stop.click();
  await expect(stop).toHaveCount(0);
  assert.equal(await tools.evaluate((node, previous) => node === previous, retained), true);
  // Right to left mirrors the inline order.
  await page.getByRole('checkbox', { name: 'Right to left' }).check();
  const rtl = await layout();
  assert.ok(rtl.leading.left >= rtl.draft.right && rtl.draft.left >= rtl.tools.right && rtl.tools.left >= rtl.send.right, `rtl order ${JSON.stringify(rtl)}`);
  await page.getByRole('checkbox', { name: 'Right to left' }).uncheck();
  // A narrow viewport keeps every part inside the surface without page overflow.
  const size = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 640 });
  const narrow = await layout();
  assert.ok(inside(narrow.leading, narrow.pill) && inside(narrow.tools, narrow.pill) && inside(narrow.send, narrow.pill), `narrow inside ${JSON.stringify(narrow)}`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  if (size) await page.setViewportSize(size);
}

export async function runMessageRatingScenarios(page, url) {
  await page.goto(`${url}/?menu&rating`);
  await expect(page.getByRole('heading', { name: 'Installed message rating' })).toBeVisible();
  const first = page.getByRole('group', { name: 'Rate response', exact: true });
  const second = page.getByRole('group', { name: 'Rate <second>', exact: true });
  const good = first.getByRole('button', { name: 'Good response', exact: true });
  const poor = first.getByRole('button', { name: 'Poor response', exact: true });
  const helpful = second.getByRole('button', { name: 'Helpful <b>&', exact: true });
  const unhelpful = second.getByRole('button', { name: 'Not helpful', exact: true });
  const values = page.getByTestId('rating-values');
  const requests = page.getByTestId('rating-requests');
  const pressed = async () => Promise.all([good, poor, helpful, unhelpful].map((button) => button.getAttribute('aria-pressed')));
  await expect(first).toHaveAttribute('data-message-id', 'first');
  await expect(second).toHaveAttribute('data-message-id', 'second');
  await expect(second).toHaveClass('tp-message-actions tp-message-rating owned-rating');
  assert.deepEqual(await pressed(), ['false', 'false', 'false', 'true']);
  await expect(helpful.locator('b')).toHaveCount(0);
  await expect(helpful).toHaveAttribute('title', 'Helpful <b>&');
  // Icon-only presentation keeps a 36px target with a hidden literal label and a decorative glyph.
  for (const button of [good, poor, helpful, unhelpful]) {
    const evidence = await button.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const label = node.querySelector('.tp-message-actions__label').getBoundingClientRect();
      const icon = node.querySelector('.tp-message-actions__icon');
      return { width: box.width, height: box.height, label: [label.width, label.height], hidden: icon.getAttribute('aria-hidden'), focusable: icon.querySelector('svg').getAttribute('focusable'), type: node.getAttribute('type') };
    });
    assert.ok(evidence.width >= 36 && evidence.height >= 36, `rating target ${JSON.stringify(evidence)}`);
    assert.deepEqual([evidence.label, evidence.hidden, evidence.focusable, evidence.type], [[1, 1], 'true', 'false', 'button']);
  }
  // The pressed option is visibly distinct from its unpressed sibling.
  const paint = (button) => button.evaluate((node) => { const style = getComputedStyle(node); return [style.borderTopColor, style.backgroundColor, style.color].join('|'); });
  assert.notEqual(await paint(unhelpful), await paint(helpful));
  // Keyboard: natural tab order, Space and Enter toggle, focus stays on the pressed option.
  await page.getByRole('button', { name: 'Before ratings', exact: true }).focus();
  await page.keyboard.press('Tab'); await expect(good).toBeFocused();
  await page.keyboard.press('Space');
  assert.deepEqual(await pressed(), ['true', 'false', 'false', 'true']);
  await expect(good).toBeFocused();
  await page.keyboard.press('Tab'); await expect(poor).toBeFocused();
  await page.keyboard.press('Enter');
  assert.deepEqual(await pressed(), ['false', 'true', 'false', 'true']);
  // Pressing the current rating requests clearing; each group reports its own identity.
  await poor.click();
  await unhelpful.click();
  await helpful.click();
  assert.deepEqual(await pressed(), ['false', 'false', 'true', 'false']);
  await expect(requests).toHaveText(JSON.stringify([['up', 'first'], ['down', 'first'], [null, 'first'], [null, 'second'], ['up', 'second']]));
  await expect(values).toHaveText(JSON.stringify({ first: null, second: 'up' }));
  // A refused request leaves the owner's rating displayed.
  await page.getByRole('checkbox', { name: 'Refuse rating changes' }).check();
  await good.click();
  await helpful.click();
  assert.deepEqual(await pressed(), ['false', 'false', 'true', 'false']);
  await expect(requests).toHaveText(JSON.stringify([['up', 'first'], ['down', 'first'], [null, 'first'], [null, 'second'], ['up', 'second'], ['up', 'first'], [null, 'second']]));
  await page.getByRole('checkbox', { name: 'Refuse rating changes' }).uncheck();
  // Disabled keeps the accepted rating visible, is skipped by Tab and is inert for a real pointer.
  await page.getByRole('checkbox', { name: 'Disable ratings' }).check();
  for (const button of [good, poor, helpful, unhelpful]) await expect(button).toBeDisabled();
  await helpful.click({ force: true });
  await poor.click({ force: true });
  assert.deepEqual(await pressed(), ['false', 'false', 'true', 'false']);
  await page.getByRole('button', { name: 'Before ratings', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'After ratings', exact: true })).toBeFocused();
  await page.getByRole('checkbox', { name: 'Disable ratings' }).uncheck();
  // Direction changes layout only: order of options in the DOM and tab sequence is unchanged.
  await page.getByRole('checkbox', { name: 'Right to left' }).check();
  const [goodBox, poorBox] = [await good.boundingBox(), await poor.boundingBox()];
  assert.ok(goodBox.x > poorBox.x, 'RTL places the first option at the inline start');
  await page.getByRole('button', { name: 'Before ratings', exact: true }).focus();
  await page.keyboard.press('Tab'); await expect(good).toBeFocused();
  await page.screenshot({ path: join(tmpdir(), 'react-message-rating.png'), fullPage: false });
  const count = JSON.parse(await requests.textContent()).length;
  assert.equal(count, 7, 'disabled and layout interaction requested nothing');
}

export async function runSelectScenarios(page, url) {
  await page.goto(`${url}/?menu&select`);
  const trigger = page.locator('.tp-select__trigger');
  const list = page.getByRole('listbox', { name: 'Fixture tone', exact: true });
  const plain = list.getByRole('option', { name: /^Plain literal <&>/ });
  const formal = list.getByRole('option', { name: 'Formal', exact: true });
  const long = list.getByRole('option', { name: /^A long wrapping tone label/ });
  const value = page.getByTestId('select-value');
  const requests = page.getByTestId('select-requests');
  await expect(trigger).toHaveText('Pick a tone');
  await expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
  await expect(list).toHaveCount(0);
  for (const width of [1280, 390]) {
    if (page.viewportSize()?.width !== width || page.viewportSize()?.height !== 844) {
      await page.evaluate(() => {
        window.selectViewportReady = new Promise(resolve => window.addEventListener('resize', () => resolve(), { once: true }));
      });
      await page.setViewportSize({ width, height: 844 });
      await handshake(page.evaluate(() => window.selectViewportReady), 'select fixture viewport resize');
    }
    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    await expect(list.getByRole('option')).toHaveCount(4);
    const evidence = await list.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const anchor = document.querySelector('.tp-select__trigger').getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        portaled: node.parentElement === document.body,
        contained: box.left >= 8 && box.top >= 8 && box.right <= innerWidth - 8 && box.bottom <= innerHeight - 8,
        above: box.bottom <= anchor.top,
        fits: node.scrollWidth <= node.clientWidth,
        targets: Array.from(node.querySelectorAll('button')).every(button => button.getBoundingClientRect().height >= 40),
        literal: node.querySelector('b') === null && node.textContent.includes('No <b>markup</b> is interpreted'),
        rtl: style.direction, font: style.fontFamily, fontSize: style.fontSize,
        surface: style.backgroundColor, text: style.color,
      };
    });
    assert.deepEqual(evidence, { portaled: true, contained: true, above: true, fits: true, targets: true, literal: true, rtl: 'rtl', font: 'monospace', fontSize: '18px', surface: 'rgb(241, 242, 243)', text: 'rgb(11, 22, 33)' });
    await page.screenshot({ path: join(tmpdir(), `react-select-plain-${width}.png`), fullPage: false });
    await page.keyboard.press('Escape');
    await expect(list).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
  // Nothing was requested by opening, navigating or dismissing.
  await expect(requests).toHaveText('[]');
  await trigger.press('Enter');
  await expect(plain).toBeFocused();
  await page.keyboard.press('ArrowDown'); await expect(formal).toBeFocused();
  await page.keyboard.press('End'); await expect(long).toBeFocused();
  await page.keyboard.press('ArrowDown'); await expect(plain).toBeFocused();
  await page.keyboard.press('Home'); await expect(plain).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(list).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveText('Plain literal <&>');
  await expect(value).toHaveText(JSON.stringify('plain<&'));
  // Reopening focuses the selection; activating it again requests nothing.
  await trigger.press('Space');
  await expect(plain).toBeFocused();
  await expect(plain).toHaveAttribute('aria-selected', 'true');
  await expect(formal).toHaveAttribute('aria-selected', 'false');
  await page.keyboard.press('Enter');
  await expect(list).toHaveCount(0);
  await expect(requests).toHaveText(JSON.stringify(['plain<&']));
  // The disabled option is inert for a real pointer.
  await trigger.click();
  await list.getByRole('option', { name: 'Unavailable tone', exact: true }).click({ force: true });
  await expect(list).toHaveCount(1);
  await expect(requests).toHaveText(JSON.stringify(['plain<&']));
  // A refused change leaves the owner's value displayed and selected.
  await page.keyboard.press('Escape');
  await page.getByRole('checkbox', { name: 'Refuse changes' }).check();
  await trigger.click();
  await formal.click();
  await expect(list).toHaveCount(0);
  await expect(requests).toHaveText(JSON.stringify(['plain<&', 'formal']));
  await expect(value).toHaveText(JSON.stringify('plain<&'));
  await expect(trigger).toHaveText('Plain literal <&>');
  // Tab continues from the trigger's natural order (RTL does not change order).
  await trigger.press('Enter'); await expect(plain).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: 'After select' })).toBeFocused();
  await expect(list).toHaveCount(0);
  await trigger.click(); await expect(plain).toBeFocused();
  await page.getByRole('heading', { name: 'Installed select' }).click();
  await expect(list).toHaveCount(0);
  console.log('Installed React select: portaled listbox above a clipped anchor, literal options, keyboard, disabled skipping, accepted/refused/unchanged selection, Tab destination, local RTL/theme/font and 1280/390 containment passed.');
}

export async function runOverflowMenuScenarios(page, url) {
  await page.goto(`${url}/?menu`);
  const trigger = page.getByRole('button', { name: 'Fixture actions for full ID' });
  const menu = page.getByRole('menu', { name: 'Fixture actions for full ID' });
  const first = page.getByRole('menuitem', { name: 'First literal <&>' });
  const last = page.getByRole('menuitem', { name: /^Last destructive/ });
  await expect(menu).toHaveCount(0);
  for (const width of [1280, 390, 600]) {
    // setViewportSize can finish before its resize event is dispatched. That
    // event legitimately dismisses an open menu, so complete it before opening.
    if (page.viewportSize()?.width !== width || page.viewportSize()?.height !== 844) {
      await page.evaluate(() => {
        window.overflowMenuViewportReady = new Promise(resolve => window.addEventListener('resize', () => resolve(), { once: true }));
      });
      await page.setViewportSize({ width, height: 844 });
      await handshake(page.evaluate(() => window.overflowMenuViewportReady), 'menu fixture viewport resize');
    }
    await trigger.focus();
    await page.keyboard.press('ArrowUp');
    await expect(last).toBeFocused();
    const evidence = await menu.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        contained: box.left >= 8 && box.top >= 8 && box.right <= innerWidth - 8 && box.bottom <= innerHeight - 8,
        targets: Array.from(node.querySelectorAll('button')).every(button => button.getBoundingClientRect().height >= 40),
        rtl: style.direction, font: style.fontFamily, fontSize: style.fontSize,
        surface: style.backgroundColor, text: style.color,
        rootDirection: getComputedStyle(document.documentElement).direction,
      };
    });
    assert.deepEqual(evidence, { contained: true, targets: true, rtl: 'rtl', font: 'monospace', fontSize: '18px', surface: 'rgb(241, 242, 243)', text: 'rgb(11, 22, 33)', rootDirection: 'ltr' });
    await page.screenshot({ path: join(tmpdir(), `react-overflow-menu-plain-${width}.png`), fullPage: false });
    const survivingLast = await last.elementHandle();
    await page.keyboard.press('F2');
    await expect(last).toContainText('Expanded literal <&>');
    await expect(last).toBeFocused();
    assert.equal(await survivingLast.evaluate(node => node === document.activeElement), true, 'label growth preserves focused item DOM');
    await expect.poll(() => menu.evaluate(node => {
      const box = node.getBoundingClientRect();
      return box.left >= 8 && box.top >= 8 && box.right <= innerWidth - 8 && box.bottom <= innerHeight - 8 && node.scrollWidth <= node.clientWidth;
    })).toBe(true);
    await page.screenshot({ path: join(tmpdir(), `react-overflow-menu-plain-grown-${width}.png`), fullPage: false });
    await page.keyboard.press('F2');
    await expect(last).not.toContainText('Expanded literal <&>');
    await expect(last).toBeFocused();
    await page.keyboard.press('ArrowDown'); await expect(first).toBeFocused();
    await page.keyboard.press('ArrowUp'); await expect(last).toBeFocused();
    await page.keyboard.press('Home'); await expect(first).toBeFocused();
    await page.keyboard.press('End'); await expect(last).toBeFocused();
    await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0); await expect(trigger).toBeFocused();
    await trigger.press('Enter'); await expect(first).toBeFocused();
    await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: 'After menu' })).toBeFocused();
    await expect(menu).toHaveCount(0);
    await trigger.press('Space'); await expect(first).toBeFocused();
    await page.keyboard.press('Shift+Tab'); await expect(page.getByRole('button', { name: 'Before menu' })).toBeFocused();
    await trigger.click();
    await first.press('Enter'); await expect(trigger).toBeFocused();
  }
  await expect(page.getByTestId('menu-selected')).toHaveText(JSON.stringify(['literal<&', 'literal<&', 'literal<&']));
  await page.getByRole('checkbox', { name: 'Refuse closing' }).check();
  await trigger.click();
  const toggle = page.getByRole('button', { name: 'Toggle anchor availability' });
  await toggle.click();
  await expect(menu).toHaveCount(0); await expect(toggle).toBeFocused();
  const hiddenTrigger = page.locator('.tp-overflow-menu__trigger[aria-label="Fixture actions for full ID"]');
  await expect(hiddenTrigger).toHaveAttribute('aria-expanded', 'false');
  await expect(hiddenTrigger).not.toHaveAttribute('aria-controls');
  await toggle.click(); await expect(menu).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset open cycle' }).click();
  await page.getByRole('checkbox', { name: 'Refuse closing' }).uncheck();
  await trigger.click(); await expect(first).toBeFocused();
  await menu.evaluate(node => node.parentElement?.setAttribute('data-theme', 'changed'));
  await expect(menu).toHaveCount(0);
  await trigger.click();
  await page.setViewportSize({ width: 601, height: 844 });
  await expect(menu).toHaveCount(0);
  console.log('Installed React overflow menu: keyboard, literal commands, Tab destinations, unavailable-anchor suppression, local RTL/theme/font and 1280/390/600 viewport placement passed.');
}


/** Real installed ThreadList → owner → OverflowMenu context requests. */
export async function runContextMenuScenarios(page, url) {
  await page.goto(`${url}/?menu`);
  const owner = page.getByRole('region', { name: 'Installed row context owner' });
  const row = owner.getByRole('button', { name: 'Beta context', exact: true });
  const trigger = owner.getByRole('button', { name: 'Context actions for Beta context (context-b<&)' });
  const alphaTrigger = owner.getByRole('button', { name: 'Context actions for Alpha context (context-a)' });
  const menu = page.getByRole('menu', { name: 'Context actions for Beta context (context-b<&)' });
  const first = page.getByRole('menuitem', { name: 'Context first literal <&>' });
  const last = page.getByRole('menuitem', { name: 'Context last command' });
  for (const [width, rtl] of [[1280, false], [390, false], [600, true]]) {
    if (page.viewportSize()?.width !== width || page.viewportSize()?.height !== 844) {
      await page.evaluate(() => {
        window.contextViewportReady = new Promise(resolve => window.addEventListener('resize', () => resolve(), { once: true }));
      });
      await page.setViewportSize({ width, height: 844 });
      await handshake(page.evaluate(() => window.contextViewportReady), 'context viewport resize');
    }
    await owner.getByRole('checkbox', { name: 'Context RTL' }).setChecked(rtl);
    const rowBox = await row.boundingBox();
    assert.ok(rowBox);
    const position = { x: rtl ? rowBox.width - 16 : 16, y: rowBox.height / 2 };
    const point = { x: Math.floor(rowBox.x + position.x), y: Math.floor(rowBox.y + position.y) };
    const count = Number(await owner.getByTestId('context-requests').textContent());
    await page.mouse.click(point.x, point.y, { button: 'right' });
    await expect(first).toBeFocused();
    await expect(owner.getByTestId('context-requests')).toHaveText(String(count + 1));
    await expect(owner.getByTestId('context-selected')).toHaveText('context-a');
    await expect(owner.getByTestId('context-commands')).toHaveText('[]');
    await expect.poll(() => menu.evaluate((node, { point, rtl }) => {
      const box = node.getBoundingClientRect();
      const left = Math.max(8, Math.min(point.x - (rtl ? box.width : 0), innerWidth - box.width - 8));
      const preferred = point.y + 4 + box.height > innerHeight - 8 ? point.y - box.height - 4 : point.y + 4;
      const top = Math.max(8, Math.min(preferred, innerHeight - box.height - 8));
      return Math.abs(box.left - left) < 1 && Math.abs(box.top - top) < 1 && box.left >= 8 && box.right <= innerWidth - 8 && box.top >= 8 && box.bottom <= innerHeight - 8;
    }, { point, rtl })).toBe(true);
    await page.screenshot({ path: join(tmpdir(), `react-context-menu-plain-${width}.png`), fullPage: false });
    const survivingMenu = await menu.elementHandle();
    const survivingLast = await last.elementHandle();
    await page.keyboard.press('End');
    await expect(last).toBeFocused();
    await page.keyboard.press('F3');
    await expect(last).toBeFocused();
    assert.equal(await survivingMenu.evaluate(node => node === document.querySelector('[role="menu"]')), true, 'point update keeps menu DOM');
    assert.equal(await survivingLast.evaluate(node => node === document.activeElement), true, 'point update keeps focused command DOM');
    await expect.poll(() => menu.evaluate(node => {
      const box = node.getBoundingClientRect();
      return Math.abs(box.right - (innerWidth - 8)) < 1 && box.top >= 8 && Math.abs(box.bottom - (innerHeight - 8)) < 1;
    })).toBe(true);
    await page.screenshot({ path: join(tmpdir(), `react-context-menu-plain-edge-${width}.png`), fullPage: false });
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(row).toBeFocused();
    for (const key of ['Shift+F10', 'ContextMenu']) {
      const before = Number(await owner.getByTestId('context-requests').textContent());
      await row.press(key);
      await expect(first).toBeFocused();
      await expect(owner.getByTestId('context-requests')).toHaveText(String(before + 1));
      await page.keyboard.press('Escape');
      await expect(row).toBeFocused();
    }
    // A real right-click after both keyboard gestures must still open once.
    await page.mouse.click(point.x, point.y, { button: 'right' });
    await expect(first).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await row.press('ContextMenu');
    await page.keyboard.press('Shift+Tab');
    await expect(alphaTrigger).toBeFocused();
    await expect(menu).toHaveCount(0);
    await trigger.click();
    await expect(first).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  }
  await row.press('ContextMenu');
  await first.press('Enter');
  await expect(owner.getByTestId('context-commands')).toHaveText(JSON.stringify(['context-b<&:literal<&']));
  await expect(row).toBeFocused();
  await row.press('ContextMenu');
  const invokerHandle = await row.elementHandle();
  await invokerHandle.evaluate(node => { node.hidden = true; });
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await invokerHandle.evaluate(node => { node.hidden = false; });
  await row.press('ContextMenu');
  const triggerHandle = await trigger.elementHandle();
  await triggerHandle.evaluate(node => { node.parentElement.hidden = true; });
  await expect(menu).toHaveCount(0);
  await triggerHandle.evaluate(node => { node.parentElement.hidden = false; });
  await expect(menu).toHaveCount(0);
  await expect(owner.getByTestId('context-selected')).toHaveText('context-a');
  console.log('Installed React row contexts: original pointer/keyboard requests, viewport/RTL placement, live point and focus identity, invoker Escape/Tab, exact commands and anchor suppression passed.');
}

async function runMessageSpacingScenarios(page, server) {
  const counters = () => ({
    runs: server.requests.length,
    history: server.historyRequests.length,
    joins: server.joinRequests.length,
    status: server.statusRequests.length,
    threads: server.threads.requests.length,
    checkpoints: server.checkpoints.requests.length,
  });
  const before = counters();
  await page.goto(`${server.url}/?message-spacing`);
  await expect(
    page.getByRole('heading', { name: 'Installed message spacing' })
  ).toBeVisible();
  const margin = async (article, rem) => {
    await expect(article).toHaveCount(1);
    expect(
      await article.evaluate(
        (element) =>
          parseFloat(getComputedStyle(element).marginBlockStart) /
          parseFloat(getComputedStyle(document.documentElement).fontSize)
      )
    ).toBe(rem);
  };
  for (const direction of ['ltr', 'rtl']) {
    const region = page.getByRole('region', {
      name: `Spacing ${direction}`,
      exact: true,
    });
    await expect(region).toHaveCSS('direction', direction);
    const wrapped = region.getByRole('region', {
      name: `Wrapped ${direction}`,
      exact: true,
    });
    await expect(wrapped.locator('[data-spacing-wrapper]')).toHaveCount(8);
    for (const prevRole of ['assistant', 'user', 'system', 'tool']) {
      const article = wrapped.getByRole('article', {
        name: `following-${prevRole}`,
        exact: true,
      });
      await expect(article).toHaveAttribute('data-prev-role', prevRole);
      await margin(article, prevRole === 'assistant' ? 1.5 : 0.5);
      const explicit = region.getByRole('article', {
        name: `Explicit ${prevRole}`,
        exact: true,
      });
      await expect(explicit).toHaveAttribute('data-prev-role', prevRole);
      await margin(explicit, prevRole === 'assistant' ? 1.5 : 0.5);
    }
    const first = region
      .getByRole('region', { name: `First ${direction}`, exact: true })
      .getByRole('article');
    await expect(first).not.toHaveAttribute('data-prev-role');
    await margin(first, 0.5);
    await margin(
      region
        .getByRole('region', { name: `Default ${direction}`, exact: true })
        .getByRole('article', { name: 'user message', exact: true }),
      1.5
    );
    const fallback = region.getByRole('article', {
      name: 'Missing context',
      exact: true,
    });
    await expect(fallback).not.toHaveAttribute('data-prev-role');
    await margin(fallback, 1.5);
  }
  await page
    .getByRole('button', { name: 'Dispose spacing owner', exact: true })
    .click();
  await expect(page.getByTestId('spacing-owner')).toHaveText('disposed');
  await expect(page.getByRole('article')).toHaveCount(0);
  assert.deepEqual(
    counters(),
    before,
    'spacing mount, projection and explicit disposal create no backend requests'
  );
}

export async function runMessageControlsScenarios(browser, server) {
  const counters = () => ({
    runs: server.requests.length, history: server.historyRequests.length,
    joins: server.joinRequests.length, status: server.statusRequests.length,
    threads: server.threads.requests.length, checkpoints: server.checkpoints.requests.length,
  });
  const before = counters();
  const pageErrors = [];
  const unexpected = [];
  const consoleFailures = [];
  for (const mode of ['desktop', 'narrow', 'hoverless', 'reduced', 'forced']) {
    const context = await browser.newContext({
      viewport: { width: mode === 'narrow' ? 768 : 1280, height: 1100 },
      ...(mode === 'hoverless' ? { hasTouch: true, isMobile: true } : {}),
      ...(mode === 'reduced' ? { reducedMotion: 'reduce' } : {}),
      ...(mode === 'forced' ? { forcedColors: 'active' } : {}),
    });
    try {
      // Observe accidental clipboard ownership without exercising OS clipboard.
      await context.addInitScript(() => {
        window.controlsClipboardCalls = 0;
        Object.defineProperty(navigator, 'clipboard', { value: {
          writeText: async () => { window.controlsClipboardCalls++; },
          readText: async () => { window.controlsClipboardCalls++; return ''; },
        } });
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('console', (message) => {
        if (['warning', 'error'].includes(message.type())) consoleFailures.push(message.text());
      });
      page.on('request', (request) => {
        if (!request.url().startsWith(`${server.url}/`)) unexpected.push(request.url());
      });
      await page.goto(`${server.url}/?message-controls`);
      await expect(page.getByRole('heading', { name: 'Installed message controls' })).toBeVisible();
      const media = await page.evaluate(() => ({
        narrow: matchMedia('(max-width: 768px)').matches,
        hoverless: matchMedia('(hover: none)').matches,
        reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
        forced: matchMedia('(forced-colors: active)').matches,
      }));
      assert.deepEqual(media, {
        narrow: mode === 'narrow', hoverless: mode === 'hoverless',
        reduced: mode === 'reduced', forced: mode === 'forced',
      }, `${mode} exercises the intended real browser media`);
      const article = (id) => page.getByRole('article', { name: id, exact: true });
      const controls = (id) => article(id).locator(':scope > .tp-chat-message__controls');
      const button = (id) => page.getByRole('button', { name: `Act ${id}`, exact: true });
      const calls = {};
      const expectCalls = () => expect(page.getByTestId('action-counts')).toHaveText(JSON.stringify(calls));
      const activate = async (id, keyboard = false) => {
        if (keyboard) await page.keyboard.press('Enter');
        else await button(id).click();
        calls[id] = (calls[id] ?? 0) + 1;
        await expectCalls();
      };
      const rest = async () => {
        await page.getByRole('button', { name: 'After transcript', exact: true }).focus();
        await page.mouse.move(0, 0);
        await expect.poll(() => page.locator('article:hover').count()).toBe(0);
      };
      const style = async (id, visible) => {
        await expect(controls(id)).toHaveCSS('opacity', visible ? '1' : '0');
        await expect(controls(id)).toHaveCSS('pointer-events', visible ? 'auto' : 'none');
      };
      const geometry = () => controls('historical').evaluate((element) => {
        const own = element.getBoundingClientRect();
        const parent = element.parentElement.getBoundingClientRect();
        return { width: own.width, height: own.height, offset: own.top - parent.top, articleHeight: parent.height };
      });
      await rest();
      await expectCalls();
      const alwaysVisible = mode === 'narrow' || mode === 'hoverless';
      await style('historical', alwaysVisible);
      await style('current', true);
      for (const id of ['user', 'system', 'tool']) {
        await style(id, true);
        await activate(id);
      }
      for (const id of ['nested', 'standalone']) {
        const group = button(id).locator('..');
        await expect(group).toHaveCSS('opacity', '1');
        await expect(group).toHaveCSS('pointer-events', 'auto');
        if (id === 'nested') await expect(page.getByTestId('nested-controls')).toHaveCSS('opacity', '1');
        await activate(id);
      }
      await rest();
      const original = await button('historical').elementHandle();
      const currentOriginal = await button('current').elementHandle();
      const wrapperOriginal = await controls('historical').elementHandle();
      const initialGeometry = await geometry();
      const sameNodes = async () => {
        assert.equal(await button('historical').evaluate((element, retained) => element === retained, original), true);
        assert.equal(await controls('historical').evaluate((element, retained) => element === retained, wrapperOriginal), true);
        assert.equal(await button('current').evaluate((element, retained) => element === retained, currentOriginal), true);
      };
      if (!alwaysVisible) {
        await article('historical').hover();
        await style('historical', true);
        assert.deepEqual(await geometry(), initialGeometry, 'hover reserves identical layout');
        await activate('historical');
        await rest();
        await style('historical', false);
        // Actual Tab crosses from a preceding target into opacity-hidden controls.
        await page.getByRole('button', { name: 'Before historical', exact: true }).focus();
        await style('historical', false);
        await page.keyboard.press('Tab');
        await expect(button('historical')).toBeFocused();
        await style('historical', true);
        assert.deepEqual(await geometry(), initialGeometry, 'keyboard reveal reserves identical layout');
        await activate('historical', true);
        await page.keyboard.press('Tab');
        await expect(page.getByRole('button', { name: 'Again historical', exact: true })).toBeFocused();
        await style('historical', true);
        await page.keyboard.press('Tab');
        await expect(page.getByRole('button', { name: 'Before user', exact: true })).toBeFocused();
        await style('historical', false);
      } else {
        await activate('historical');
      }
      await sameNodes();
      await activate('current');
      await page.getByRole('button', { name: 'Append user', exact: true }).click();
      await rest();
      await expect(article('current')).toHaveAttribute('data-current', 'false');
      await style('current', alwaysVisible);
      await page.getByRole('button', { name: 'Remove user', exact: true }).click();
      await rest();
      await expect(article('current')).toHaveAttribute('data-current', 'true');
      await style('current', true);
      await page.getByRole('button', { name: 'Move historical last', exact: true }).click();
      await rest();
      await expect(article('historical')).toHaveAttribute('data-current', 'true');
      await expect(article('current')).toHaveAttribute('data-current', 'false');
      await expect(article('historical')).toHaveAttribute('data-prev-role', 'assistant');
      await style('historical', true);
      await style('current', alwaysVisible);
      await sameNodes();
      await page.getByRole('button', { name: 'Restore order', exact: true }).click();
      await page.getByRole('button', { name: 'Toggle streaming', exact: true }).click();
      await rest();
      await expect(article('historical')).toHaveAttribute('data-streaming', 'true');
      await expect(article('current')).toHaveAttribute('data-streaming', 'true');
      await style('current', true);
      await activate('current');
      await rest();
      await style('historical', alwaysVisible);
      if (!alwaysVisible) await article('historical').hover();
      await style('historical', true);
      await activate('historical');
      await rest();
      await page.getByRole('button', { name: 'Before historical', exact: true }).focus();
      await style('historical', alwaysVisible);
      await page.keyboard.press('Tab');
      await expect(button('historical')).toBeFocused();
      await style('historical', true);
      await activate('historical', true);
      await sameNodes();
      await page.getByRole('button', { name: 'Toggle streaming', exact: true }).click();
      await expect(article('historical')).toHaveAttribute('data-streaming', 'false');
      await page.getByRole('button', { name: 'Toggle direction', exact: true }).click();
      await expect(article('historical')).toHaveCSS('direction', 'rtl');
      await rest();
      await style('historical', alwaysVisible);
      await page.getByRole('button', { name: 'Before historical', exact: true }).focus();
      await style('historical', alwaysVisible);
      await page.keyboard.press('Tab');
      await expect(button('historical')).toBeFocused();
      await style('historical', true);
      await activate('historical', true);
      if (mode === 'reduced') await expect(controls('historical')).toHaveCSS('transition-duration', '0s');
      else {
        await expect(controls('historical')).toHaveCSS('transition-property', 'opacity');
        await expect(controls('historical')).toHaveCSS('transition-duration', '0.2s');
        await expect(controls('historical')).toHaveCSS('transition-timing-function', 'ease');
      }
      if (mode === 'forced') {
        await expect(button('historical')).toHaveCSS('outline-style', 'solid');
        assert.notEqual(await button('historical').evaluate((element) => getComputedStyle(element).outlineWidth), '0px');
      }
      await rest();
      await style('historical', alwaysVisible);
      await sameNodes();
      await expectCalls();
      assert.equal(await page.evaluate(() => window.controlsClipboardCalls), 0);
      await page.getByRole('button', { name: 'Dispose controls owner', exact: true }).click();
      await expect(page.getByTestId('controls-owner')).toHaveText('disposed');
      await expect(page.getByRole('article')).toHaveCount(0);
      await expectCalls();
    } finally { await context.close(); }
  }
  assert.deepEqual(counters(), before, 'controls projection, local actions and disposal produce no backend I/O');
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleFailures, []);
  assert.deepEqual(unexpected, []);
  console.log('Installed React message controls: desktop hover/Tab/current/streaming, append/remove/reorder, DOM/layout identity, 768px and wide hover:none contexts, RTL, reduced motion, forced colors, exact local actions and no clipboard/backend I/O passed.');
}

export async function runMessageActionIconScenarios(browser, server) {
  const counters = () => ({
    runs: server.requests.length, history: server.historyRequests.length,
    joins: server.joinRequests.length, status: server.statusRequests.length,
    threads: server.threads.requests.length, checkpoints: server.checkpoints.requests.length,
  });
  const before = counters();
  const pageErrors = [];
  const consoleFailures = [];
  const unexpected = [];
  for (const mode of ['no-styles', 'desktop', 'narrow', 'rtl', 'forced', 'reduced']) {
    const context = await browser.newContext({
      viewport: { width: mode === 'narrow' ? 360 : 1280, height: 1100 },
      ...(mode === 'forced' ? { forcedColors: 'active' } : {}),
      ...(mode === 'reduced' ? { reducedMotion: 'reduce' } : {}),
    });
    try {
      await context.addInitScript(() => {
        window.iconClipboardCalls = 0;
        Object.defineProperty(navigator, 'clipboard', { value: {
          writeText: async () => { window.iconClipboardCalls++; },
          readText: async () => { window.iconClipboardCalls++; return ''; },
        } });
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('console', (message) => {
        if (['warning', 'error'].includes(message.type())) consoleFailures.push(message.text());
      });
      page.on('request', (request) => {
        if (!request.url().startsWith(`${server.url}/`)) unexpected.push(request.url());
      });
      await page.goto(`${server.url}/?message-action-icons${mode === 'no-styles' ? '&no-styles' : ''}`);
      await expect(page.getByRole('heading', { name: 'Installed message action icons' })).toBeVisible();
      assert.deepEqual(await page.evaluate(() => ({
        narrow: matchMedia('(max-width: 768px)').matches,
        forced: matchMedia('(forced-colors: active)').matches,
        reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
      })), { narrow: mode === 'narrow', forced: mode === 'forced', reduced: mode === 'reduced' });
      const command = (name) => page.getByRole('button', { name, exact: true });
      const group = page.getByRole('group', { name: 'Icon commands', exact: true });
      let compactLabel = 'Copy <b>& "answer"';
      const compact = () => group.getByRole('button', { name: compactLabel, exact: true });
      const calls = {};
      const argumentsSeen = [];
      const expectCalls = async () => {
        await expect(page.getByTestId('icon-counts')).toHaveText(JSON.stringify(calls));
        await expect(page.getByTestId('icon-arguments')).toHaveText(JSON.stringify(argumentsSeen));
      };
      const activate = async (target, id, key) => {
        if (key) await page.keyboard.press(key);
        else await target.click();
        calls[id] = (calls[id] ?? 0) + 1;
        argumentsSeen.push(0);
        await expectCalls();
      };
      // Fixture controls are external to the action group. A DOM click lets
      // presentation updates run while the native action keeps keyboard focus.
      const updateWithoutFocus = (name) => command(name).evaluate((element) => element.click());
      if (mode === 'rtl') await command('Toggle direction').click();
      await expect(group).toHaveCSS('direction', mode === 'rtl' ? 'rtl' : 'ltr');
      await expectCalls();
      await expect(group.getByRole('button')).toHaveCount(12);
      await expect(compact()).toHaveAccessibleName(compactLabel);
      await expect(compact()).toHaveAttribute('title', compactLabel);
      await expect(compact().locator('b')).toHaveCount(0);
      await expect(compact().locator('.tp-message-actions__icon')).toHaveAttribute('aria-hidden', 'true');
      await expect(compact().locator('svg title')).toHaveText('Misleading SVG command');
      await expect(group.getByRole('button', { name: 'Misleading SVG command', exact: true })).toHaveCount(0);
      await expect(command('Text only').locator('.tp-message-actions__icon')).toHaveCount(0);
      await expect(command('Icon and label').locator('.tp-message-actions__label')).toHaveCSS('position', 'static');
      for (let index = 0; index < 4; index++) {
        const absent = command(`Absent ${index}`);
        await expect(absent.locator('.tp-message-actions__icon')).toHaveCount(0);
        await expect(absent).not.toHaveAttribute('title');
        await expect(absent).not.toHaveClass(/--icon-only/);
        await expect(absent.locator('.tp-message-actions__label')).toHaveCSS('position', 'static');
        await expect(absent).toHaveAccessibleName(`Absent ${index}`);
      }
      await expect(command('Zero icon').locator('.tp-message-actions__icon')).toHaveText('0');
      for (const name of ['Zero icon', ...Array.from({ length: 4 }, (_, index) => `Owned empty ${index}`)]) {
        await expect(command(name)).toHaveClass(/--icon-only/);
        await expect(command(name)).toHaveAttribute('title', name);
        await expect(command(name).locator('.tp-message-actions__icon')).toHaveCount(1);
      }
      if (mode === 'no-styles') {
        assert.equal(await page.evaluate(() => document.styleSheets.length), 0, 'real CSS-free entry loads no stylesheets');
        await expect(compact().locator('.tp-message-actions__label')).toBeVisible();
        await expect(compact().locator('.tp-message-actions__label')).toHaveCSS('position', 'static');
        await expect(compact().locator('svg')).toBeVisible();
      } else {
        assert.ok(await page.evaluate(() => document.styleSheets.length) > 0, 'opt-in packed stylesheet loaded');
        const label = compact().locator('.tp-message-actions__label');
        await expect(label).toHaveCSS('position', 'absolute');
        await expect(label).toHaveCSS('clip-path', 'inset(50%)');
        await expect(label).toHaveCSS('width', '1px');
        await expect(label).not.toHaveAttribute('aria-hidden');
        await expect(compact().locator('svg')).toHaveCSS('width', '16px');
        await expect(compact().locator('svg')).toHaveCSS('height', '16px');
        assert.equal(await compact().locator('svg').evaluate((svg) => getComputedStyle(svg).stroke === getComputedStyle(svg.closest('button')).color), true, 'glyph inherits currentColor');
        const bounds = await compact().boundingBox();
        assert.ok(bounds.width >= 36 && bounds.height >= 36, `${mode} compact target is at least 36px`);
        assert.equal(await group.evaluate((element) => element.getBoundingClientRect().right <= innerWidth), true, 'group fits narrow viewport');
      }
      await activate(compact(), 'compact-initial');
      await command('Before actions').focus();
      await page.keyboard.press('Tab');
      await expect(command('Text only')).toBeFocused();
      await activate(command('Text only'), 'text', 'Enter');
      await page.keyboard.press('Tab');
      await expect(command('Icon and label')).toBeFocused();
      await activate(command('Icon and label'), 'labelled', 'Space');
      await page.keyboard.press('Tab');
      await expect(compact()).toBeFocused();
      if (mode !== 'no-styles') {
        await expect(compact()).toHaveCSS('outline-style', 'solid');
        await expect(compact()).toHaveCSS('outline-width', '2px');
        await expect(compact()).toHaveCSS('outline-offset', '3px');
      }
      await activate(compact(), 'compact-initial', 'Enter');
      await activate(compact(), 'compact-initial', 'Space');
      const retained = await compact().elementHandle();
      const sameFocusedButton = async () => {
        assert.equal(await compact().evaluate((element, original) => element === original, retained), true);
        await expect(compact()).toBeFocused();
      };
      await updateWithoutFocus('Update action');
      compactLabel = 'Changed <em>& command';
      await expect(compact()).toHaveAccessibleName(compactLabel);
      await expect(compact()).not.toHaveAttribute('title');
      await expect(compact()).not.toHaveClass(/--icon-only/);
      await expect(compact().locator('[data-glyph="changed"]')).toHaveCount(1);
      await sameFocusedButton();
      await expectCalls();
      await updateWithoutFocus('Reorder actions');
      await sameFocusedButton();
      await expect(group.getByRole('button').last()).toHaveAccessibleName('Text only');
      await activate(compact(), 'compact-current', 'Enter');
      await updateWithoutFocus('Toggle action disabled');
      await expect(compact()).toBeDisabled();
      await compact().dispatchEvent('click');
      await expectCalls();
      await updateWithoutFocus('Toggle action disabled');
      await expect(compact()).toBeEnabled();
      assert.equal(await compact().evaluate((element, original) => element === original, retained), true);
      await activate(compact(), 'compact-current');
      await command('Toggle group disabled').click();
      assert.equal(await group.locator('button:disabled').count(), 12);
      await compact().dispatchEvent('click');
      await expectCalls();
      await command('Before actions').focus();
      await page.keyboard.press('Tab');
      await expect(command('After actions')).toBeFocused();
      await command('Toggle group disabled').click();
      await expect(compact()).toBeEnabled();
      await updateWithoutFocus('Update action');
      compactLabel = 'Copy <b>& "answer"';
      await expect(compact()).toHaveAttribute('title', compactLabel);
      assert.equal(await compact().evaluate((element, original) => element === original, retained), true);
      await activate(compact(), 'compact-initial');
      await expectCalls();
      await command('Unmount actions').click();
      await expect(group).toHaveCount(0);
      await expect(page.getByTestId('icon-mounted')).toHaveText('unmounted');
      await expectCalls();
      assert.equal(await page.evaluate(() => window.iconClipboardCalls), 0);
      assert.deepEqual(counters(), before, `${mode} icons do not create backend I/O`);
    } finally { await context.close(); }
  }
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleFailures, []);
  assert.deepEqual(unexpected, []);
  assert.deepEqual(counters(), before);
  console.log('Installed React message action icons: real no-styles entry, styled desktop/narrow/RTL/forced/reduced contexts, literal accessible names and tooltips, decorative glyphs, target/focus geometry, pointer/Enter/Space, current argumentless callbacks, keyed identity, disabled/unmount and zero clipboard/backend I/O passed.');
}

// `a2ui` matches the option given to prepareRuntimeConsumer: only that consumer has the surface fixture.
export async function runRuntimeScenarios(directory, kind, { a2ui = false } = {}) {
  const server = await serveRuntimeConsumer(directory);
  let browser;
  let context;
  const pageErrors = [];
  const consoleFailures = [];
  const unexpected = [];
  const completed = [];
  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    const page = await context.newPage();
    const conversation = page.getByRole('region', { name: 'Conversation', exact: true });
    const expectConversation = (rows) => expect(conversation.locator('li p')).toHaveText(rows);
    const expectValues = (value) => expect(page.getByTestId('values')).toHaveText(value === undefined ? 'unobserved' : JSON.stringify(value));
    const expectInterrupts = (interrupts) => expect(page.getByTestId('interrupts')).toHaveText(JSON.stringify(interrupts));
    const children = async () => JSON.parse(await page.getByTestId('subgraphs').innerText());
    const expectChild = async (namespace, content, delivery, values = null, interrupts = []) => {
      await expect.poll(async () => {
        const child = (await children()).find((entry) => JSON.stringify(entry.namespace) === JSON.stringify(namespace));
        return child && { content: child.messages.map((message) => message.content).join('\n'), delivery: child.messages.at(-1)?.delivery, values: child.values, interrupts: child.interrupts };
      }).toEqual({ content, delivery, values, interrupts });
      await expect(page.getByTestId('text')).not.toContainText(content);
    };
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (['warning', 'error'].includes(message.type())) consoleFailures.push(message.text());
    });
    page.on('request', (request) => {
      if (!request.url().startsWith(`${server.url}/`)) unexpected.push(request.url());
    });
    await page.goto(server.url);
    await expect(page.getByTestId('status')).toHaveText('idle');
    await expect(page.getByTestId('owner')).toHaveText('mounted');
    await expect(page.getByTestId('handler-calls')).toHaveText('0');
    await expect(page.getByTestId('submissions')).toHaveText('0');
    await expect(page.getByTestId('resumes-finished')).toHaveText('0');
    await expect(page.getByTestId('resume-outcome')).toHaveText('');
    await expect(page.getByTestId('reconnect-run')).toHaveText('');
    await expect(page.getByTestId('reconnects-finished')).toHaveText('0');
    await expect(page.getByTestId('reconnect-outcome')).toHaveText('');
    await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toBeDisabled();
    await expect(page.getByTestId('human-messages')).toHaveText('0');
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeDisabled();
    await expectValues(undefined);
    await expectInterrupts([]);
    assert.deepEqual(await children(), []);
    await expect(page.getByTestId('history')).toHaveText('unobserved');
    await expect(page.getByTestId('citations')).toHaveText('');
    await expect(page.getByTestId('reasoning')).toHaveText('');
    assert.equal(server.requests.length, 0, 'mount/observation performs no I/O');
    assert.equal(server.historyRequests.length, 0, 'mount/observation performs no history reads');
    completed.push('inert mount');
    await expectConversation([]);
    await expect(conversation.locator('[role="log"], [aria-live], [tabindex]')).toHaveCount(0);

    await page.getByRole('button', { name: 'Load', exact: true }).click();
    await expect(page.getByTestId('loads-finished')).toHaveText('1');
    const expectedHistory = savedHistory.map(({ checkpoint, parent_checkpoint, created_at, next }) => ({ checkpoint, parent_checkpoint, created_at, next }));
    await expect(page.getByTestId('history')).toHaveText(JSON.stringify(expectedHistory));
    await expect(page.getByTestId('transcript')).not.toContainText('Older transcript');
    await expect(page.getByTestId('load-error')).toHaveText('');
    await expectValues({ stage: 'saved', profile: { name: 'Saved user' } });
    await expectInterrupts(savedInterrupts);
    await expect(page.getByTestId('text')).toHaveText('Saved tool request\nSaved final answer');
    await expect(page.getByTestId('citations')).toHaveText('saved-source: Saved reference');
    await expect(page.getByTestId('reasoning')).toHaveText('Saved reasoning');
    await expect(page.getByTestId('transcript')).toContainText('Saved question');
    await expect(page.getByTestId('transcript')).toContainText('Raw historical weather result');
    await expect(page.getByTestId('delivery')).toHaveText('complete:paused');
    await expect(page.getByTestId('status')).toHaveText('idle');
    assert.deepEqual(JSON.parse(await page.getByTestId('tool').innerText()), [{ id: 'saved-count', name: 'count', args: { values: ['saved'] }, status: 'pending' }]);
    assert.equal(server.historyRequests.length, 1);
    assert.equal(server.requests.length, 0);
    await expect(page.getByTestId('handler-calls')).toHaveText('0');
    completed.push('explicit history load');
    await expectConversation(['Saved question', 'Saved tool request', 'Saved final answer']);
    const savedRow = await conversation.locator('li').first().elementHandle();

    await page.getByRole('button', { name: 'Load', exact: true }).click();
    await expect(page.getByTestId('loads-finished')).toHaveText('2');
    await expect(page.getByTestId('history')).toHaveText(JSON.stringify(expectedHistory));
    await expect(page.getByTestId('load-error')).toHaveText('');
    await expectValues({ stage: 'saved', profile: { name: 'Saved user' } });
    await expectInterrupts(savedInterrupts);
    await expect(page.getByTestId('delivery')).toHaveText('complete:paused');
    await expect(page.getByTestId('text')).toHaveText('Saved tool request\nSaved final answer');
    await expect(page.getByTestId('handler-calls')).toHaveText('0');
    assert.equal(server.historyRequests.length, 2);
    assert.equal(server.requests.length, 0);
    completed.push('equal history refresh');
    await expectConversation(['Saved question', 'Saved tool request', 'Saved final answer']);
    assert.equal(await savedRow.evaluate((node) => node === document.querySelector('section[aria-label="Conversation"] li')), true);
    await expect(page.getByTestId('citations')).toHaveText('saved-source: Saved reference');
    await expect(page.getByTestId('reasoning')).toHaveText('Saved reasoning');

    await page.getByRole('button', { name: 'Load', exact: true }).click();
    await expect(page.getByTestId('loads-finished')).toHaveText('3');
    await expect(page.getByTestId('history')).toHaveText('[]');
    await expect(page.getByTestId('load-error')).toHaveText('');
    await expectValues(undefined);
    await expectInterrupts([]);
    await expect(page.getByTestId('text')).toHaveText('');
    await expect(page.getByTestId('transcript')).toHaveText('');
    await expect(page.getByTestId('citations')).toHaveText('');
    await expect(page.getByTestId('reasoning')).toHaveText('');
    await expect(page.getByTestId('tool')).toHaveText('[]');
    await expect(page.getByTestId('handler-calls')).toHaveText('0');
    assert.equal(server.historyRequests.length, 3);
    assert.equal(server.requests.length, 0);
    completed.push('empty history replacement');
    await expectConversation([]);

    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByTestId('text')).toHaveText('Hello 🌍.');
    await expect(page.getByTestId('delivery')).toHaveText('complete:success');
    await expect(page.getByTestId('status')).toHaveText('idle');
    assert.equal(server.requests.length, 1);
    await expectValues({ stage: 'complete' });
    await expectInterrupts([]);
    completed.push('text success');
    await expectConversation(['Send', 'Hello 🌍.']);
    await expect(page.getByTestId('history')).toHaveText('[]');

    const beforeTool = server.requests.length;
    await expect(
      page.getByRole('region', {
        name: 'Root weather observation',
        exact: true,
      })
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Tool', exact: true }).click();
    await expect(page.getByTestId('text')).toContainText('20 degrees');
    await expect(page.getByTestId('handler-calls')).toHaveText('1');
    await expect(page.getByTestId('status')).toHaveText('idle');
    assert.deepEqual(JSON.parse(await page.getByTestId('tool').innerText()), [{ id: 'call-weather', name: 'weather', args: { city: 'Paris' }, status: 'complete', result: { city: 'Paris', temperature: 20 } }]);
    const observation = page.getByRole('region', {
      name: 'Root weather observation',
      exact: true,
    });
    await expect(observation).toHaveCount(1);
    assert.equal(await observation.locator('h3').textContent(), 'weather');
    assert.deepEqual(await observation.locator('pre').allTextContents(), [
      '{"city":"Paris"}',
      '{"city":"Paris","temperature":20}',
    ]);
    await expect(
      observation.locator('button, [aria-live], [role="status"]')
    ).toHaveCount(0);
    assert.equal(server.requests.length - beforeTool, 2, 'tool has exactly one run and one result continuation');
    await expectValues({});
    assert.deepEqual((await children()).map((child) => child.namespace), [['research:one'], ['research:two', 'writer:nested'], ['research:failed']]);
    await expectChild(['research:one'], 'Child one', 'complete:success', { stage: 'first-child' });
    await expectChild(['research:two', 'writer:nested'], 'Child two', 'complete:success', { stage: 'nested-child' });
    await expectChild(['research:failed'], 'Child failure partial', 'complete:error');
    const failedChild = (await children()).find((child) => child.namespace[0] === 'research:failed');
    assert.ok(failedChild.error);
    assert.ok(!failedChild.error.includes('PRIVATE'));
    assert.equal((await children())[0].messages[0].id, (await children())[1].messages[0].id, 'wire IDs repeat only across isolated namespaces');
    completed.push('tool roundtrip');

    await page.getByRole('button', { name: 'Error', exact: true }).click();
    await expect(page.getByTestId('status')).toHaveText('error');
    await expect(page.getByTestId('error')).not.toHaveText('');
    await expect(page.getByTestId('error')).not.toContainText('PRIVATE');
    assert.equal(server.requests.length, 4, 'failed run is not retried');
    await expectValues({});
    assert.deepEqual(await children(), [], 'independent submission clears child observations');
    completed.push('visible protected error');
    await expect(conversation.locator('li p').last()).toHaveText('Error');
    await expect(conversation).not.toContainText('PRIVATE');

    await page.getByRole('button', { name: 'Hold', exact: true }).click();
    await handshake(server.holdStarted, 'held request');
    await expect(page.getByTestId('text')).toContainText('Held partial');
    await expect(page.getByTestId('delivery')).toHaveText('streaming');
    await expect(page.getByTestId('status')).toHaveText('running');
    await expect(conversation.locator('li p').last()).toHaveText('Held partial');
    const heldRow = await conversation.locator('li').last().elementHandle();
    await expectValues({ stage: 'held', transient: true });
    await expectChild(['research:held'], 'Child held partial', 'streaming');
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await handshake(server.holdAborted, 'native request abort');
    await expect(page.getByTestId('status')).toHaveText('idle');
    await expect(page.getByTestId('delivery')).toHaveText('complete:aborted');
    assert.equal(server.requests.length, 5);
    await expectValues({ stage: 'held', transient: true });
    await expectChild(['research:held'], 'Child held partial', 'complete:aborted');
    completed.push('incremental DOM update and stop abort');
    await expect(conversation.locator('li p').last()).toHaveText('Held partial');
    assert.equal(await heldRow.evaluate((node) => node === document.querySelector('section[aria-label="Conversation"] li:last-child')), true);

    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByTestId('delivery')).toHaveText('complete:paused');
    await expect(page.getByTestId('status')).toHaveText('idle');
    await expect(page.getByTestId('text')).toContainText('Waiting for approvals');
    await expect(conversation.locator('li p').last()).toHaveText('Waiting for approvals');
    await expectValues({ stage: 'approval' });
    await expectInterrupts(liveInterrupts);
    await expectChild(['review:child'], 'Child draft', 'complete:paused', { stage: 'child-approval' }, [{ id: 'child-approval', value: 'Child review' }]);
    await expect(page.getByTestId('handler-calls')).toHaveText('1');
    assert.equal(server.requests.length, 6, 'pause creates exactly one run with no tool continuation');
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expectInterrupts(liveInterrupts);
    await expect(page.getByTestId('delivery')).toHaveText('complete:paused');
    assert.equal(server.requests.length, 6, 'stop after completed pause does not create backend I/O');
    completed.push('full interrupt batch and retained pause after stop');

    await expect(page.getByTestId('human-messages')).toHaveText('5');
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.getByTestId('resumes-finished')).toHaveText('1');
    await expect(page.getByTestId('resume-outcome')).toHaveText('paused');
    await expect(page.getByTestId('delivery')).toHaveText('complete:paused');
    await expect(page.getByTestId('text')).toContainText('One final approval');
    await expect(page.getByTestId('citations')).toHaveText('approval-source: Approval reference');
    await expect(page.getByTestId('reasoning')).toHaveText('Approval reasoning');
    await expectInterrupts([{ id: 'final-approval', value: { question: 'Confirm final action?' } }]);
    await expectValues({ stage: 'final-approval' });
    await expectChild(['review:child'], 'Child final approval', 'complete:paused', { stage: 'child-final-approval' }, [{ id: 'child-final', value: 'Child confirmation' }]);
    await expect(page.getByTestId('human-messages')).toHaveText('5');
    assert.equal(server.requests.length, 7);
    assert.deepEqual(server.requests[6].command, { resume: { 'live-approval': 'yes', 'live-confirmation': false } });
    assert.equal(server.requests[6].input, null);
    completed.push('explicit response map and second pause');

    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.getByTestId('resumes-finished')).toHaveText('2');
    await expect(page.getByTestId('resume-outcome')).toHaveText('success');
    await expect(page.getByTestId('delivery')).toHaveText('complete:success');
    await expect(page.getByTestId('text')).toContainText('Approvals complete');
    await expect(page.getByTestId('text')).not.toContainText('One final approval');
    await expect(page.getByTestId('citations')).toHaveText('');
    await expect(page.getByTestId('reasoning')).toHaveText('');
    await expectInterrupts([]);
    await expectValues({ stage: 'approved' });
    await expectChild(['review:child'], 'Child approved', 'complete:success', { stage: 'child-approved' });
    await expect(page.getByTestId('human-messages')).toHaveText('5');
    await expect(page.getByTestId('submissions')).toHaveText('5');
    await expect(page.getByTestId('handler-calls')).toHaveText('1');
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeDisabled();
    assert.equal(server.requests.length, 8);
    assert.deepEqual(server.requests[7].command, { resume: { 'final-approval': true } });
    assert.equal(server.requests[7].input, null);
    completed.push('same-message resume completion without synthetic input');

    await page.getByRole('button', { name: 'Drop', exact: true }).click();
    await expect(page.getByTestId('status')).toHaveText('error');
    await expect(page.getByTestId('delivery')).toHaveText('complete:interrupted');
    await expect(page.getByTestId('text')).toContainText('Dropped partial');
    await expect(page.getByTestId('reconnect-run')).toHaveText('drop-run');
    await expect(page.getByTestId('human-messages')).toHaveText('6');
    await expect(page.getByTestId('submissions')).toHaveText('6');
    await expectValues({ stage: 'disconnected' });
    await expectChild(['research:drop'], 'Child partial', 'complete:interrupted');
    const droppedChildId = (await children())[0].messages[0].id;
    assert.equal(server.requests.length, 9, 'Drop creates one identified run');
    assert.deepEqual(server.statusRequests, ['running'], 'interim values and EOF do not prove success');
    assert.deepEqual(server.joinRequests, [], 'no session automatic reconnect');
    completed.push('known running run survives premature stream closure');

    await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
    await expect(page.getByTestId('reconnects-finished')).toHaveText('1');
    await expect(page.getByTestId('reconnect-outcome')).toHaveText('success');
    await expect(page.getByTestId('status')).toHaveText('idle');
    await expect(page.getByTestId('delivery')).toHaveText('complete:success');
    await expect(page.getByTestId('text')).toContainText('Dropped partial recovered');
    const recoveredText = await page.getByTestId('text').innerText();
    assert.equal(recoveredText.split('Dropped partial').length - 1, 1, 'reconnect neither duplicates partial text nor creates a second assistant');
    await expectValues({ stage: 'reconnected' });
    await expectChild(['research:drop'], 'Child partial recovered', 'complete:success', { stage: 'child-reconnected' });
    assert.equal((await children())[0].messages.length, 1);
    assert.equal((await children())[0].messages[0].id, droppedChildId, 'same-run anonymous child identity survives reconnect');
    await expect(page.getByTestId('reconnect-run')).toHaveText('');
    await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toBeDisabled();
    await expect(page.getByTestId('human-messages')).toHaveText('6');
    await expect(page.getByTestId('submissions')).toHaveText('6');
    await expect(page.getByTestId('handler-calls')).toHaveText('1');
    assert.equal(server.requests.length, 9, 'reconnect creates no POST');
    assert.deepEqual(server.joinRequests, [{ runId: 'drop-run', lastEventId: '2' }]);
    assert.deepEqual(server.statusRequests, ['running', 'success']);
    completed.push('explicit cursor join and exact-run completion without replay');

    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByTestId('delivery')).toHaveText('complete:success');
    await expect(page.getByTestId('status')).toHaveText('idle');
    await expect(page.getByTestId('text')).toContainText('Hello 🌍.');
    await expect(page.getByTestId('handler-calls')).toHaveText('1');
    assert.equal(server.requests.length, 10);
    await expectValues({ stage: 'complete' });
    await expectInterrupts([]);
    await expect(page.getByTestId('submissions')).toHaveText('7');
    await expect(page.getByTestId('human-messages')).toHaveText('7');
    completed.push('reuse after stop');
    assert.deepEqual((await children()).map((child) => child.namespace), [['child']], 'later Send replaces the earlier namespace set');

    await page.getByRole('button', { name: 'Unmount', exact: true }).click();
    await expect(page.getByTestId('owner')).toHaveText('unmounted');
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Dispose', exact: true }).click();
    await expect(page.getByTestId('owner')).toHaveText('disposed');
    await page.getByRole('button', { name: 'Send after dispose', exact: true }).click();
    await expect(page.getByTestId('owner')).toHaveText('aborted');
    await page.getByRole('button', { name: 'Resume after dispose', exact: true }).click();
    await expect(page.getByTestId('owner')).toHaveText('aborted');
    await page.getByRole('button', { name: 'Reconnect after dispose', exact: true }).click();
    await expect(page.getByTestId('owner')).toHaveText('aborted');
    assert.equal(server.requests.length, 10, 'cleanup/disposal/post-disposal commands create no extra runs');
    assert.equal(server.joinRequests.length, 1);
    assert.equal(server.statusRequests.length, 2);
    assert.deepEqual(server.historyRequests, [{ limit: 10 }, { limit: 10 }, { limit: 10 }], 'only explicit loads read history');
    completed.push('unmount and explicit disposal');
    completed.push(...await runThreadScenarios(page, server));
    completed.push(...await runCheckpointScenarios(page, server));
    if (/react/i.test(kind)) {
      await runMessageSpacingScenarios(page, server);
      completed.push('installed message spacing through wrappers and explicit precedence in LTR/RTL');
      await runMessageControlsScenarios(browser, server);
      completed.push('installed assistant controls reveal through hover focus current and device media');
      await runMessageActionIconScenarios(browser, server);
      completed.push('installed message action icons with opt-in styles and native app-owned commands');
      await runRenameFormScenarios(page, server.url);
      await runOverflowMenuScenarios(page, server.url);
      await runSelectScenarios(page, server.url);
      await runMessageRatingScenarios(page, server.url);
      await runComposerSlotScenarios(page, server.url);
      if (a2ui) await runA2uiSurfaceScenarios(page, server.url);
      await runContextMenuScenarios(page, server.url);
      await runConfirmDialogScenarios(page, server.url);
    }
    assert.deepEqual(server.errors.map(String), []);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(consoleFailures, [], 'browser console has no warnings or errors');
    assert.deepEqual(unexpected, []);
    const iconsScenario = 'installed message action icons with opt-in styles and native app-owned commands';
    assert.equal(completed.filter((scenario) => scenario === iconsScenario).length, /react/i.test(kind) ? 1 : 0);
    assert.equal(completed.length, /react/i.test(kind) ? 30 : 27);
    console.log(`${kind}: ${completed.length} browser scenarios passed (${completed.join('; ')}); main workflow: 3 exact history reads, 10 exact run POSTs, 1 cursor join GET, 2 exact-run status GETs, one tool handler, 7 component submissions, 2 explicit resumes, 1 explicit reconnect; thread workflow: 4 history POSTs, 2 run POSTs, stream/history abort, no implicit selection I/O; no page errors/unexpected requests.`);
    return completed;
  } finally {
    try { await context?.close(); }
    finally {
      try { await browser?.close(); }
      finally { await server.close(); }
    }
  }
}
