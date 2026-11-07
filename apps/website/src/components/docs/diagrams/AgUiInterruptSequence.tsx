import { NetworkDiagram } from './NetworkDiagram';
import { agUiInterrupts } from './ag-ui-diagrams';

export function AgUiInterruptSequence() {
  return <NetworkDiagram definition={agUiInterrupts} />;
}
