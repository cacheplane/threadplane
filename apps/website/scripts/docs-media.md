# Documentation recordings

`DocsDemoVideo` uses one focused recording for the requested topic and frontend.
The assets live under `apps/website/public/media/docs/`; the small encoded clips
are versioned with their captions, posters, walkthroughs and capture metadata.
Do not replace them with the older marketing clips: the legacy Render clip
shows A2UI, while the documentation `ui` recording uses `@threadplane/render`.

## Reproduce

Use the installed npm/Nx workspace, Playwright Chromium, `ffmpeg`/`ffprobe` and
the existing `examples/chat/python/.venv` environment. No provider key is needed.

```sh
npx nx run-many -t build -p cockpit-langgraph-streaming-angular,cockpit-langgraph-persistence-angular,cockpit-langgraph-client-tools-angular,cockpit-render-spec-rendering-angular,cockpit-langgraph-streaming-react,cockpit-langgraph-persistence-react,cockpit-langgraph-client-tools-react,cockpit-render-spec-rendering-react --parallel=2
node apps/website/scripts/record-docs-media.mjs
```

To recapture one interaction, append its lesson and frontend, for example:

```sh
node apps/website/scripts/record-docs-media.mjs persistence react
```

The recorder owns ports 4739 and 5739. It starts a local LangGraph service using
the existing streaming, persistence and client-tools graphs. An isolated aimock
server supplies the checked-in responses in 12-character chunks with 100 ms
delays. The environment excludes provider and tracing credentials. The renderer
lesson plays the actual application's authored local JSON source and makes no
model request. These recordings demonstrate UI and protocol behavior; they are
not live-model captures or claims about production performance.

Each take checks its actual completion before encoding. Persistence shows
switching back to saved messages; its page-local picker does not demonstrate
recovery after a browser refresh. The weather tool returns fixed example data.
The actual apps lay out at 640×640, rather than shrinking a full desktop shell.
Angular uses its existing `tplane:theme` host message to select its native light
tokens; React retains its native light stylesheet. No capture-only CSS is added.
The encoder trims initial loading, preserves actual footage speed, adds no
synthetic interface, and derives a poster from a result frame. Captions follow
measured interaction phases and must stay at or below 20 characters per second.
The renderer capture takes a normal screenshot after completion to flush
Chromium's last real paint before its reading hold; no screenshot replaces video.

Raw captures, failure screenshots, runtime logs and edit evidence remain under
ignored `dist/docs-media/<timestamp>`. Public companions include the input,
base revision and working-tree state, source/build hashes, raw-capture hash, edit boundaries, final
visible text, observed HTTP paths, encoder version/arguments and output hashes.
Only a complete companion set is copied into public assets for a take.
The source hashes identify the files actually captured, including uncommitted
changes; a base revision alone does not identify a dirty working tree.

## Verify

```sh
npx nx test website --testFiles=src/components/docs/DocsDemoVideo.spec.tsx,src/lib/docs-demo-media.spec.ts,scripts/encode-docs-media.spec.ts
```

The encoder decodes both MP4 and WebM before publication. The catalog test checks
every published asset hash, caption rate, duration and framework identity.
Inspect start, action and result frames, then check native controls, fullscreen,
captions and text walkthroughs at desktop and phone widths in the website's
browser audit. Playback never starts automatically and preloads no video.
