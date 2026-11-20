# LangGraph Subgraphs (Angular)

This capability demonstrates LangGraph subgraph composition — a compiled child
graph added to a parent graph as a plain node — rendered with the
`@threadplane/chat` Angular component library.

The parent orchestrator routes conditionally: requests that need a factual
deep dive enter the `research` child graph first, everything else answers
directly. The child graph's state has no `messages` key, so it exchanges only
`research_topic` and `research_brief` with the parent and never touches the
transcript.

The sidebar shows the child from two angles. `agent.state()` reads the parent
graph's own state — watching the shared keys is watching the boundary itself.
`agent.subagents()` shows the child as a stream: plain subgraph nodes appear
in that list named by node, and settle with the run (tool-dispatched children
also carry their `toolCallId` — see the Chat Subagents capability for that
shape).

Key components used: `<chat>`. Child tokens stay on the child's stream and
never merge into the transcript; `createSession({ transcriptNodeNames:
['answer'] })` additionally keeps the top-level router node's output out of
the chat.
