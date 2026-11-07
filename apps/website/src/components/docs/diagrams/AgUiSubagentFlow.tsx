import { NetworkDiagram } from './NetworkDiagram';
import { agUiSubagents } from './ag-ui-diagrams';

export function AgUiSubagentFlow() {
  return <NetworkDiagram definition={agUiSubagents} />;
}
