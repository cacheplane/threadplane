/**
 * Recorded demo clips, hosted on Vercel Blob (store `ngaf-website-assets`)
 * rather than committed to the repo — they are large binaries that would bloat
 * git history on every recut. Re-uploading with the same pathname keeps these
 * URLs stable, so a recut needs no code change.
 *
 * Shared by the homepage `DemoShowcase` and the solutions pages so one base URL
 * is stated once; a second copy would silently drift on the next store move.
 *
 * See apps/website/scripts/upload-demo-media.md for producing and uploading.
 */
export const DEMO_CDN = 'https://elgkdaxpsvqcrns1.public.blob.vercel-storage.com/demo';

export interface DemoClip {
  /** What the clip shows, for the caption under the frame. */
  caption: string;
  /** Faux address-bar text on the surrounding browser frame. */
  url: string;
  videoMp4: string;
  videoWebm: string;
  poster: string;
}

/**
 * The human-in-the-loop approval loop, recorded on the canonical demo shell:
 * an agent proposing to delete old backups, pausing for sign-off, and resuming
 * once approved.
 *
 * Recorded by `examples/chat/angular/e2e/record-demo.record.ts` against aimock
 * fixtures, so a recut is one command and reproduces frame-for-frame.
 */
export const HITL_CLIP: DemoClip = {
  caption:
    'The agent proposes a destructive action, the graph pauses, and nothing runs until a human approves it.',
  url: 'demo.threadplane.ai',
  videoMp4: `${DEMO_CDN}/hitl-demo.mp4`,
  videoWebm: `${DEMO_CDN}/hitl-demo.webm`,
  poster: `${DEMO_CDN}/hitl-demo-poster.webp`,
};

/**
 * The LangGraph streaming demo, recorded on the canonical demo shell. Exported
 * Shared by the homepage showcase and the section switcher, so a recut or a
 * store move changes one place rather than three.
 */
export const LANGGRAPH_CLIP: DemoClip = {
  caption: 'Tokens stream into the Angular surface as the agent produces them.',
  url: 'demo.threadplane.ai',
  videoMp4: `${DEMO_CDN}/langgraph-demo.mp4`,
  videoWebm: `${DEMO_CDN}/langgraph-demo.webm`,
  poster: `${DEMO_CDN}/langgraph-demo-poster.webp`,
};

/**
 * The AG-UI runtime demo. Paired with `LANGGRAPH_CLIP` so the homepage showcase
 * can state "same front end, two runtimes" from one place.
 */
export const AG_UI_CLIP: DemoClip = {
  caption: 'The same Threadplane chat surface, running against an AG-UI backend.',
  url: 'ag-ui.threadplane.ai',
  videoMp4: `${DEMO_CDN}/ag-ui-demo.mp4`,
  videoWebm: `${DEMO_CDN}/ag-ui-demo.webm`,
  poster: `${DEMO_CDN}/ag-ui-demo-poster.webp`,
};

/**
 * Generative UI: the agent emits an A2UI surface and the demo mounts it as
 * real Angular components. Recorded by
 * `examples/chat/angular/e2e/record-render.record.ts`.
 */
export const RENDER_CLIP: DemoClip = {
  caption:
    'The agent emits an A2UI surface and the Angular chat renders an interactive contact form.',
  url: 'demo.threadplane.ai',
  videoMp4: `${DEMO_CDN}/render-demo.mp4`,
  videoWebm: `${DEMO_CDN}/render-demo.webm`,
  poster: `${DEMO_CDN}/render-demo-poster.webp`,
};

/**
 * Durability: send a message, reload the page, and the conversation is still
 * there — the thread lives in a checkpoint, not in component state. Recorded by
 * `examples/chat/angular/e2e/record-ship.record.ts`.
 */
export const SHIP_CLIP: DemoClip = {
  caption:
    'Reload the page mid-conversation and nothing is lost — the thread is restored from its checkpoint.',
  url: 'demo.threadplane.ai',
  videoMp4: `${DEMO_CDN}/ship-demo.mp4`,
  videoWebm: `${DEMO_CDN}/ship-demo.webm`,
  poster: `${DEMO_CDN}/ship-demo-poster.webp`,
};
