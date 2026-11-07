import { DiagramFrame } from './DiagramFrame';
import { DiagramNode } from './DiagramNode';
import { DiagramEdge } from './DiagramEdge';
import { DiagramPill } from './DiagramPill';

const SLUG = 'telemetry-how-it-fits';

/**
 * `@threadplane/telemetry` has two peer entry points (`./browser`,
 * `./node` — verified against `libs/telemetry/package.json` `exports`); the
 * browser entry deliberately cannot import the package root (ng-packagr's
 * rootDir rule forces it to inline shared helpers — see the comment atop
 * `libs/telemetry/src/browser/service.ts`), so there is no root-fans-out-to
 * hierarchy to draw. What the two entries share is a destination story:
 * - Browser (`libs/telemetry/src/browser/service.ts`) never has a default
 *   network target. It delivers only through an app-supplied `sink`,
 *   `endpoint`, or `posthogKey` — otherwise `capture()` is a no-op.
 * - Node (`libs/telemetry/src/node/client.ts`) defaults to
 *   `DEFAULT_INGEST` (`https://threadplane.ai/api/ingest`), overridable via
 *   `TPLANE_TELEMETRY_INGEST_URL`.
 * Both entries sample (browser via `config.sampleRate`, node via
 * `TPLANE_TELEMETRY_SAMPLE_RATE`), so sampling is not a node-only trait —
 * the branch pills are labeled by destination, not by sampling. Each branch
 * breaks around its pill (segment, pill, segment+arrow) rather than drawing
 * a continuous line under the label.
 */
export function TelemetryHowItFits() {
  return (
    <DiagramFrame
      title="Where browser and server events go"
      slug={SLUG}
      viewWidth={640}
      viewHeight={238}
      label="How @threadplane/telemetry fits: the package's browser entry delivers events to an app-owned sink or endpoint, and its node entry delivers events by default to threadplane.ai/api/ingest."
    >
      <DiagramNode
        x={170}
        y={16}
        w={300}
        h={64}
        eyebrow="Package"
        title="@threadplane/telemetry"
        meta="entry points: ./browser · ./node"
        tone="accent"
      />
      <DiagramEdge d="M320 80 V100" slug={SLUG} />
      <DiagramEdge d="M320 100 H180 V118" slug={SLUG} />
      <DiagramEdge d="M320 100 H460 V118" slug={SLUG} />
      <DiagramPill cx={180} cy={130} w={110} label="browser events" />
      <DiagramPill cx={460} cy={130} w={110} label="node events" />
      <DiagramEdge d="M180 142 V174" slug={SLUG} arrow />
      <DiagramEdge d="M460 142 V174" slug={SLUG} arrow />
      <DiagramNode
        x={50}
        y={178}
        w={260}
        h={44}
        title="Your sink or endpoint — app-owned"
        align="middle"
        titleStyle="sans"
        tone="dim"
      />
      <DiagramNode
        x={330}
        y={178}
        w={260}
        h={44}
        title="threadplane.ai/api/ingest — default"
        align="middle"
        titleStyle="sans"
        tone="dim"
      />
    </DiagramFrame>
  );
}
