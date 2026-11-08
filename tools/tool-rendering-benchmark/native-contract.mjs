// Run against the isolated vendor installation, never aliases into repo sources.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createBenchmarkServer } from './server.mjs';
import { getScenario } from './scenarios.mjs';

const consumer = resolve(process.argv[2]);
const requireConsumer = createRequire(pathToFileURL(resolve(consumer, 'package.json')));
const { HttpAgent } = await import(
  pathToFileURL(requireConsumer.resolve('@ag-ui/client'))
);
const { DefaultChatTransport, readUIMessageStream } = await import(
  pathToFileURL(resolve(consumer, 'node_modules/ai/dist/index.js'))
);
const server = await createBenchmarkServer({
  port: 0,
  fragmentDelayMs: 1,
  toolDelayMs: 5,
});
try {
  for (const scenario of ['references', 'repeated', 'falsy', 'tool-error']) {
    const prompt = getScenario(scenario).prompt;
    const agent = new HttpAgent({
      url: `${server.url}/ag-ui?participant=agui-contract&scenario=${scenario}`,
    });
    agent.addMessage({ id: 'user', role: 'user', content: prompt });
    const nativeErrors = [];
    await agent.runAgent(
      {},
      { onRunErrorEvent: ({ event }) => nativeErrors.push(event.message) }
    );
    assert.equal(nativeErrors.length, scenario === 'tool-error' ? 1 : 0);
    const outputs = agent.messages.filter((message) => message.role === 'tool');
    assert.equal(
      outputs.length,
      scenario === 'tool-error' ? 0 : getScenario(scenario).calls.length
    );
    const transport = new DefaultChatTransport({
      api: `${server.url}/ai-sdk?participant=aisdk-contract&scenario=${scenario}`,
    });
    const stream = await transport.sendMessages({
      chatId: 'contract',
      trigger: 'submit-message',
      messages: [
        { id: 'user', role: 'user', parts: [{ type: 'text', text: prompt }] },
      ],
    });
    let final;
    for await (const message of readUIMessageStream({
      stream,
      terminateOnError: true,
    }))
      final = message;
    const parts = final.parts.filter(
      (part) => part.type.startsWith('tool-') || part.type === 'dynamic-tool'
    );
    assert.equal(parts.length, getScenario(scenario).calls.length);
    assert.ok(
      parts.every(
        (part) =>
          part.state ===
          (scenario === 'tool-error' ? 'output-error' : 'output-available')
      )
    );
    const [agui, aisdk] = server.receipts().slice(-2);
    const canonical = (receipt) =>
      receipt.tools.map(
        ({
          canonicalId,
          name,
          argsHash,
          resultHash,
          errorHash,
          executionCount,
        }) => ({
          canonicalId,
          name,
          argsHash,
          resultHash,
          errorHash,
          executionCount,
        })
      );
    assert.deepEqual(canonical(agui), canonical(aisdk));
    console.log(
      JSON.stringify({
        scenario,
        nativeClients: ['@ag-ui/client', 'ai/DefaultChatTransport'],
        equalLedger: true,
        tools: parts.length,
      })
    );
  }
} finally {
  await server.close();
}
