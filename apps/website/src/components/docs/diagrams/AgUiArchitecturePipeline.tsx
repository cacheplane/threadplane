import { NetworkDiagram } from './NetworkDiagram';
import { agUiArchitecture } from './ag-ui-diagrams';

/** The injected Agent and the request/event boundaries of the AG-UI session behind it. */
export function AgUiArchitecturePipeline() {
  return <NetworkDiagram definition={agUiArchitecture} />;
}
