import {
  ScrollBubble,
  type ScrollBubbleMode,
  type ScrollBubbleProps,
} from './index';
const props: ScrollBubbleProps = { mode: 'idle', onClick: () => undefined };
<ScrollBubble {...props} />;
// @ts-expect-error Required action.
<ScrollBubble mode="idle" />;
// @ts-expect-error Required mode.
<ScrollBubble onClick={() => undefined} />;
// @ts-expect-error Closed mode.
const mode: ScrollBubbleMode = 'running';
// @ts-expect-error Readonly mode.
props.mode = 'streaming';
// @ts-expect-error Readonly handler.
props.onClick = () => undefined;
// @ts-expect-error Readonly disabled.
props.disabled = true;
// @ts-expect-error Readonly label.
props.label = 'x';
// @ts-expect-error Readonly class.
props.className = 'x';
// @ts-expect-error No event payload.
<ScrollBubble mode="idle" onClick={(event: MouseEvent) => void event} />;
// @ts-expect-error No execution owner.
<ScrollBubble {...props} session={{}} />;
void mode;
