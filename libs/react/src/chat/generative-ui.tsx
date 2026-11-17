'use client';
import {
  Component,
  useCallback,
  useMemo,
  useRef,
  type ComponentType,
  type ReactNode,
} from 'react';
import { createJson, type JsonNode } from '@threadplane/content/json';
import { createRenderState } from '@threadplane/content/render-state';
import type { MessageRow } from '@threadplane/content/messages';
import {
  RenderSpec,
  type ReactRenderFunctions,
  type ReactRenderHandlers,
  type ReactRenderRegistry,
  type RenderElementData,
  type RenderEvent,
  type RenderSpecData,
  type RenderSpecProps,
  type RenderStore,
  type RenderViewProps,
} from '../render/index.js';
import { GenerativeUiSkeleton } from './genui-skeleton.js';

/** A2UI content carried by one assistant message, handed to `MessageGenerativeUi.renderA2ui`. */
export interface MessageA2uiContent {
  readonly messageId: string;
  /**
   * The message content after its `---a2ui_JSON---` marker: newline-delimited
   * A2UI envelopes. While the message streams it grows, and its last line may
   * be incomplete.
   */
  readonly source: string;
  /** True while the message is still streaming. */
  readonly streaming: boolean;
  /** The transcript's "Building UI…" placeholder, to show until a surface is ready. */
  readonly skeleton: ReactNode;
}

/** Something that happened in one message's spec tree, handed to `MessageGenerativeUi.onRenderEvent`. */
export interface MessageRenderEvent {
  readonly messageId: string;
  /** An action that ran, a state write, or a value a view reported; see `RenderEvent`. */
  readonly event: RenderEvent;
}

/**
 * Turns on generated UI inside the transcript. Each part is separate: an
 * assistant message is rendered as a surface only for the kinds configured
 * here, and every other message keeps its Markdown.
 */
export interface MessageGenerativeUi {
  /**
   * Views by component name. With it, an assistant message whose content is a
   * json-render spec (`{ "root": …, "elements": … }`) renders as that tree in
   * place of its text. Elements appear as each one finishes streaming, and a
   * placeholder stands in until the root element has. The tree is read-only
   * unless `handlers`, `store` or `onRenderEvent` is set.
   */
  readonly registry?: ReactRenderRegistry;
  /** Computed functions for spec props; see `RenderSpecProps.functions`. */
  readonly functions?: ReactRenderFunctions;
  /** Rendered for a spec component the registry lacks; see `RenderSpecProps.fallback`. */
  readonly fallback?: ComponentType<RenderViewProps>;
  /**
   * Actions a spec's `on` bindings may run; see `RenderSpecProps.handlers`. A
   * binding that names an action missing here does nothing. Setting this
   * makes spec trees interactive: views get `emit`, and `set` to write state.
   */
  readonly handlers?: ReactRenderHandlers;
  /**
   * One state owner shared by every spec in the transcript, in place of each
   * spec's own `state`. Without it, an interactive spec keeps state of its
   * own, seeded from its `state` and dropped with its row.
   */
  readonly store?: RenderStore;
  /** Notified when a spec's action runs, its state changes, or a view reports a result. */
  readonly onRenderEvent?: (event: MessageRenderEvent) => void;
  /**
   * Renders an assistant message whose content starts with the
   * `---a2ui_JSON---` marker, in place of its text. The application parses
   * the envelopes, accumulates the surfaces and renders them, for example
   * with `A2uiSurface`; return `content.skeleton` until one is ready.
   */
  readonly renderA2ui?: (content: MessageA2uiContent) => ReactNode;
  /** Placeholder text while a surface is being built. Defaults to "Building UI…". */
  readonly skeletonLabel?: string;
}

const A2UI_MARKER = '---a2ui_JSON---';

/** What an assistant message's content carries, judged from how it starts. */
type ContentKind =
  | { readonly kind: 'text' }
  /** The start of the A2UI marker, not yet long enough to tell. */
  | { readonly kind: 'undecided' }
  | { readonly kind: 'spec' }
  | { readonly kind: 'a2ui'; readonly source: string };

