# Mastra reservations — React preview

Experimental private source-build preview of fictional campsite approval and decline. No real reservation is made. The isolated build installs the private native AG-UI candidate and the actual core, content and React artifacts; this does not claim a public npm release.

The preset fills the input only. First Send creates the local conversation UUID and a native session. A correlated native pause authorizes Approve or Decline. Compatibility notices alone are informational. Decisions use top-level native resume, with decline resolving `approved: false`; decline is distinct from native cancellation.

The conversation displays ordinary projected native text. Confirmed decisions show the exact observed backend tool-result JSON string separately. Assistant prose or transport completion alone cannot confirm a reservation. Missing terminal/result, unsupported pauses and errors require New; accepted decisions are never replayed. Stop and New revoke old controls, and New is available during active work. A replacement waits for owned cleanup before another Send.

Shared mode uses `/runtimes/mastra/agent`, served by the existing Mastra production proxy. A neutral configured AG-UI Developer target is supported. Endpoints and credentials are not displayed. This bounded preview does not implement packing lists, weather or child agents.

From the repository root:

```sh
npx nx test cockpit-runtimes-mastra-react --reporters=default
npx nx lint cockpit-runtimes-mastra-react
npx nx build cockpit-runtimes-mastra-react
npx nx e2e cockpit-runtimes-mastra-react
node --test fixtures/react-parity/native-mastra-react/*.spec.mjs scripts/react-cockpit/prepare-native-mastra-fixture.spec.mjs
node --test scripts/react-cockpit/runtimes-mastra-configuration.spec.mjs
```

Presentation units use a mocked application store. Policy and lifetime units exercise the real application with native-session doubles. The e2e target first installs the frozen Mastra service dependencies and builds the installed app. Its offline loopback Responses seam drives the unchanged real Mastra service and a fresh temporary LibSQL database. Browser evidence and cleanup receipts stay in ignored test-results. This proves local interoperability; it does not prove a public provider. Run service dependency preparation serially with other Mastra suites because npm ci mutates the shared service node_modules.
