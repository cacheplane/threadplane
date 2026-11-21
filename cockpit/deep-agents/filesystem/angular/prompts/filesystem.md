# Deep Agents Filesystem (Angular)

This capability renders the agent's workspace, not a log of its file operations. `StateBackend` puts every file the agent writes on the graph state under `files`, keyed by absolute path, so the Angular sidebar is a projection of the live workspace: an edit that rewrites an existing file shows as one changed file rather than two log entries.

A `FilesystemPermission` in `interrupt` mode covers `/reports/**`, so a write there pauses the run and `<chat-interrupt-panel>` from `@threadplane/angular/chat` renders the approval. The pending path is read off the interrupt payload and shown in the tree as a ghost row before the file exists. Resuming takes `{ decisions: [{ type: 'approve' }] }`.
