import { NetworkDiagram } from './NetworkDiagram';
import { agUiArchitecture } from './ag-ui-diagrams';

/** The Agent contract and request/event boundaries of the Angular AG-UI adapter. */
export function AgUiArchitecturePipeline() {
  return <NetworkDiagram definition={agUiArchitecture} />;
}
