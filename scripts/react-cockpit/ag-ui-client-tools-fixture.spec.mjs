import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { createClientToolsServer } from '../../fixtures/react-parity/native-ag-ui-client-tools/server.mjs';
const root = process.cwd();
const environment = resolve(root, 'cockpit/ag-ui/client-tools/python/.venv');
const tools = ['get_weather', 'slow_status_check', 'weather_card', 'weather_snapshot', 'confirm_booking'].map(name => ({name, description: name, parameters: {type: 'object'}}));
function input(text, runId = 'run-1', messages) {
  return { threadId: 'canonical-cockpit-thread', runId, state: {}, messages: messages ?? [{id: 'human-'+runId, role: 'user', content: text}], tools, context: [], forwardedProps: {} };
}
test('cockpit scenario chooses actual human request and unique calls in retained canonical graph', {timeout: 30000}, async () => {
  const server = await createClientToolsServer({root, environment, scenario: 'cockpit'});
  try {
    const first = input('Show weather_snapshot');
    const response = await fetch(server.url+'/agent', {method:'POST', body: JSON.stringify(first)});
    assert.equal(response.status, 200); await response.text();
    const record = server.stats().requests[0];
    const call = record.events.filter(event => event.type === 'MESSAGES_SNAPSHOT').at(-1).messages.find(message => message.toolCalls?.length).toolCalls[0];
    assert.equal(call.function.name, 'weather_snapshot');
    assert.equal(record.observations.modelMessages[0].filter(m => m.type === 'human').length, 1);
    assert.equal(record.observations.modelCatalogs[0].length, 5);
    assert.deepEqual(record.observations.socketAttempts, []);
  } finally { await server.close(); assert.ok(Object.values(server.stats().closure).every(Boolean)); }
});
test('native wrapper reset closes exact prior owner and retains independent closure receipt', {timeout: 30000}, async () => {
  const { createAgUiClientToolsFixture } = await import('./ag-ui-client-tools-fixture.mjs');
  const fixture = createAgUiClientToolsFixture({root});
  try {
    await fixture.reset();
    const first = fixture.stats().current.ready.pid;
    await fixture.reset({mode: 'stream', holdTerminal: true});
    assert.notEqual(fixture.stats().current.ready.pid, first);
    assert.equal(fixture.stats().closed.length, 1);
    assert.ok(Object.values(fixture.stats().closed[0].closure).every(Boolean));
    assert.equal(fixture.stats().current.ready.mode, 'stream');
    assert.deepEqual(fixture.stats().current.requests, []);
  } finally { await fixture.close(); }
  assert.ok(Object.values(fixture.stats().closed.at(-1).closure).every(Boolean));
  await assert.rejects(fixture.reset(), /closed/);
});
test('concurrent resets serialize and shutdown revokes queued startup without leaking an owner', {timeout: 30000}, async () => {
  const { createAgUiClientToolsFixture } = await import('./ag-ui-client-tools-fixture.mjs');
  const fixture=createAgUiClientToolsFixture({root});
  try {
    await Promise.all([fixture.reset(),fixture.reset({mode:'stream'})]);
    assert.equal(fixture.stats().closed.length,1);
    const starting=fixture.reset();
    const closing=fixture.close();
    await assert.rejects(starting,/closed/);
    await closing;
    assert.equal(fixture.stats().current,undefined);
    assert.equal(fixture.stats().closed.length,2);
    for(const receipt of fixture.stats().closed) assert.ok(Object.values(receipt.closure).every(Boolean));
  } finally { await fixture.close(); }
});
test('holding only a continuation never holds first actual canonical terminal', {timeout:30000}, async () => {
  const server=await createClientToolsServer({root,environment,scenario:'cockpit',holdTerminal:true,holdAfterRequest:1});
  try {
    const controller=new AbortController();
    const response=await fetch(server.url+'/agent',{method:'POST',body:JSON.stringify(input('Use get_weather')),signal:controller.signal});
    assert.equal(server.stats().requests[0].held,false);
    controller.abort();
  } finally {await server.close();}
});
test('one authored human drives two distinct canonical client-tool groups before final answer', {timeout:30000}, async () => {
  const server=await createClientToolsServer({root,environment,scenario:'cockpit'});
  try {
    await (await fetch(server.url+'/agent',{method:'POST',body:JSON.stringify(input('Rounds get_weather'))})).text();
    const first=server.stats().requests[0].events.filter(event=>event.type==='MESSAGES_SNAPSHOT').at(-1).messages;
    const call=first.find(message=>message.toolCalls?.length).toolCalls[0];
    const continuation=input('', 'run-2',[...first,{id:call.id,role:'tool',toolCallId:call.id,content:JSON.stringify({location:'San Francisco',temperatureF:68,conditions:'Sunny',humidity:55,windMph:8})}]);
    await (await fetch(server.url+'/agent',{method:'POST',body:JSON.stringify(continuation)})).text();
    const messages=server.stats().requests[1].events.filter(event=>event.type==='MESSAGES_SNAPSHOT').at(-1).messages;
    assert.equal(messages.at(-1).toolCalls?.[0]?.function.name,'weather_card');
    assert.notEqual(messages.at(-1).toolCalls[0].id,call.id);
  } finally {await server.close();}
});
test('actual cockpit astream emits two partial canonical argument deltas after separate call header', {timeout:30000}, async () => {
  const server=await createClientToolsServer({root,environment,scenario:'cockpit',mode:'stream'});
  try {
    await (await fetch(server.url+'/agent',{method:'POST',body:JSON.stringify(input('Use weather_card'))})).text();
    const deltas=server.stats().requests[0].events.filter(event=>event.type==='TOOL_CALL_ARGS').map(event=>event.delta);
    assert.equal(deltas.length,2);
    assert.equal(JSON.parse(deltas.join('')).temperatureF,68);
    assert.throws(()=>JSON.parse(deltas[0]));
  } finally {await server.close();}
});
test('receipt boundary holds actual final snapshot and terminal together without fabricating events', {timeout:30000}, async () => {
  const server=await createClientToolsServer({root,environment,scenario:'cockpit',holdTerminal:true,holdReceipt:true});
  try {
    const controller=new AbortController();
    const response=await fetch(server.url+'/agent',{method:'POST',body:JSON.stringify(input('Use get_weather')),signal:controller.signal});
    const chunk=await response.body.getReader().read();
    const text=new TextDecoder().decode(chunk.value);
    assert.equal(text.includes('"type":"MESSAGES_SNAPSHOT"'),false);
    controller.abort();
  } finally {await server.close();}
});
