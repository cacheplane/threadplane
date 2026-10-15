import type {
  ChatDebugProps,
  DebugCheckpointPage,
  DebugCurrentObservation,
  DebugInspection,
  DebugSelection,
} from './types';
const selection: DebugSelection = {
  contextKey: 'owner',
  pageGeneration: 2,
  rowKey: 'opaque',
};
const page: DebugCheckpointPage = {
  contextKey: 'owner',
  pageGeneration: 2,
  rows: [{ rowKey: 'opaque', label: 'Checkpoint', inspectable: true }],
  truncated: false,
};
const ready: DebugInspection = { status: 'ready', selection, values: {} };
const error: DebugInspection = {
  status: 'error',
  selection,
  message: 'Read failed',
};
const current: DebugCurrentObservation = {
  contextKey: 'owner',
  status: 'unknown',
};
const props: ChatDebugProps = {
  contextKey: 'owner',
  current,
  checkpointPage: page,
  selection,
  inspection: ready,
  onInspect: (token) => {
    const key: string = token.rowKey;
    void key;
  },
  onRefresh: (token) => {
    const generation: number | null = token.pageGeneration;
    void generation;
  },
};
// @ts-expect-error The full selection tuple is required for ready results.
const missingReady: DebugInspection = { status: 'ready', values: {} };
// @ts-expect-error Errors are also keyed.
const missingError: DebugInspection = { status: 'error', message: 'Oops' };
// @ts-expect-error Observed values are required; missing is not empty.
const missingValues: DebugCurrentObservation = {
  contextKey: 'owner',
  status: 'ready',
};
// @ts-expect-error DTOs are readonly.
selection.rowKey = 'changed';
// @ts-expect-error Rows are readonly.
page.rows.push({ rowKey: 'new', label: 'New', inspectable: false });
const sdkPage: DebugCheckpointPage = {
  ...page,
  // @ts-expect-error No SDK checkpoint objects in display metadata.
  rows: [{ rowKey: 'x', label: 'x', inspectable: true, checkpoint: {} }],
};
// @ts-expect-error No session capability.
const session: ChatDebugProps = { ...props, session: {} };
// @ts-expect-error No execution capability.
const submit: ChatDebugProps = { ...props, submit: () => undefined };
// @ts-expect-error No lifetime capability.
const dispose: ChatDebugProps = { ...props, dispose: () => undefined };
// @ts-expect-error No stop capability.
const stop: ChatDebugProps = { ...props, stop: () => undefined };
// @ts-expect-error No fork capability.
const fork: ChatDebugProps = { ...props, fork: () => undefined };
const reader: ChatDebugProps = {
  ...props,
  // @ts-expect-error Requests cannot be promise-returning readers.
  onInspect: async () => ({ values: {} }),
};
const refreshReader: ChatDebugProps = {
  ...props,
  // @ts-expect-error Refresh is a notification, not an async reader.
  onRefresh: async () => undefined,
};
const sdkValue: DebugInspection = {
  status: 'ready',
  selection,
  // @ts-expect-error Values must be plain JSON, not runtime objects.
  values: new Date(),
};
void [
  error,
  missingReady,
  missingError,
  missingValues,
  sdkPage,
  session,
  submit,
  dispose,
  stop,
  fork,
  reader,
  refreshReader,
  sdkValue,
];

import { ChatDebug } from './index';
const panel = <ChatDebug {...props} />;
// @ts-expect-error Passive panel has no session prop.
const badPanel = <ChatDebug {...props} session={{}} />;
void [panel, badPanel];
