import type { LearningMilestone, LearningMoment } from './learning-lesson';
import type { Recording } from './playback';
import {
  currentLessonMoment,
  guidedLesson,
  nextResponseUpdate,
  turnState,
  type GuidedLesson,
} from './guided-lesson';

const stages = {
  message: {
    label: '1. User message',
    title: 'One message, one speaker.',
    next: 'user message',
    inspector: 'Messages',
    explanation:
      'This is the user’s message. It holds what they asked and identifies who said it.',
  },
  request: {
    label: '2. Turn in progress',
    title: 'The turn is in progress.',
    next: 'turn in progress',
    inspector: 'State',
    explanation:
      'Work has started for this turn. Progress and the final outcome are separate observations.',
  },
  partial: {
    label: '3. Assistant response',
    title: 'One response can grow.',
    next: 'assistant response',
    inspector: 'Messages',
    explanation:
      'Streaming can add text to the same assistant message. A text update does not start another turn. Text alone does not establish that the turn is complete.',
  },
  complete: {
    label: '4. Turn outcome',
    title: 'The outcome completes the picture.',
    next: 'turn outcome',
    inspector: 'State',
    explanation:
      'The application reports a successful outcome and is no longer busy. Seeing text alone does not establish that outcome.',
  },
} as const;

interface LessonProps {
  readonly recording: Recording;
  readonly cursor: number;
  readonly selectedMoment: LearningMoment | null;
  readonly onSelect: (
    moment: LearningMilestone,
    inspector: 'Messages' | 'State'
  ) => void;
  readonly lesson?: GuidedLesson;
}

export function GuidedReplayLesson({
  recording,
  cursor,
  selectedMoment,
  onSelect,
  lesson = guidedLesson(recording),
}: LessonProps) {
  if (!lesson.moments.length) return null;
  const current = currentLessonMoment(lesson, cursor, selectedMoment);
  return (
    <section className="tp-learn-lesson" aria-label="Guided replay lesson">
      <div
        className="tp-learn-milestones"
        role="group"
        aria-label="Lesson moments"
      >
        {lesson.moments.map((moment) => (
          <button
            key={moment.id}
            type="button"
            aria-current={current?.id === moment.id ? 'step' : undefined}
            onClick={() => onSelect(moment, stages[moment.id].inspector)}
          >
            {stages[moment.id].label}
          </button>
        ))}
      </div>
    </section>
  );
}

export function GuidedReplayExplanation({
  recording,
  cursor,
  selectedMoment,
  onSeek,
  lesson = guidedLesson(recording),
}: LessonProps & { readonly onSeek: (index: number) => void }) {
  const current = currentLessonMoment(lesson, cursor, selectedMoment);
  const frame = recording.frames[cursor] ?? null;
  const response = frame?.messages.find(
    (message) => message.id === lesson.assistantId
  );
  const update =
    current?.id === 'partial'
      ? nextResponseUpdate(recording, lesson, cursor)
      : undefined;
  return (
    <section
      className="tp-learn-lesson-explanation"
      aria-label="What to notice"
    >
      <div className="tp-learn-lesson-copy">
        <h4>
          {current
            ? stages[current.id].title
            : 'Follow your first working conversation.'}
        </h4>
        <p>
          {current
            ? stages[current.id].explanation
            : 'Choose a lesson step to follow a newly observed user message, work in progress, an assistant response, and an outcome.'}
        </p>
        {current?.id === 'partial' && (
          <div className="tp-learn-response-update">
            <button
              type="button"
              disabled={update === undefined}
              onClick={() => {
                if (update !== undefined) onSeek(update);
              }}
            >
              Show next response update
            </button>
          </div>
        )}
        <dl className="tp-learn-lesson-facts">
          <div>
            <dt>Messages observed</dt>
            <dd>{frame?.messages.length ?? 0}</dd>
          </div>
          <div>
            <dt>Assistant response</dt>
            <dd>{response?.text ? 'Text received' : 'No response observed'}</dd>
          </div>
          <div>
            <dt>Turn state</dt>
            <dd>{turnState(frame, Boolean(response?.text))}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

export function GuidedReplayNavigation({
  recording,
  cursor,
  selectedMoment,
  onSelect,
  lesson = guidedLesson(recording),
}: LessonProps) {
  const current = currentLessonMoment(lesson, cursor, selectedMoment);
  const position = lesson.moments.findIndex(
    (moment) => moment.id === current?.id
  );
  const next = lesson.moments[position + 1];
  const previous = lesson.moments[position - 1];
  function select(moment: LearningMilestone) {
    onSelect(moment, stages[moment.id].inspector);
  }
  return (
    <div className="tp-learn-lesson-navigation">
      <button
        type="button"
        disabled={!previous}
        onClick={() => {
          if (previous) select(previous);
        }}
      >
        Back
      </button>
      <button
        type="button"
        className="tp-learn-play"
        onClick={() => {
          const destination = next ?? lesson.moments[0];
          if (destination) select(destination);
        }}
      >
        {next ? `Next: ${stages[next.id].next}` : 'Replay lesson'}
      </button>
    </div>
  );
}
