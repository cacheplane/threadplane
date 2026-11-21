import { test, expect, type Page } from '@playwright/test';
import { openDemo, waitForFinalAssistant } from './test-helpers';

// Distinctive child-research sentence the subagent's final answer streams. It
// must be unique enough that finding it in the parent's assistant bubble is a
// real leak, not a coincidental substring of the orchestrator's final answer
// (which deliberately paraphrases instead of quoting this verbatim).
const CHILD_SENTENCE = 'foundation for zoneless Angular';

interface SubagentProbe {
  size: number;
  entries: {
    name?: string;
    status?: string;
    messageCount: number;
    messageTexts: string[];
    toolCalls: { name?: string; result?: string }[];
  }[];
}

// Reads the live `agent.subagents()` projection off the shell component via
// Angular's dev-mode global. The chat-tool-calls primitive renders a durable
// <chat-subagent-card> for each delegation tool call, and the card binds the
// ORDERED transcript: `messages()` (the assistant turn(s) the child streamed,
// each carrying `toolCallIds`/reasoning) and `toolCalls()` (the child's own
// `lookup` calls, rendered as <chat-tool-call-card>). We read the projected list
// directly rather than scraping the rendered card: it IS the data the card
// renders, and asserting on it proves the SUBAGENT_* + subagentRunId-attributed
// event stream reconstructed the full reason→tool→answer transcript and
// settled to `complete`, independent of card layout.
async function readSubagents(page: Page): Promise<SubagentProbe> {
  return page.evaluate(() => {
    const ng = (window as unknown as { ng?: { getComponent?: (el: Element) => unknown } }).ng;
    const el = document.querySelector('ag-ui-shell');
    const out: SubagentProbe = { size: 0, entries: [] };
    if (!ng?.getComponent || !el) return out;
    // `agent.subagents()` is a plain list of child agents: `status`,
    // `messages` and `toolCalls` are data, not signals.
    const cmp = ng.getComponent(el) as {
      agent?: {
        subagents?: () =>
          | readonly {
              name?: string;
              status?: string;
              messages?: readonly { content?: string }[];
              toolCalls?: readonly { name?: string; result?: string }[];
            }[]
          | undefined;
      };
    };
    const list = cmp?.agent?.subagents?.();
    if (!list) return out;
    out.size = list.length;
    for (const sa of list) {
      const messages = sa.messages ?? [];
      const toolCalls = sa.toolCalls ?? [];
      out.entries.push({
        name: sa.name,
        status: sa.status,
        messageCount: messages.length,
        messageTexts: messages.map((m) => (typeof m.content === 'string' ? m.content : '')),
        toolCalls: toolCalls.map((tc) => ({ name: tc.name, result: tc.result })),
      });
    }
    return out;
  });
}

// Research delegation over the AG-UI transport: the parent LLM calls the
// `research` tool, the langgraph child subgraph runs a genuine reason → tool →
// answer loop (an LLM call that returns a `lookup` tool_call, the offline
// `lookup` tool, then a second plain LLM call that writes the summary), and the
// AG-UI server's SubagentEmittingAgent expands the subagent_activity CUSTOM
// events into the protocol's SUBAGENT_STARTED/FINISHED plus subagentRunId-
// attributed TEXT_MESSAGE_* / TOOL_CALL_* events. The @threadplane/ag-ui
// session projects them to agent.subagents() (the ordered transcript
// chat-subagent-card renders) and the child's research text must stay OUT of
// the parent's bubble.
test('research delegation reconstructs the multi-message subagent transcript', async ({
  page,
}) => {
  await openDemo(page);

  const input = page.getByRole('textbox', { name: /message|prompt/i });
  await input.fill('Research Angular signals and summarize');
  await page.getByRole('button', { name: /send/i }).click();

  // The orchestrator dispatched the research subagent. A delegation tool call
  // renders as a durable <chat-subagent-card> (the full child transcript)
  // anchored to that call — it supersedes a bare tool-call card for the turn
  // (see the chat-tool-calls grouping: a call with a matching subagent is its
  // own subagent group). The card binds the subagent name verbatim, so it is a
  // stable DOM signal to wait on.
  const researchCard = page
    .locator('chat-subagent-card')
    .filter({ hasText: /research/i });
  await expect(researchCard.first()).toBeVisible({ timeout: 30_000 });

  // Wait for the parent turn to finalize so the full run (delegation + child
  // reason/tool/answer loop + settle) has played out.
  const bubble = await waitForFinalAssistant(page);

  // The live subagent-card data path populated and settled: agent.subagents()
  // carries the research subagent, now `complete`. Poll until it reaches
  // `complete` to avoid CI micro-races where signal propagation hasn't settled
  // at the moment of the first read.
  await expect
    .poll(
      async () => {
        const subs = await readSubagents(page);
        const research = subs.entries.find((e) => e.name === 'research');
        return research?.status ?? null;
      },
      { timeout: 15_000 }
    )
    .toBe('complete');

  const subs = await readSubagents(page);
  expect(subs.size).toBeGreaterThan(0);
  const research = subs.entries.find((e) => e.name === 'research');
  expect(research, 'a research subagent should be projected').toBeTruthy();

  // Transcript shape: the reason→tool→answer loop produces at least TWO
  // assistant turns — the tool-calling turn (which carries the `lookup`
  // tool_call) and the final answer turn. This is the ordered transcript the
  // <chat-subagent-card> renders one `.sac__msg` per message.
  expect(
    research!.messageCount,
    'subagent transcript should surface the tool-call turn plus the answer turn'
  ).toBeGreaterThanOrEqual(2);

  // At least one subagent tool call — the `lookup` call the child made — is
  // projected with its name and (offline, canned) result. This is what each
  // <chat-tool-call-card> inside the subagent card binds to.
  expect(
    research!.toolCalls.length,
    'subagent should surface its lookup tool call'
  ).toBeGreaterThanOrEqual(1);
  const lookup = research!.toolCalls.find((tc) => tc.name === 'lookup');
  expect(lookup, 'the lookup tool call should be projected by name').toBeTruthy();
  expect(lookup!.result, 'the lookup tool call should carry its canned result').toContain(
    'reactivity primitive'
  );

  // The streamed final answer is part of the transcript.
  expect(research!.messageTexts.join('\n')).toContain(CHILD_SENTENCE);

  // The child research text must NOT leak into the parent's rendered markdown
  // surface. Target chat-streaming-md (the assistant's answer) rather than the
  // whole chat-message, which nests the per-message subagent card host.
  const mainMarkdown = bubble.locator('chat-streaming-md').first();
  await expect(mainMarkdown).toBeVisible();
  await expect(mainMarkdown).not.toContainText(CHILD_SENTENCE);
});
