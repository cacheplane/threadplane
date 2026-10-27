# React Deployment Runtime preview

This bounded native React preview uses the existing Deployment Runtime assistant
through the same runtime bridge as the Angular example. The shared runtime uses
the same-origin proxy. An authored developer target supplies its URL and headers
privately; the UI shows only the runtime category and fixed assistant key.

The private candidate adapter creates a confirmed conversation lazily, with no
automatic retry. A successful reply must identify the entire canonical history
and exact current human/answer pair before another message is allowed. Transient
streamed chunks do not become duplicate completed replies. Unknown outcomes,
errors, pauses, tools, or Stop require a new conversation; there is no replay,
reconnect, history restoration, or recovery control.

The local HTTP/SSE verification fixture is not included in public assembled
assets. This example does not extend the public SDK API or create a deployment.
