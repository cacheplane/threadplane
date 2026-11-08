// Run against the isolated vendor installation, never aliases into repo sources.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createBenchmarkServer } from './server.mjs';
import { getScenario } from './scenarios.mjs';

const consumer = resolve(process.argv[2]);
const requireConsumer = createRequire(
  pathToFileURL(resolve(consumer, 'package.json'))
);
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
  // Separate from the matched vendor workload: a protocol-native pause closes
  // its stream, and a second request resolves the retained tool invocation.
  for (const approved of [true, false]) {
    const agent = new HttpAgent({
      url: `${server.url}/ag-ui?participant=native-${approved}&scenario=native-approval`,
    });
    agent.addMessage({
      id: 'user',
      role: 'user',
      content: getScenario('native-approval').prompt,
    });
    let interrupt;
    await agent.runAgent(
      {},
      {
        onRunFinishedEvent: ({ event }) => {
          interrupt = event.outcome?.interrupts?.[0];
        },
      }
    );
    assert.ok(interrupt?.id, 'Native RUN_FINISHED carries a parsed interrupt');
    const paused = server.receipts().at(-1);
    assert.equal(paused.status, 'paused');
    assert.equal(server.activeStreams(), 0);
    await agent.runAgent({
      resume: [
        { interruptId: interrupt.id, status: 'resolved', payload: approved },
      ],
    });
    const resumed = server.receipts().at(-1);
    assert.equal(resumed.status, approved ? 'complete' : 'denied');
    assert.equal(resumed.tools[0].nativeId, paused.tools[0].nativeId);
    assert.equal(resumed.tools[0].executionCount, approved ? 1 : 0);
    assert.equal(
      agent.messages.filter((message) => message.role === 'tool').length,
      1
    );
    console.log(
      JSON.stringify({
        scenario: 'native-approval',
        approved,
        nativeClient: '@ag-ui/client',
        retainedToolId: true,
      })
    );
  }
  assert.equal(
    server.savedNotes().length,
    1,
    'One observed local write from one explicit approval'
  );
  const recoveryScenario = getScenario('partial-failure');
  const reader = new HttpAgent({
    url: `${server.url}/ag-ui?participant=native-read&scenario=partial-failure`,
  });
  reader.addMessage({
    id: 'initial-read',
    role: 'user',
    content: recoveryScenario.prompt,
  });
  await reader.runAgent();
  const failedRead = server.receipts().at(-1);
  assert.equal(failedRead.status, 'error');
  const prefix = reader.messages.find(
    (message) =>
      message.role === 'tool' &&
      message.toolCallId === failedRead.tools[0].nativeId
  );
  assert.ok(prefix, 'Successful prefix remains in native transcript');
  reader.addMessage({
    id: 'explicit-retry',
    role: 'user',
    content: recoveryScenario.retryPrompt,
  });
  await reader.runAgent();
  const retriedRead = server.receipts().at(-1);
  assert.equal(retriedRead.status, 'complete');
  assert.equal(retriedRead.retryOf, failedRead.id);
  assert.equal(retriedRead.tools.length, 1);
  assert.equal(retriedRead.tools[0].canonicalId, 'read-sorted-retry');
  assert.notEqual(retriedRead.tools[0].nativeId, failedRead.tools[1].nativeId);
  assert.deepEqual(
    reader.messages.find((message) => message.id === prefix.id),
    prefix
  );
  assert.equal(retriedRead.promptHash, retriedRead.expectedPromptHash);
  console.log(
    JSON.stringify({
      scenario: 'partial-failure',
      nativeClient: '@ag-ui/client',
      explicitRetry: true,
      retainedPrefix: true,
    })
  );
} finally {
  await server.close();
}
