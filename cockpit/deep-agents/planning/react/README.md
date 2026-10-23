# Deep Agents Planning · React

Native React chat with a read-only projection of the existing `da-planning`
graph's `todos`. The KSFO-to-KASE dispatch suggestion fills the draft; only Send
creates a conversation. Aviation lookups use fixed example data.

The full ordered list is replaced when valid root values arrive, including an
explicit empty list. Duplicate rows keep their positions. The display accepts
at most 50 items and 2000 UTF-16 code units per item with the middleware's three
statuses. Unsupported updates show a notice and retain the prior valid display.

Live observation and last saved authority are separate. A saved plan requires
native submit outcome `success`, the current native authored human, canonical
history parity, exact owned root checkpoint state with no pending execution,
and authoritative raw `write_todos` result status and arguments. A core tool
status `complete` means its result arrived; it does not prove the write applied.
The exact raw checkpoint read supplies both the candidate values and raw loaded
state; independent corroboration comes from native submit, messages, tool calls,
values, and history. No tool-result prose is parsed.

Response completion never completes unfinished todos. A saved `in_progress`
item records plan status; it does not imply continued execution. Stop retains
the last saved plan and requires New conversation. New clears the view without
creating a thread. Failed creation can retry. A first native response failure
before any checkpoint requires New; later unconfirmed checkpoint reads can
recover on a subsequent valid request, using the current canonical prefix and
the separately retained saved plan. A no-write response cannot borrow an
unconfirmed changed plan.

## Local verification

From the workspace root:

```sh
npx nx test cockpit-deep-agents-planning-react
npx nx lint cockpit-deep-agents-planning-react
npx nx build cockpit-deep-agents-planning-react
npx nx fixture-test cockpit-deep-agents-planning-react
npx nx e2e cockpit-deep-agents-planning-react
```

The loopback proof server runs on port 4628 at
`/deep-agents/planning/react/`. Its fixture executes the actual Python graph,
middleware, tools, and in-memory checkpointer with only model construction
controlled. It forbids remote socket connections and reports source hashes.
The graph buffers actual events before local SSE delivery: holding or stopping
delivery does **not** prove cancellation or rollback of a production graph.
Local transport fault/hold controls exist only in the proof fixture and are
never assembled into public server routes. Browser tests verify desktop/mobile,
keyboard use, reduced motion, literal text, and horizontal overflow.
