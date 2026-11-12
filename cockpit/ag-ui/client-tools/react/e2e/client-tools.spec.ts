import { writeFile } from 'node:fs/promises';
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
interface WireMessage { id: string; role: string; content: string; toolCallId?: string; toolCalls?: {id: string}[] }
interface ModelMessage { id?: string; type: string; content: string; tool_call_id?: string }
interface WireRecord {
  body: {threadId: string; runId: string; messages: WireMessage[]; tools: {name: string}[]};
  events: {type: string; messages?: WireMessage[]; delta?: string}[];
  observations: {socketAttempts: string[]; graphIdentity: number; checkpointerIdentity: number; modelIdentity: number; modelMessages: ModelMessage[][]};
  held: boolean; closed: boolean;
}
const base = '/ag-ui/client-tools/react/';
const names = ['get_weather', 'slow_status_check', 'weather_card', 'weather_snapshot', 'confirm_booking'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function records(request: APIRequestContext) { return (await request.get('/__requests')).json() as Promise<WireRecord[]>; }
async function send(page: Page, text: string) {
  await page.getByLabel('Message', {exact:true}).fill(text);
  await page.getByRole('button', {name:'Send', exact:true}).click();
}
async function complete(page: Page) { await expect(page.getByRole('status')).toHaveText('Command complete.'); }
function causal(wire: WireRecord[], count: number) {
  expect(wire).toHaveLength(count);
  expect(wire[0].body.messages).toHaveLength(1);
  expect(wire[0].body.messages[0].role).toBe('user');
  expect(new Set(wire.map(row => row.body.threadId)).size).toBe(1);
  expect(new Set(wire.map(row => row.body.runId)).size).toBe(count);
  for (const row of wire) {
    expect(row.body.runId).toMatch(uuid);
    expect(row.body.threadId).toMatch(uuid);
    expect(row.body.tools.map((tool: {name: string}) => tool.name)).toEqual(names);
    expect(row.observations.socketAttempts).toEqual([]);
    expect(row.observations.graphIdentity).toBe(wire[0].observations.graphIdentity);
    expect(row.observations.checkpointerIdentity).toBe(wire[0].observations.checkpointerIdentity);
    expect(row.observations.modelIdentity).toBe(wire[0].observations.modelIdentity);
    const model = row.observations.modelMessages.at(-1) ?? [];
    const snapshot = row.events.filter(event => event.type === 'MESSAGES_SNAPSHOT').at(-1)?.messages ?? [];
    for (const result of row.body.messages.filter(message => message.role === 'tool')) {
      const caller = row.body.messages.find(message => message.toolCalls?.some(call => call.id === result.toolCallId));
      expect(caller).toBeDefined();
      expect(row.body.messages.filter(message => message.id === result.id)).toHaveLength(1);
      expect(model.filter(message => message.type === 'tool' && message.id === result.id && message.tool_call_id === result.toolCallId && message.content === result.content)).toHaveLength(1);
      expect(snapshot.filter(message => message.role === 'tool' && message.id === result.id && message.toolCallId === result.toolCallId && message.content === result.content)).toHaveLength(1);
    }
  }
}
test.beforeEach(async ({request}) => { expect((await request.post('/__reset')).ok()).toBe(true); });
test.afterEach(async ({request}, info) => {
  const stats = await (await request.post('/__finish')).json();
  expect(Object.values(stats.closed.at(-1).closure).every(Boolean)).toBe(true);
  const receipt = info.outputPath('canonical-owned-fixture-receipt.json');
  await writeFile(receipt, JSON.stringify(stats, null, 2));
  await info.attach('canonical-owned-fixture-receipt', {path: receipt, contentType:'application/json'});
});
test('five presets fill only the draft and do not issue physical requests', async ({page,request}) => {
  await page.goto(base);
  for (const label of ['Weather result','Slow status','Weather card','Terminal snapshot','Fictional booking']) {
    await page.getByRole('button', {name:label, exact:true}).click();
    await expect(page.getByLabel('Message', {exact:true})).not.toHaveValue('');
    expect(await records(request)).toEqual([]);
  }
});
for (const tool of ['get_weather','weather_card']) {
  test(`${tool} produces one local receipt and one fresh physical continuation`, async ({page,request}) => {
    await page.goto(base); await send(page, `Use ${tool}`); await complete(page);
    const wire = await records(request); causal(wire, 2);
    const result = wire[1].body.messages.filter((message:WireMessage) => message.role === 'tool');
    expect(result).toHaveLength(1);
    expect(wire[1].observations.modelMessages.at(-1)?.filter((message:ModelMessage) => message.type === 'tool')).toHaveLength(1);
    expect(wire[1].body.tools).toEqual(wire[0].body.tools);
    expect(result[0].content).toBe(tool === 'get_weather' ? JSON.stringify({location:'San Francisco',temperatureF:68,conditions:'Sunny',humidity:55,windMph:8}) : JSON.stringify({displayed:true}));
    await expect(page.locator('[data-native-call]')).toHaveCount(1);
    const owner = wire[1].body.messages.find(message => message.toolCalls?.some(call => call.id === result[0].toolCallId));
    if (!owner) throw new Error('Missing canonical assistant call owner');
    await expect(page.locator(`[data-native-message="${owner.id}"] [data-native-call="${result[0].toolCallId}"]`)).toHaveCount(1);
    await expect(page.getByRole('region', {name:'Local tool evidence'})).toContainText('Delivery: observed');
    await expect(page.getByRole('region',{name:'Conversation'})).toContainText('Canonical local results received');
    if (tool === 'weather_card') {
      const card = page.getByRole('region',{name:'Simulated weather for San Francisco'});
      for (const text of ['68°F','Sunny','55%','8 mph']) await expect(card).toContainText(text);
      await card.screenshot({path: test.info().outputPath('weather-desktop.png')});
    }
  });
}
test('terminal snapshot stays local and next explicit human retains it without replay', async ({page,request}) => {
  await page.goto(base); await send(page,'Use weather_snapshot'); await complete(page);
  causal(await records(request),1);
  await expect(page.getByRole('region',{name:'Local tool evidence'})).toContainText('Delivery: unsent');
  await expect(page.locator('[data-native-message]')).toHaveCount(2);
  await send(page,'Plain next human'); await complete(page);
  const wire = await records(request); causal(wire,2);
  expect(wire[1].body.messages.filter((message:WireMessage)=>message.role === 'tool')).toHaveLength(1);
  expect(wire[1].body.messages.at(-1)?.content).toBe('Plain next human');
  await expect(page.locator('[data-native-call]')).toHaveCount(1);
});
for (const decision of [true,false]) {
  test(`fictional booking requires explicit ${decision} and continues once`, async ({page,request}) => {
    await page.goto(base); await send(page,'Use confirm_booking');
    const panel = page.getByRole('region',{name:'Fictional booking'});
    await expect(panel).toContainText('No real reservation'); causal(await records(request),1);
    const choice = page.getByRole('button',{name:decision?'Confirm':'Cancel booking',exact:true});
    const oldChoice = await choice.elementHandle();
    if (!oldChoice) throw new Error('Missing authored booking control');
    await choice.click(); await complete(page);
    await oldChoice.evaluate((button:HTMLElement)=>button.click());
    const wire = await records(request); causal(wire,2);
    expect(wire[1].body.messages.filter((message:WireMessage)=>message.role==='tool').map((message:WireMessage)=>JSON.parse(message.content))).toEqual([{confirmed:decision}]);
    await expect(panel).toContainText(decision?'You confirmed':'You cancelled');
    await panel.screenshot({path: test.info().outputPath('fictional-booking-desktop.png')});
    await page.getByRole('button',{name:'New conversation',exact:true}).click();
    await oldChoice.evaluate((button:HTMLElement)=>button.click());
    expect(await records(request)).toHaveLength(2);
    await send(page,'Plain fresh human'); await complete(page);
    const after = await records(request);
    expect(after[2].body.threadId).not.toBe(wire[0].body.threadId);
    expect(after[2].body.messages).toHaveLength(1);
  });
}
test('slow status Stop cancels three-second local work without continuation or late completion', async ({page,request}) => {
  await page.goto(base); await send(page,'Use slow_status_check');
  await expect(page.getByRole('region',{name:'Local tool evidence'})).toContainText('Local execution: running');
  await expect(page.getByRole('button',{name:'New conversation',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Send',exact:true}).evaluate((button:HTMLButtonElement)=>button.click());
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('Start a new conversation to continue.');
  await page.waitForTimeout(3200); causal(await records(request),1);
  await expect(page.locator('main')).not.toContainText('"status":"complete"');
});
test('plain text is an actual canonical answer without tools', async ({page,request}) => {
  await page.goto(base); await send(page,'Hello canonical'); await complete(page); causal(await records(request),1);
  await expect(page.getByRole('region',{name:'Conversation'})).toContainText('Canonical plain answer: Hello canonical');
  await expect(page.locator('[data-native-call]')).toHaveCount(0);
});
for (const text of ['Unknown','Malformed']) {
  test(`${text} canonical calls never project a local weather or booking panel`, async ({page,request}) => {
    await page.goto(base); await send(page,text);
    await expect(page.getByRole('status')).toHaveText('Start a new conversation to continue.');
    causal(await records(request),text === 'Malformed' ? 2 : 1);
    await expect(page.locator('.weather-card, .booking-panel')).toHaveCount(0);
  });
}
for (const action of ['release','Stop','page exit']) {
  test(`actual streamed arguments held before terminal: ${action} respects execution boundary`, async ({page,request}) => {
    await request.post('/__reset',{data:{mode:'stream',holdTerminal:true}});
    await page.goto(base); await send(page,'Use weather_card');
    await expect.poll(async()=> (await records(request))[0]?.held).toBe(true);
    await expect(page.locator('.weather-card, .booking-panel')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Send',exact:true})).toBeDisabled();
    const wire = await records(request);
    expect(wire[0].events.filter((event:{type:string})=>event.type==='TOOL_CALL_ARGS').length).toBeGreaterThan(1);
    if (action==='Stop') await page.getByRole('button',{name:'Stop',exact:true}).click();
    if (action==='page exit') await page.goto('/');
    if (action!=='release') await expect.poll(async()=> (await records(request))[0].closed).toBe(true);
    await request.post('/__release');
    if (action==='release') {
      // Continuation is held independently by the same owned canonical server.
      await expect.poll(async()=> (await records(request))[1]?.held).toBe(true);
      await request.post('/__release'); await complete(page); causal(await records(request),2);
    } else {
      causal(await records(request),1);
      if (action==='Stop') await expect(page.getByRole('status')).toHaveText('Start a new conversation to continue.');
    }
  });
}
test('multiple native groups keep distinct causal identities on retained history', async ({page,request}) => {
  await page.goto(base); await send(page,'Mixed'); await complete(page);
  await send(page,'Use weather_card'); await complete(page);
  const wire=await records(request); causal(wire,4);
  await expect(page.locator('[data-native-call]')).toHaveCount(3);
  const ids=wire[3].body.messages.flatMap((message:WireMessage)=>message.toolCalls?.map((call:{id:string})=>call.id)??[]);
  expect(new Set(ids).size).toBe(3);
  expect(wire[3].observations.modelMessages.at(-1)?.filter((message:ModelMessage)=>message.type==='tool')).toHaveLength(3);
});
test('mobile literal content and weather readings remain safe', async ({page,request}) => {
  await page.setViewportSize({width:390,height:844}); await page.goto(base);
  await send(page,'Literal weather_card'); await complete(page); causal(await records(request),2);
  await expect(page.locator('.weather-card')).toContainText('<script>San Francisco</script>');
  await expect(page.locator('main script, main img')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('.weather-card').screenshot({path:test.info().outputPath('weather-mobile.png')});
  await page.locator('.weather-card').scrollIntoViewIfNeeded();
  await page.screenshot({path:test.info().outputPath('client-tools-mobile.png'),fullPage:true});
});
test('slow status naturally completes once and delivers its actual local result', async ({page,request}) => {
  await page.goto(base); await send(page,'Use slow_status_check');
  await expect(page.getByRole('region',{name:'Local tool evidence'})).toContainText('Local execution: running');
  await complete(page); const wire=await records(request); causal(wire,2);
  expect(wire[1].body.messages.filter((message:WireMessage)=>message.role==='tool').map((message:WireMessage)=>JSON.parse(message.content))).toEqual([{label:'demo check',status:'complete'}]);
});
test('one explicit human runs two actual client-tool groups and final canonical receipt', async ({page,request}) => {
  await page.goto(base); await send(page,'Rounds get_weather'); await complete(page);
  const wire=await records(request); causal(wire,3);
  expect(wire[2].body.messages.filter(message=>message.role==='user')).toHaveLength(1);
  expect(wire[2].body.messages.filter(message=>message.role==='tool')).toHaveLength(2);
  await expect(page.locator('[data-native-call]')).toHaveCount(2);
  expect(new Set(wire[2].body.messages.flatMap(message=>message.toolCalls?.map(call=>call.id)??[])).size).toBe(2);
});
for(const action of ['Stop','page exit']) {
  test(`pending booking ${action} revokes controls without result or physical continuation`,async({page,request})=>{
    await page.goto(base); await send(page,'Use confirm_booking');
    await expect(page.getByRole('region',{name:'Fictional booking'})).toContainText('No real reservation');
    const control=await page.getByRole('button',{name:'Confirm',exact:true}).elementHandle();
    if(!control) throw new Error('Missing pending booking control');
    if(action==='Stop') {
      await page.getByRole('button',{name:'Stop',exact:true}).click();
      await control.evaluate((button:HTMLElement)=>button.click());
      await expect(page.getByRole('status')).toHaveText('Start a new conversation to continue.');
      await expect(page.getByRole('region',{name:'Fictional booking'})).toContainText('Booking decision cancelled.');
    } else await page.goto('/');
    const wire=await records(request); causal(wire,1);
    expect(wire[0].body.messages.filter(message=>message.role==='tool')).toEqual([]);
  });
}
test('Stop during actual held continuation preserves complete sent-unconfirmed local evidence without replay',async({page,request})=>{
  await request.post('/__reset',{data:{holdTerminal:true,holdAfterRequest:1,holdReceipt:true}});
  await page.goto(base); await send(page,'Use get_weather');
  await expect.poll(async()=> (await records(request))[1]?.held).toBe(true);
  await expect(page.getByRole('region',{name:'Local tool evidence'})).toContainText('Local execution: complete');
  await expect(page.getByRole('region',{name:'Local tool evidence'})).toContainText('Delivery: sent-unconfirmed');
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await expect.poll(async()=> (await records(request))[1].closed).toBe(true);
  await request.post('/__release');
  await expect(page.getByRole('status')).toHaveText('Start a new conversation to continue.');
  causal(await records(request),2);
  await expect(page.getByRole('region',{name:'Local tool evidence'})).toContainText('Delivery: sent-unconfirmed');
  await page.getByRole('button',{name:'New conversation',exact:true}).click();
  expect(await records(request)).toHaveLength(2);
});
