// libs/chat/src/lib/styles/chat-markdown.styles.ts
//
// Scoped to the `chat-streaming-md` element selector (not `:host`) because
// the component renders markdown via innerHTML and uses
// `ViewEncapsulation.None` — emulated encapsulation would skip these rules
// since innerHTML-injected nodes don't carry `_ngcontent-xxx` attributes.
// Keeping selectors prefixed with the element name preserves locality so
// these rules don't leak to other markup on the page.
//
// Covers the CommonMark + GFM surface: headings, paragraphs, links, lists
// (bullet/ordered/task), code (inline + fenced), blockquotes, horizontal
// rules, tables, images, bold (`strong`), italic (`em`), strikethrough
// (`del`/`s`).
export const CHAT_MARKDOWN_STYLES = `
  chat-streaming-md { display: block; color: var(--tplane-chat-text); line-height: var(--tplane-chat-line-height); }

  /* Headings */
  chat-streaming-md h1, chat-streaming-md h2, chat-streaming-md h3, chat-streaming-md h4, chat-streaming-md h5, chat-streaming-md h6 {
    font-weight: 600;
    line-height: 1.25;
    margin: 1.25rem 0 0.75rem;
  }
  chat-streaming-md h1:first-child, chat-streaming-md h2:first-child, chat-streaming-md h3:first-child,
  chat-streaming-md h4:first-child, chat-streaming-md h5:first-child, chat-streaming-md h6:first-child { margin-top: 0; }
  chat-streaming-md h1 { font-size: 1.5em; font-weight: 700; }
  chat-streaming-md h2 { font-size: 1.25em; }
  chat-streaming-md h3 { font-size: 1.125em; }
  chat-streaming-md h4 { font-size: 1em; }
  chat-streaming-md h5, chat-streaming-md h6 { font-size: var(--tplane-chat-font-size-sm); color: var(--tplane-chat-text-muted); }

  /* Paragraphs and inline emphasis */
  chat-streaming-md p { margin: 0 0 0.75rem; line-height: var(--tplane-chat-line-height); font-size: var(--tplane-chat-font-size); }
  chat-streaming-md p:last-child { margin-bottom: 0; }
  chat-streaming-md strong, chat-streaming-md b { font-weight: 700; }
  chat-streaming-md em, chat-streaming-md i { font-style: italic; }
  chat-streaming-md del, chat-streaming-md s { text-decoration: line-through; color: var(--tplane-chat-text-muted); }
  chat-streaming-md mark { background: var(--tplane-chat-surface-alt); padding: 0 2px; border-radius: var(--tplane-chat-radius-sm); }
  chat-streaming-md sub { font-size: 0.75em; vertical-align: sub; }
  chat-streaming-md sup { font-size: 0.75em; vertical-align: super; }

  /* Links */
  chat-streaming-md a { color: var(--tplane-chat-primary); text-decoration: underline; text-underline-offset: 2px; }
  chat-streaming-md a:hover { text-decoration-thickness: 2px; }

  /* Lists (CommonMark + GFM task lists) */
  chat-streaming-md ul, chat-streaming-md ol { margin: 0 0 0.75rem; padding-left: 1.5rem; }
  chat-streaming-md ul { list-style: disc outside; }
  chat-streaming-md ol { list-style: decimal outside; }
  chat-streaming-md ul ul { list-style: circle outside; }
  chat-streaming-md ul ul ul { list-style: square outside; }
  chat-streaming-md li { margin: var(--tplane-chat-space-1) 0; }
  /* An inline wrapper around the block paragraph creates a marker-only line
     in Firefox. Keep the list item's content in one block flow. */
  chat-streaming-md li > chat-md-children { display: block; }
  chat-streaming-md li::marker { color: var(--tplane-chat-text-muted); }
  chat-streaming-md li > p { margin: 0 0 0.25rem; }
  chat-streaming-md li > ul, chat-streaming-md li > ol { margin: 0.25rem 0 0; }
  /* GFM task lists: marked emits <li><input type="checkbox" disabled> ... */
  chat-streaming-md li:has(> input[type="checkbox"]) { list-style: none; margin-left: -1.25rem; }
  chat-streaming-md li > input[type="checkbox"] { margin-right: 0.5rem; vertical-align: middle; }

  /* Code (inline + fenced) */
  chat-streaming-md code {
    background: var(--tplane-chat-surface-alt);
    color: var(--tplane-chat-text);
    padding: 1px var(--tplane-chat-space-1);
    border-radius: var(--tplane-chat-radius-sm);
    font-family: var(--tplane-chat-font-mono);
    /* 14px in body text: the sm step of the type scale. */
    font-size: 0.875em;
  }
  chat-streaming-md pre {
    background: var(--tplane-chat-surface-alt);
    color: var(--tplane-chat-text);
    padding: var(--tplane-chat-space-3) var(--tplane-chat-space-4);
    border-radius: var(--tplane-chat-radius-card);
    overflow-x: auto;
    font-family: var(--tplane-chat-font-mono);
    font-size: var(--tplane-chat-font-size-sm);
    line-height: 1.5;
    margin: 0 0 0.75rem;
  }
  chat-streaming-md pre code { background: transparent; padding: 0; border-radius: 0; font-size: inherit; }

  /* Blockquote */
  chat-streaming-md blockquote {
    border-left: 3px solid var(--tplane-chat-separator);
    padding: 0.25rem 0 0.25rem 12px;
    margin: 0 0 0.75rem;
    color: var(--tplane-chat-text-muted);
  }
  chat-streaming-md blockquote > :last-child { margin-bottom: 0; }

  /* Horizontal rule */
  chat-streaming-md hr {
    border: none;
    border-top: 1px solid var(--tplane-chat-separator);
    margin: 1rem 0;
  }

  /* Tables (GFM) */
  chat-streaming-md table {
    border-collapse: collapse;
    margin: 0 0 0.75rem;
    width: 100%;
    font-size: var(--tplane-chat-font-size-sm);
  }
  /* A relative size would compound inside the smaller table text (13.68px). */
  chat-streaming-md table code { font-size: var(--tplane-chat-font-size-xs); }
  chat-streaming-md thead { background: var(--tplane-chat-surface-alt); }
  chat-streaming-md th, chat-streaming-md td {
    border: 1px solid var(--tplane-chat-separator);
    padding: 6px 10px;
    text-align: left;
    vertical-align: top;
  }
  chat-streaming-md th { font-weight: 600; }
  /* Component-rendered table: chat-md-table becomes a horizontally-scrollable
     wrapper for the inner <table>; row/cell elements stay layout-transparent
     so the browser's table layout takes over. Without this overflow wrapper,
     wide tables push their parent container past the viewport horizontally. */
  chat-streaming-md chat-md-table {
    display: block;
    overflow-x: auto;
    max-width: 100%;
    margin: 0 0 0.75rem;
    /* Scroll cue: a soft shadow shows at an edge only while more table lies
       beyond it (the "local" covers scroll with the content and hide the
       "scroll" shadows at the ends). Touch devices hide scrollbars. */
    background:
      linear-gradient(to right, var(--tplane-chat-bg) 30%, transparent) left center / 24px 100% no-repeat local,
      linear-gradient(to left, var(--tplane-chat-bg) 30%, transparent) right center / 24px 100% no-repeat local,
      radial-gradient(farthest-side at 0 50%, color-mix(in srgb, var(--tplane-chat-text) 22%, transparent), transparent) left center / 12px 100% no-repeat scroll,
      radial-gradient(farthest-side at 100% 50%, color-mix(in srgb, var(--tplane-chat-text) 22%, transparent), transparent) right center / 12px 100% no-repeat scroll;
  }
  chat-streaming-md chat-md-table-row { display: contents; }
  chat-streaming-md chat-md-table-cell { display: contents; }
  chat-streaming-md chat-md-table > table { margin: 0; }
  /* Task-list items: checkbox + first paragraph render inline; subsequent
     blocks (sub-lists, multi-paragraph items) flow normally below. */
  chat-streaming-md li.chat-md-list-item--task {
    list-style: none;
    margin-left: -1.25rem;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem;
  }
  chat-streaming-md li.chat-md-list-item--task { position: relative; }
  /* The disabled input stays as the accessible checkbox; the box below draws
     its state from the tokens (native disabled styling is too faint). */
  chat-streaming-md li.chat-md-list-item--task > input.chat-md-task-input {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  chat-streaming-md .chat-md-task-box {
    flex: 0 0 auto;
    box-sizing: border-box;
    width: 14px;
    height: 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1.5px solid var(--tplane-chat-text-muted);
    border-radius: var(--tplane-chat-radius-sm);
    transform: translateY(2px);
  }
  chat-streaming-md .chat-md-task-box--checked {
    border-color: var(--tplane-chat-text);
    background: var(--tplane-chat-text);
    color: var(--tplane-chat-bg);
  }
  chat-streaming-md .chat-md-task-box svg { width: 10px; height: 10px; display: block; }
  @media (forced-colors: active) {
    chat-streaming-md .chat-md-task-box { border-color: CanvasText; }
    chat-streaming-md .chat-md-task-box--checked { background: CanvasText; color: Canvas; }
  }
  /* The chat-md-children wrapper around list-item content takes remaining width */
  chat-streaming-md li.chat-md-list-item--task > chat-md-children {
    flex: 1 1 auto;
    min-width: 0;
  }
  /* Tight task items: only the FIRST paragraph aligns inline with the
     checkbox (margin collapsed). Subsequent paragraphs/blocks keep their
     normal vertical spacing so multi-block items render readably. */
  chat-streaming-md li.chat-md-list-item--task > chat-md-children > chat-md-paragraph:first-child > p {
    margin: 0;
  }

  /* Media */
  chat-streaming-md img { max-width: 100%; height: auto; border-radius: var(--tplane-chat-radius-card); }
  /* Broken-image fallback: muted pill showing alt text + icon. Triggered
     when <img> fires (error). Caught by live browser smoke — prior impl
     showed only the browser's broken-image icon with no readable alt. */
  chat-streaming-md .chat-md-image--broken {
    display: inline-flex;
    align-items: center;
    gap: var(--tplane-chat-space-2);
    padding: 0.25rem 0.5rem;
    background: var(--tplane-chat-surface-alt);
    border: 1px dashed var(--tplane-chat-separator);
    border-radius: var(--tplane-chat-radius-card);
    font-size: 0.9em;
    color: var(--tplane-chat-text-muted, currentColor);
    opacity: 0.85;
  }
  chat-streaming-md .chat-md-image__icon { font-size: 1em; line-height: 1; }
  chat-streaming-md .chat-md-image__alt { font-style: italic; }
  /* Math (KaTeX). Display math is a centered block that scrolls horizontally
     on overflow; the raw fallback (KaTeX missing or invalid LaTeX) reads as
     monospace so the source delimiters look intentional. */
  chat-streaming-md .chat-md-math--display { display: block; margin: 0.5em 0; overflow-x: auto; }
  chat-streaming-md .chat-md-math--raw { font-family: var(--tplane-chat-font-mono, ui-monospace, monospace); }
`;
