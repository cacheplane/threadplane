# Native React Filesystem

Run `npx nx e2e cockpit-deep-agents-filesystem-react` for the local compiled-graph fixture, or build with `npx nx build cockpit-deep-agents-filesystem-react`. The native session uses assistant `da-filesystem` through the existing runtime bridge. Initial mount, New conversation and the KASE suggestion are inert; only Send creates a conversation.

The read-only workspace displays actual file text. Live observations are distinct from saved or paused-confirmed checkpoint files. Proposed writes, edits and deletes are shown separately without applying them locally. Approve or Reject sends the complete ordered batch after checking the current owned root checkpoint. Unsupported proposals cannot resume.

Stop, New and disposal invalidate pending callbacks. Cancellation does not roll back backend execution. Unconfirmed requests retain the last confirmed workspace and require New. Local proof transport buffers the real unchanged compiled graph before delivery; it patches only model construction and forbids outbound sockets. Fixture and test sources are excluded from shipped assets.
