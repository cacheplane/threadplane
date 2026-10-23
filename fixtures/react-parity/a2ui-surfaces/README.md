# Installed A2UI surface observation fixture

Run `node scripts/react-parity/verify-a2ui-surfaces.mjs --retain NEW_DIRECTORY` after building core, a2ui, content, react and angular.

The fixture installs exactly those five local tarballs with the fixed root-lock-derived external closure. An Angular AOT application displays raw immutable surface snapshots through the installed `observeAgent`; its explicitly selected development React build uses the installed `useAgent` and verifies actual StrictMode effect replay. Neither view owns application commands or disposal.

Caller controls stage, commit, update, delete and recreate a surface, replace the owner twice, update previous owners, remove and remount each view, and explicitly dispose all owners. Observer wrappers capture each actual owner and count independent registrations and cleanup handles while delegating every operation. Angular replacement destroys and re-creates its injection context.

This is backend-free text/data observation evidence. It does not implement catalog rendering, forms, actions or readiness UI. The verifier bounds browser requests to the owned loopback origin and closes the browser and server on success and failure. Retained output contains the isolated consumer, installation, source/input/output hashes and browser assertions; the normal mode removes its private temporary consumer.

The exported verifier accepts an optional `launch` function solely as the shared browser test/evidence seam. Independent verification can launch real Chromium, inspect its own process and temporary profile, and return that same browser; the normal verifier still owns awaited closure. CLI behavior uses actual Playwright Chromium by default.
