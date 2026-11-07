import { NetworkDiagram } from './NetworkDiagram';
import {
  checkpointHistory,
  renderEventFlow,
  toolViewFlow,
} from './teaching-flows';

export function ToolViewFlow() {
  return <NetworkDiagram definition={toolViewFlow} />;
}

export function RenderEventFlow() {
  return <NetworkDiagram definition={renderEventFlow} />;
}

export function CheckpointHistory() {
  return <NetworkDiagram definition={checkpointHistory} />;
}