const TEXT: ContentKind = { kind: 'text' };

function contentKind(content: string): ContentKind {
  const start = content.search(/\S/);
  if (start === -1) return TEXT;
  if (content[start] === '{') return { kind: 'spec' };
  if (content.startsWith(A2UI_MARKER, start))
    return { kind: 'a2ui', source: content.slice(start + A2UI_MARKER.length) };
  return A2UI_MARKER.startsWith(content.slice(start))
    ? { kind: 'undecided' }
    : TEXT;
}

/** @internal True when this row's content is shown as a surface, so it has no text of its own to act on. */
export function carriesGenerativeUi(
  row: MessageRow,
  options: MessageGenerativeUi | undefined
): boolean {
  if (options === undefined || row.role !== 'assistant') return false;
  const { kind } = contentKind(row.message.content);
  return (
    (kind === 'spec' && options.registry !== undefined) ||
    (kind === 'a2ui' && options.renderA2ui !== undefined)
  );
}

type SpecState = NonNullable<RenderSpecProps['state']>;
const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A prop the example schemas write as `{ statePath }` is a state binding. */
function props(value: unknown): Record<string, unknown> {
  if (!record(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([name, prop]) => [
      name,
      record(prop) &&
      typeof prop['statePath'] === 'string' &&
      Object.keys(prop).length === 1
        ? { $bindState: prop['statePath'] }
        : prop,
    ])
  );
}

/**
 * The renderable part of a spec that may still be streaming: the elements
 * whose JSON is finished, once the root key and the root element are. A child
 * that has not arrived yet is simply absent, and renders nothing.
 */
function renderable(
  root: JsonNode | null
): { readonly spec: RenderSpecData; readonly state?: SpecState } | null {
  if (root?.kind !== 'object') return null;
  const key = root.children['root'];
  const nodes = root.children['elements'];
  if (
    key?.kind !== 'string' ||
    key.status !== 'complete' ||
    key.value === undefined ||
    nodes?.kind !== 'object'
  )
    return null;
  const elements: Record<string, RenderElementData> = Object.create(null);
  for (const [id, node] of Object.entries(nodes.children)) {
    if (node.kind !== 'object' || node.status !== 'complete') continue;
    const { type, children, visible, repeat, on } = node.value;
    if (typeof type !== 'string') continue;
    elements[id] = {
      type,
      props: props(node.value['props']),
      children: Array.isArray(children)
        ? [...new Set(children.filter((child) => typeof child === 'string'))]
        : [],
      ...(visible === undefined ? {} : { visible }),
      ...(record(repeat) && typeof repeat['statePath'] === 'string'
        ? { repeat }
        : {}),
      ...(record(on) ? { on } : {}),
    } as RenderElementData;
  }
  if (!Object.hasOwn(elements, key.value)) return null;
  const state = root.children['state'];
  return {
    spec: { root: key.value, elements },
    ...(state?.kind === 'object' && state.status === 'complete'
      ? { state: state.value as SpecState }
      : {}),
  };
}

/** Content from the agent must not take the transcript down: a surface that throws gives way to `fallback`. */
class SurfaceBoundary extends Component<
  {
    readonly source: string;
    readonly fallback: ReactNode;
    readonly children: ReactNode;
  },
  { readonly failed: boolean; readonly source: string }
