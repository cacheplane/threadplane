import { DiagramFrame } from './DiagramFrame';
import { DiagramNode } from './DiagramNode';
import { DiagramEdge } from './DiagramEdge';
import { DiagramPill } from './DiagramPill';

export type StackHighlight = 'none' | 'chat' | 'langgraph' | 'ag-ui' | 'runtimes' | 'contract';

interface StackDiagramProps {
  highlight?: StackHighlight;
  caption?: string;
  scale?: 'docs' | 'marketing';
}

/**
 * The canonical Threadplane stack: chat UI on top, the Agent contract as a
 * labeled seam, the two runtime adapters, and their backends. `highlight`
 * accents the node(s) a given page is about; `contract` accents both adapters.
 */
export function StackDiagram({ highlight = 'none', caption, scale = 'docs' }: StackDiagramProps) {
  const slug = `stack-${highlight}`;
  const adapters = highlight === 'contract';
  const backends = highlight === 'runtimes';
  return (
    <DiagramFrame
      slug={slug}
      viewWidth={640}
      viewHeight={344}
      scale={scale}
      label="Threadplane stack: the chat UI consumes the Agent contract; the LangGraph and AG-UI adapters implement it against their backends."
      caption={caption}
      description="Read from top to bottom. The Angular chat composition and its message-list and input primitives consume one Agent contract: signals plus events$. Two adapters implement that contract. @threadplane/langgraph connects to LangGraph Platform. @threadplane/ag-ui connects to AG-UI backends such as CrewAI, Mastra, Microsoft Agent Framework and AWS Strands. Changing the adapter does not require replacing the chat components."
    >
      <DiagramNode
        x={190}
        y={18}
        w={260}
        h={64}
        eyebrow="Chat UI"
        title="@threadplane/chat"
        meta="<chat> · <chat-message-list> · <chat-input>"
        tone={highlight === 'chat' ? 'accent' : 'neutral'}
      />
      <DiagramEdge d="M320 82 V120" slug={slug} arrow />
      <DiagramPill cx={320} cy={136} w={230} label="Agent contract · signals + events$" />
      <DiagramEdge d="M320 148 V178 H180 V200" slug={slug} arrow />
      <DiagramEdge d="M320 178 H460 V200" slug={slug} arrow />
      <DiagramNode
        x={60}
        y={204}
        w={240}
        h={52}
        eyebrow="Adapter"
        title="@threadplane/langgraph"
        tone={highlight === 'langgraph' || adapters ? 'accent' : 'neutral'}
      />
      <DiagramNode
        x={340}
        y={204}
        w={240}
        h={52}
        eyebrow="Adapter"
        title="@threadplane/ag-ui"
        tone={highlight === 'ag-ui' || adapters ? 'accent' : 'neutral'}
      />
      <DiagramEdge d="M180 256 V280" slug={slug} arrow />
      <DiagramEdge d="M460 256 V280" slug={slug} arrow />
      <DiagramNode
        x={60}
        y={284}
        w={240}
        h={40}
        title="LangGraph Platform"
        align="middle"
        titleStyle="sans"
        tone={backends ? 'accent' : 'dim'}
      />
      <DiagramNode
        x={340}
        y={284}
        w={240}
        h={40}
        title="CrewAI · Mastra · Agent Fwk · Strands · …"
        align="middle"
        titleStyle="sans"
        tone={backends ? 'accent' : 'dim'}
      />
    </DiagramFrame>
  );
}
