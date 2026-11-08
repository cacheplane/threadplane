import { DiagramFrame } from './DiagramFrame';
import { DiagramNode } from './DiagramNode';
import { DiagramEdge } from './DiagramEdge';

const SLUG = 'a2ui-flow';

/**
 * Vertical pipeline from a raw assistant message to a rendered surface: the
 * `---a2ui_JSON---` sentinel, the content classifier, the streaming
 * `@threadplane/a2ui` parser and surface store, then the `<a2ui-surface>`
 * render component.
 */
export function A2uiMessageFlow() {
  return (
    <DiagramFrame
      title="From an A2UI message to a rendered surface"
      slug={SLUG}
      viewWidth={640}
      viewHeight={428}
      label="A2UI message flow: an assistant message starting with the ---a2ui_JSON--- sentinel triggers the content classifier, which feeds createA2uiMessageParser to parse JSONL messages, createA2uiSurfaceStore to apply them by surface id, and the a2ui-surface component to render progressive state through your catalog."
    >
      <DiagramNode
        x={170} y={16} w={300} h={44}
        title="Assistant text starts with ---a2ui_JSON---"
        align="middle" titleStyle="sans" tone="dim"
      />
      <DiagramEdge d="M320 60 V80" slug={SLUG} arrow />
      <DiagramNode
        x={170} y={84} w={300} h={64}
        eyebrow="@threadplane/chat" title="Content classifier"
        meta="switches to A2UI mode"
        titleStyle="sans"
      />
      <DiagramEdge d="M320 148 V168" slug={SLUG} arrow />
      <DiagramNode
        x={170} y={172} w={300} h={64}
        eyebrow="@threadplane/a2ui" title="createA2uiMessageParser()"
        meta="parses JSONL messages"
        tone="accent"
      />
      <DiagramEdge d="M320 236 V256" slug={SLUG} arrow />
      <DiagramNode
        x={170} y={260} w={300} h={64}
        eyebrow="@threadplane/chat" title="createA2uiSurfaceStore()"
        meta="applies those messages by surface id"
      />
      <DiagramEdge d="M320 324 V344" slug={SLUG} arrow />
      <DiagramNode
        x={170} y={348} w={300} h={64}
        eyebrow="@threadplane/chat" title="<a2ui-surface>"
        meta="renders progressive state through your catalog"
      />
    </DiagramFrame>
  );
}