> {
  override state = { failed: false, source: this.props.source };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  /** New content gets a new attempt. */
  static getDerivedStateFromProps(
    next: { readonly source: string },
    state: { readonly source: string }
  ) {
    return next.source === state.source
      ? null
      : { failed: false, source: next.source };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function SpecSurface({
  row,
  options,
  skeleton,
  text,
}: {
  readonly row: MessageRow;
  readonly options: MessageGenerativeUi & {
    readonly registry: ReactRenderRegistry;
  };
  readonly skeleton: ReactNode;
  readonly text: ReactNode;
}) {
  const { content, delivery } = row.message;
  const streaming = delivery.phase === 'streaming';
  // Parsed again per change: a spec is small, and the row re-renders only when it changes.
  const tree = useMemo(() => {
    const json = createJson({
      generation: delivery.generation,
      phase: delivery.phase,
      content,
    });
    const { root } = json.getSnapshot();
    json.dispose();
    return renderable(root);
  }, [content, delivery.generation, delivery.phase]);
  const { handlers, onRenderEvent } = options;
  const interactive =
    handlers !== undefined ||
    options.store !== undefined ||
    onRenderEvent !== undefined;
  // A spec's own state arrives once, when its `state` object finishes.
  const seed = tree?.state;
  const seeded = seed !== undefined;
  const own = useRef<{ readonly seeded: boolean; readonly store: RenderStore }>(
    undefined
  );
  let store = options.store;
  if (interactive && store === undefined) {
    if (own.current?.seeded !== seeded)
      own.current = { seeded, store: createRenderState(seed) };
    store = own.current.store;
  }
  const messageId = row.message.id;
  const onEvent = useCallback(
    (event: RenderEvent) => onRenderEvent?.({ messageId, event }),
    [onRenderEvent, messageId]
  );
  // Finished content that is not a spec after all is ordinary text.
  if (tree === null) return streaming ? skeleton : text;
  const shared = {
    spec: tree.spec,
    registry: options.registry,
    functions: options.functions,
    fallback: options.fallback,
    loading: streaming,
  };
  return (
    <div
      className="tp-chat-generative-ui"
      data-kind="spec"
      data-streaming={String(streaming)}
    >
      {store === undefined ? (
        <RenderSpec {...shared} state={tree.state} />
      ) : (
        <RenderSpec
          {...shared}
          store={store}
          handlers={handlers}
          onEvent={onRenderEvent === undefined ? undefined : onEvent}
        />
      )}
    </div>
  );
}

function A2uiContent({
  content,
  render,
}: {
  readonly content: MessageA2uiContent;
  readonly render: NonNullable<MessageGenerativeUi['renderA2ui']>;
}) {
  return <>{render(content)}</>;
}

/**
 * @internal The body of one assistant row: its generated UI when `options`
 * covers what the content carries, otherwise `text`, the row's Markdown.
 */
export function GenerativeUiContent({
  row,
  options,
  text,
}: {
  readonly row: MessageRow;
  readonly options: MessageGenerativeUi;
  readonly text: ReactNode;
}) {
  const { content, delivery } = row.message;
  const streaming = delivery.phase === 'streaming';
  const found = contentKind(content);
  const skeleton = (
    <div className="tp-chat-generative-ui" data-kind="skeleton">
      <GenerativeUiSkeleton label={options.skeletonLabel} />
    </div>
  );
  // A surface that failed while streaming may still recover with more content.
  const fallback = streaming ? skeleton : text;
  if (found.kind === 'spec' && options.registry !== undefined)
    return (
      <SurfaceBoundary source={content} fallback={fallback}>
        <SpecSurface
          row={row}
          options={{ ...options, registry: options.registry }}
          skeleton={skeleton}
          text={text}
        />
      </SurfaceBoundary>
    );
  if (options.renderA2ui === undefined) return text;
  // Half a marker is not text to show; it settles within a few characters.
  if (found.kind === 'undecided' && streaming) return null;
  if (found.kind !== 'a2ui') return text;
  return (
    <SurfaceBoundary source={content} fallback={fallback}>
      <div
        className="tp-chat-generative-ui"
        data-kind="a2ui"
        data-streaming={String(streaming)}
      >
        <A2uiContent
          render={options.renderA2ui}
          content={{
            messageId: row.message.id,
            source: found.source,
            streaming,
            skeleton: <GenerativeUiSkeleton label={options.skeletonLabel} />,
          }}
        />
      </div>
    </SurfaceBoundary>
  );
}
