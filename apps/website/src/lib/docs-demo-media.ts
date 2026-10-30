export type DocsDemoId = 'streaming' | 'tools' | 'persistence' | 'ui';
export type DocsDemoFrontend = 'angular' | 'react';

export interface DocsDemoMedia {
  readonly id: string;
  readonly title: string;
  readonly caption: string;
  readonly recording: string;
  readonly steps: readonly string[];
  readonly base: string;
  readonly width: number;
  readonly height: number;
}

const lessons = {
  streaming: {
    title: 'Watch a response stream',
    caption:
      'Send a message, watch partial text arrive, and wait for the response to finish.',
    steps: [
      'Enter a message and choose Send.',
      'The conversation displays partial response text while the request is active.',
      'The completed response remains in the conversation.',
    ],
  },
  persistence: {
    title: 'Return to a saved conversation',
    caption: 'Start a conversation, switch away, then load its saved messages.',
    steps: [
      'Send a message in the first conversation.',
      'Start a new conversation. The first remains in the picker.',
      'Select the first conversation to load its saved messages. The picker is local to this page; this recording does not demonstrate browser-refresh recovery.',
    ],
  },
  tools: {
    title: 'Follow a browser tool call',
    caption:
      'Request weather, run the browser tool, and return its result to the conversation.',
    steps: [
      'Request weather in the conversation.',
      'The agent requests the registered browser weather tool.',
      'The browser returns its fixed demonstration result and the conversation continues. This is sample weather, not a live forecast.',
    ],
  },
  ui: {
    title: 'Render a streamed specification',
    caption:
      'Play an authored JSON sample and watch trusted components appear as it becomes complete.',
    steps: [
      'Choose an authored sample in the specification example.',
      'Play the local JSON stream and inspect the incomplete render.',
      'Finish the stream to inspect the complete component tree. No model or runtime request is involved.',
    ],
  },
} satisfies Record<
  DocsDemoId,
  { title: string; caption: string; steps: readonly string[] }
>;

/** Selects a recording by lesson and actual captured frontend; never substitutes another framework. */
export function getDocsDemo(
  demo: DocsDemoId,
  frontend: DocsDemoFrontend = 'angular'
): DocsDemoMedia {
  if (
    !Object.hasOwn(lessons, demo) ||
    !['angular', 'react'].includes(frontend)
  ) {
    throw new Error(`Unknown documentation recording: ${demo}/${frontend}`);
  }
  const id = `${demo}-${frontend}`;
  return {
    ...lessons[demo],
    id,
    title: `${frontend === 'angular' ? 'Angular' : 'React'}: ${
      lessons[demo].title
    }`,
    recording:
      demo === 'ui'
        ? 'Recorded in the real example with an authored local JSON sample. No model requests or narration. Actual-speed footage with reading pauses.'
        : 'Recorded in the real example with fixture responses paced for readability. No live model requests or narration. Actual-speed footage with reading pauses.',
    base: `/media/docs/${id}`,
    width: 640,
    height: 640,
  };
}
