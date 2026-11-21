# LangGraph Interrupts (Angular)

This capability demonstrates human-in-the-loop interrupt handling using LangGraph's `interrupt()` primitive and the `@threadplane/angular/chat` Angular component library. When the graph pauses at an interrupt node, `<chat-approval-card>` surfaces the pending decision to the user; their response is sent back to the graph with `agent.resume([{ interruptId, status: 'resolved', value }])`.

Key components used: `<chat>`, `<chat-approval-card>`. The approval card renders inside the chat host and becomes visible automatically whenever `agent.interrupts()` lists a pending interrupt.
