import {
  learningMilestones,
  type LearningMilestone,
  type LearningMoment,
} from './learning-lesson';
import type { Json, Observation, Recording } from './playback';

export function observedFields(state: Json): Readonly<Record<string, Json>> {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return {};
  const record = state as Readonly<Record<string, Json>>;
  const application = record['application'];
  return application &&
    typeof application === 'object' &&
    !Array.isArray(application)
    ? (application as Readonly<Record<string, Json>>)
    : record;
}
const isUser = (message: Observation['messages'][number]) =>
  message.role === 'user' || message.role === 'human';

export interface GuidedLesson {
  readonly moments: readonly LearningMilestone[];
  readonly userIndex: number | undefined;
  readonly userId: string | undefined;
  readonly assistantId: string | undefined;
  readonly end: number;
}

/** Retained rows establish history. Only newly observed rows teach this turn. */
export function guidedLesson(recording: Recording): GuidedLesson {
  const frames = recording.frames;
  const milestones = learningMilestones(recording);
  const start = milestones.find((moment) => moment.id === 'message')?.index;
  const knownUsers = new Set(
    frames[0]?.messages.filter(isUser).map((message) => message.id)
  );
  let userIndex: number | undefined;
  let userId: string | undefined;
  let end = frames.length;
  if (start !== undefined) {
    for (let index = Math.max(1, start); index < frames.length; index++) {
      const frame = frames[index];
      if (index > start && frame.event.type === 'call-started') break;
      const user = frame.messages.find(
        (message) => isUser(message) && !knownUsers.has(message.id)
      );
      if (user) {
        userIndex = index;
        userId = user.id;
        break;
      }
      frame.messages
        .filter(isUser)
        .forEach((message) => knownUsers.add(message.id));
    }
  }
  if (userIndex === undefined)
    return {
      moments: milestones.filter((moment) => moment.id === 'request'),
      userIndex,
      userId,
      assistantId: undefined,
      end,
    };
  const usersAtStart = new Set(
    frames[userIndex].messages.filter(isUser).map((message) => message.id)
  );
  for (let index = userIndex + 1; index < frames.length; index++) {
    if (
      frames[index].event.type === 'call-started' ||
      frames[index].messages.some(
        (message) => isUser(message) && !usersAtStart.has(message.id)
      )
    ) {
      end = index;
      break;
    }
  }
  const knownAssistants = new Set(
    frames
      .slice(0, userIndex)
      .flatMap((frame) => frame.messages)
      .filter((message) => message.role === 'assistant')
      .map((message) => message.id)
  );
  let assistantId: string | undefined;
  let partial = -1;
  let complete = -1;
  for (let index = userIndex; index < end; index++) {
    const frame = frames[index];
    const userPosition = frame.messages.findIndex(
      (message) => message.id === userId
    );
    const reply =
      userPosition < 0
        ? undefined
        : frame.messages
            .slice(userPosition + 1)
            .find(
              (message) =>
                message.role === 'assistant' &&
                !knownAssistants.has(message.id) &&
                message.text.length > 0 &&
                (!assistantId || message.id === assistantId)
            );
    if (!reply) continue;
    if (partial < 0) {
      partial = index;
      assistantId = reply.id;
    }
    const fields = observedFields(frame.state);
    if (fields['busy'] === false && fields['outcome'] === 'success') {
      complete = index;
      break;
    }
  }
  const request = milestones.find((moment) => moment.id === 'request');
  const observedRequestIndex =
    request && request.index < userIndex
      ? observedFields(frames[userIndex].state)['busy'] === true
        ? userIndex
        : -1
      : request?.index ?? -1;
  // Late request capture stays inspectable, but cannot teach a stage before
  // a response that has already arrived.
  const requestIndex =
    partial >= 0 && observedRequestIndex > partial ? -1 : observedRequestIndex;
  const moments = [
    { id: 'message', label: 'Message submitted', index: userIndex },
    { id: 'request', label: 'Request started', index: requestIndex },
    { id: 'partial', label: 'Partial response', index: partial },
    { id: 'complete', label: 'Turn completed', index: complete },
  ] as LearningMilestone[];
  return {
    moments: moments.filter(
      (moment) => moment.index >= userIndex && moment.index < end
    ),
    userIndex,
    userId,
    assistantId,
    end,
  };
}

export function currentLessonMoment(
  lesson: GuidedLesson,
  cursor: number,
  selectedMoment: LearningMoment | null
): LearningMilestone | undefined {
  if (cursor < (lesson.userIndex ?? 0) || cursor >= lesson.end)
    return undefined;
  const selected = lesson.moments.find(
    (moment) => moment.id === selectedMoment && moment.index === cursor
  );
  return (
    selected ??
    lesson.moments.reduce<LearningMilestone | undefined>(
      (latest, moment) =>
        moment.index <= cursor && (!latest || moment.index >= latest.index)
          ? moment
          : latest,
      undefined
    )
  );
}

/** An update must belong to this assistant and precede both settlement and another turn. */
export function nextResponseUpdate(
  recording: Recording,
  lesson: GuidedLesson,
  cursor: number
): number | undefined {
  const current = recording.frames[cursor]?.messages.find(
    (message) => message.id === lesson.assistantId
  );
  if (!current) return undefined;
  const complete =
    lesson.moments.find((moment) => moment.id === 'complete')?.index ??
    lesson.end;
  for (
    let index = cursor + 1;
    index < Math.min(complete, lesson.end);
    index++
  ) {
    const frame = recording.frames[index];
    if (observedFields(frame.state)['busy'] === false) break;
    const response = frame.messages.find(
      (message) => message.id === current.id
    );
    if (response && response.text !== current.text) return index;
  }
  return undefined;
}

export function turnState(
  frame: Observation | null,
  hasResponse: boolean
): string {
  const fields = observedFields(frame?.state ?? null);
  if (fields['busy'] === true) return 'Working';
  if (fields['outcome'] === 'error' || fields['outcome'] === 'failed')
    return 'Failed';
  if (
    ['cancelled', 'canceled', 'stopped', 'interrupted', 'aborted'].includes(
      String(fields['outcome'])
    )
  )
    return 'Stopped';
  if (
    fields['busy'] === false &&
    fields['outcome'] === 'success' &&
    hasResponse
  )
    return 'Complete';
  return 'Outcome unknown';
}
