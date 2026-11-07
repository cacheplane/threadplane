import type { Json, Observation, Recording } from './playback';

export interface SourceRange {
  readonly start: number;
  readonly end: number;
}
export interface LearningSource {
  readonly revision: string;
  readonly files: readonly {
    readonly path: string;
    readonly source: string;
    readonly highlights: readonly SourceRange[];
  }[];
  readonly snippet: SourceRange & {
    readonly path: string;
    readonly code: string;
  };
}
export type LearningMoment = 'message' | 'request' | 'partial' | 'complete';
export interface LearningMilestone {
  readonly id: LearningMoment;
  readonly label: string;
  readonly index: number;
}

export function sourceHref(
  revision: string,
  path: string,
  range?: SourceRange
) {
  return `https://github.com/cacheplane/threadplane/blob/${revision}/${path}${
    range ? `#L${range.start}-L${range.end}` : ''
  }`;
}

function fields(state: Json): { readonly [key: string]: Json } {
  if (state === null || typeof state !== 'object' || Array.isArray(state))
    return {};
  const record = state as { readonly [key: string]: Json };
  const application = record['application'];
  return application &&
    typeof application === 'object' &&
    !Array.isArray(application)
    ? (application as { readonly [key: string]: Json })
    : record;
}

/** Moments are derived from observed evidence; settlement alone is not success. */
export function learningMilestones(recording: Recording): LearningMilestone[] {
  const frames = recording.frames;
  const isUser = (message: Observation['messages'][number]) =>
    message.role === 'user' || message.role === 'human';
  // Existing rows in the first retained snapshot establish history, not actions.
  const knownUsers = new Set(
    frames[0]?.messages.filter(isUser).map((item) => item.id)
  );
  let message = -1;
  let userId: string | undefined;
  let userObserved = -1;
  let end = frames.length;
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index];
    const addedUser =
      index > 0
        ? frame.messages.find(
            (item) => isUser(item) && !knownUsers.has(item.id)
          )
        : undefined;
    if (message < 0 && (addedUser || frame.event.type === 'call-started'))
      message = index;
    else if (message >= 0 && frame.event.type === 'call-started') {
      end = index;
      break;
    }
    if (message >= 0 && addedUser) {
      if (userId && addedUser.id !== userId) {
        end = index;
        break;
      }
      userId = addedUser.id;
      userObserved = index;
    }
    frame.messages.filter(isUser).forEach((item) => knownUsers.add(item.id));
  }
  if (message < 0) return [];
  const inTurn = (index: number) => index >= message && index < end;
  const hasReply = (frame: Observation) => {
    const userIndex = frame.messages.findIndex((item) => item.id === userId);
    return (
      userIndex >= 0 &&
      frame.messages
        .slice(userIndex + 1)
        .some((item) => item.role === 'assistant' && item.text.length > 0)
    );
  };
  const request = frames.findIndex(
    (frame, index) =>
      inTurn(index) &&
      (frame.event.type === 'call-started' ||
        (frame.event.type === 'http.request' &&
          frame.requests.some((item) => item.path.endsWith('/runs/stream'))))
  );
  const partial = frames.findIndex(
    (frame, index) =>
      inTurn(index) &&
      index >= userObserved &&
      fields(frame.state)['busy'] === true &&
      hasReply(frame)
  );
  const complete = frames.findIndex(
    (frame, index) =>
      inTurn(index) &&
      index >= userObserved &&
      hasReply(frame) &&
      fields(frame.state)['busy'] === false &&
      fields(frame.state)['outcome'] === 'success'
  );
  return (
    [
      { id: 'message', label: 'Message submitted', index: message },
      { id: 'request', label: 'Request started', index: request },
      { id: 'partial', label: 'Partial response', index: partial },
      { id: 'complete', label: 'Turn completed', index: complete },
    ] as LearningMilestone[]
  ).filter((item) => item.index >= 0);
}
