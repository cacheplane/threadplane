# React Time Travel preview

This bounded native React preview uses the existing Time Travel assistant and
the private candidate LangGraph adapter. It creates one confirmed conversation
lazily and never retries an ambiguous execution request.

Refresh reads a saved checkpoint page through a separate disposable session on
the same thread. Selection only highlights an eligible completed root reference;
it does not load a transcript or change Send's routing. Fork uses the visible
message draft and the primary session's exact completed-source preflight. Later
Send continues the primary session's retained confirmed fork position.

The graph publishes the canonical message IDs and final human/answer IDs. The
preview verifies those IDs against the adopted source history and current turn,
excluding later-tip turns and transient streamed chunks. Unknown outcomes,
unsupported tools or pauses require New; there is no replay or recovery control.

The HTTP/SSE fixture is local verification infrastructure and is never included
in public assembled assets. This example does not extend the public SDK API.
