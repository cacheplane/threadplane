// libs/chat/src/lib/styles/chat-sidenav.styles.ts
export const CHAT_SIDENAV_STYLES = `
  /*
   * In expanded / collapsed modes the sidenav is "always visible" beside the
   * main content — the consumer reserves space with padding-left on the
   * layout container. The host must be position: fixed so it doesn't
   * participate in document flow; otherwise its display: block stretches
   * to the parent's full width and pushes siblings below the viewport.
   */
  :host {
    display: block;
    height: 100%;
  }
  :host([data-mode="expanded"]),
  :host([data-mode="collapsed"]) {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    z-index: 100;
  }
  :host([data-mode="expanded"]) {
    width: var(--tplane-chat-sidenav-width-expanded);
  }
  :host([data-mode="collapsed"]) {
    width: var(--tplane-chat-sidenav-width-collapsed);
  }
  :host([data-mode="expanded"]) .chat-sidenav {
    width: 100%;
  }
  :host([data-mode="collapsed"]) .chat-sidenav {
    width: 100%;
  }
  :host([data-mode="drawer"]) {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: var(--tplane-chat-sidenav-width-drawer);
    z-index: var(--tplane-chat-z-drawer, 1001);
    /* The host is a fixed, drawer-width, full-height box at z-index 1001 that
     * stays put whether or not the drawer is open — only the inner .chat-sidenav
     * PANEL slides off-screen (translateX(-100%)) when closed. Without this, the
     * transparent closed host still intercepts clicks over the left strip of the
     * content beneath it (e.g. App-mode forces drawer on desktop, so it covered
     * the itinerary overlay + welcome suggestions). Make the host inert; the
     * on-screen panel re-enables pointer events below. */
    pointer-events: none;
  }
  :host([data-mode="drawer"][data-open="true"]) {
    box-shadow: 8px 0 32px rgba(0, 0, 0, 0.18);
  }
  .chat-sidenav {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--tplane-chat-bg);
    border-right: 1px solid var(--tplane-chat-separator);
    box-sizing: border-box;
    overflow: hidden;
  }
  :host([data-mode="drawer"]) .chat-sidenav {
    width: 100%;
    height: 100%;
    transition: transform 200ms ease;
    transform: translateX(-100%);
    /* Keep the closed/closing panel inert. The host is inert above, and the
     * panel can still be hit during its transform transition unless pointer
     * events are restored only for the open state below. */
    pointer-events: none;
  }
  :host([data-mode="drawer"][data-open="true"]) .chat-sidenav {
    transform: translateX(0);
    pointer-events: auto;
  }
  .chat-sidenav__header {
    flex-shrink: 0;
    padding: var(--tplane-chat-space-3);
  }
  /* Collapse the header slot when the consumer doesn't project content
   * — matches the chat-window pattern. Avoids 24px of dead space above
   * the New chat button. */
  .chat-sidenav__header:empty { display: none; }
  .chat-sidenav__topbar {
    flex-shrink: 0;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    padding: var(--tplane-chat-space-2) var(--tplane-chat-space-3);
    border-bottom: 1px solid var(--tplane-chat-separator);
  }
  :host([data-mode="collapsed"]) .chat-sidenav__topbar {
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: var(--tplane-chat-space-2) 0;
  }
  .chat-sidenav__topbar .chat-sidenav__action--close {
    width: 36px;
    height: 36px;
    padding: 0;
    justify-content: center;
    flex: 0 0 auto;
  }
  .chat-sidenav__topbar .chat-sidenav__action--close .chat-sidenav__action-label {
    display: none;
  }
  .chat-sidenav__action--new {
    /* Geometry only — fill/color set by the late-cascade
       .chat-sidenav__action.chat-sidenav__action--new block. */
    border: 0;
    padding: 12px 18px;
    border-radius: var(--tplane-chat-radius-button);
    font-size: var(--tplane-chat-font-size-sm);
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    width: 100%;
  }
  .chat-sidenav__action--new:focus-visible {
    outline: 2px solid var(--tplane-chat-focus-ring);
    outline-offset: 2px;
  }
  /* Collapsed mode: shrink to 32×32 icon-only square. */
  :host([data-mode="collapsed"]) .chat-sidenav__action--new {
    width: 32px;
    height: 32px;
    padding: 0;
    border-radius: var(--tplane-chat-radius-card);
    justify-content: center;
  }
  :host([data-mode="collapsed"]) .chat-sidenav__action--new .chat-sidenav__action-label {
    display: none;
  }
  .chat-sidenav__actions {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: var(--tplane-chat-space-3);
  }
  :host([data-mode="collapsed"]) .chat-sidenav__actions {
    align-items: center;
    padding: var(--tplane-chat-space-2);
  }
  .chat-sidenav__action {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    border: 0;
    background: transparent;
    color: var(--tplane-chat-text);
    border-radius: var(--tplane-chat-radius-button);
    cursor: pointer;
    font-family: inherit;
    font-size: var(--tplane-chat-font-size-sm);
    font-weight: 400;
    text-align: left;
  }
  .chat-sidenav__action:hover { background: var(--tplane-chat-surface-alt); }
  .chat-sidenav__action:focus-visible {
    outline: 2px solid var(--tplane-chat-focus-ring);
    outline-offset: 2px;
  }
  :host([data-mode="collapsed"]) .chat-sidenav__action {
    width: 36px;
    height: 36px;
    padding: 0;
    justify-content: center;
  }
  :host([data-mode="collapsed"]) .chat-sidenav__action-label {
    display: none;
  }
  /* Primary CTA pill — defined AFTER the generic .chat-sidenav__action
     rule so its background/padding/radius win the cascade with equal
     specificity. The earlier --new block above is kept for the
     collapsed-mode overrides (which are :host-prefixed, higher
     specificity, so they still apply). */
  .chat-sidenav__action.chat-sidenav__action--new {
    background: var(--tplane-chat-text);
    color: var(--tplane-chat-bg);
    border-radius: var(--tplane-chat-radius-button);
    padding: 12px 18px;
    font-weight: 600;
    font-size: var(--tplane-chat-font-size-sm);
  }
  .chat-sidenav__action.chat-sidenav__action--new:hover {
    background: var(--tplane-chat-text);
    filter: brightness(0.92);
  }
  .chat-sidenav__action-icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }
  .chat-sidenav__primary,
  .chat-sidenav__sections {
    flex-shrink: 0;
  }
  .chat-sidenav__threads {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
  }
  .chat-sidenav__threads-heading {
    padding: 8px 12px 4px;
    font-size: var(--tplane-chat-font-size-xs);
    color: var(--tplane-chat-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  :host([data-mode="collapsed"]) .chat-sidenav__threads-heading {
    display: none;
  }
  .chat-sidenav__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-top: 1px solid var(--tplane-chat-separator);
    gap: 8px;
    flex-shrink: 0;
  }
  .chat-sidenav__footer-left {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 28px;
  }
  .chat-sidenav__debug {
    height: 28px;
    min-width: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 0 9px;
    border: 0;
    border-radius: var(--tplane-chat-radius-button);
    background: transparent;
    color: var(--tplane-chat-text-muted);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    font-weight: 500;
  }
  .chat-sidenav__debug:hover {
    background: var(--tplane-chat-surface-alt);
    color: var(--tplane-chat-text);
  }
  .chat-sidenav__debug:focus-visible {
    outline: 2px solid var(--tplane-chat-focus-ring);
    outline-offset: 2px;
  }
  .chat-sidenav__debug-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--tplane-chat-success);
    flex: 0 0 auto;
  }
  .chat-sidenav__debug-dot--streaming {
    animation: chat-sidenav-debug-pulse 1.2s ease-in-out infinite;
  }
  @keyframes chat-sidenav-debug-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.6; transform: scale(0.85); }
  }
  .chat-sidenav__footer-right {
    display: flex;
    align-items: center;
    gap: 4px;
    /* Push to the right edge even when the left container is empty. */
    margin-left: auto;
  }
  .chat-sidenav__toggle {
    width: 28px;
    height: 28px;
    border-radius: var(--tplane-chat-radius-button);
    border: 0;
    background: transparent;
    color: var(--tplane-chat-text-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .chat-sidenav__toggle:hover {
    background: var(--tplane-chat-surface-alt);
    color: var(--tplane-chat-text);
  }
  /* Collapsed mode: footer becomes a vertical stack; debug stays visible. */
  :host([data-mode="collapsed"]) .chat-sidenav__footer {
    flex-direction: column;
    align-items: center;
    padding: 10px 4px;
  }
  :host([data-mode="collapsed"]) .chat-sidenav__footer-left {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-height: 28px;
  }
  :host([data-mode="collapsed"]) .chat-sidenav__debug {
    width: 28px;
    padding: 0;
  }
  :host([data-mode="collapsed"]) .chat-sidenav__debug-label,
  :host([data-mode="collapsed"]) .chat-sidenav__footer-left > :not(.chat-sidenav__debug) {
    display: none;
  }
  :host([data-mode="collapsed"]) .chat-sidenav__footer-right {
    flex-direction: column;
  }
  /* Legacy [sidenavAccount] slot: kept renderable but visually folded into
     the new footer. Existing consumers' content still projects; the slot
     just renders in the footer-right area visually. */
  .chat-sidenav__account {
    display: none;
  }
  .chat-sidenav__account:has(> *) {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .chat-sidenav__archived { flex-shrink: 0; }
  .chat-sidenav__archived-heading {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    border: 0;
    border-radius: var(--tplane-chat-radius-card);
    background: transparent;
    color: var(--tplane-chat-text);
    font: inherit;
    font-size: var(--tplane-chat-font-size-sm);
    text-align: left;
    cursor: pointer;
  }
  .chat-sidenav__archived-heading:hover {
    background: var(--tplane-chat-surface-alt);
    color: var(--tplane-chat-text);
  }
  .chat-sidenav__archived-heading:focus-visible {
    outline: 2px solid var(--tplane-chat-focus-ring);
    outline-offset: 2px;
  }
  .chat-sidenav__archived-chevron {
    width: 12px;
    height: 12px;
    transition: transform 150ms ease;
    flex-shrink: 0;
  }
  .chat-sidenav__archived[data-open="true"] .chat-sidenav__archived-chevron {
    transform: rotate(90deg);
  }
  .chat-sidenav__archived-empty {
    padding: 8px 12px;
    color: var(--tplane-chat-text-muted);
    font-size: var(--tplane-chat-font-size-sm);
  }
  :host([data-mode="collapsed"]) .chat-sidenav__archived { display: none; }
  .chat-sidenav__projects { flex-shrink: 0; }
  :host([data-mode="collapsed"]) .chat-sidenav__projects { display: none; }

  /* Collapsed-mode thread row presentation: hide labels, kebab and grip;
   * surface the per-thread initial circle so the strip reads as a list of
   * threads rather than an empty column. */
  :host([data-mode="collapsed"]) .chat-thread-list__initial {
    display: inline-flex;
  }
  :host([data-mode="collapsed"]) .chat-thread-list__item-title { display: none; }
  :host([data-mode="collapsed"]) .chat-thread-list__item-time { display: none; }
  :host([data-mode="collapsed"]) .chat-thread-list__kebab { display: none; }
  :host([data-mode="collapsed"]) .chat-thread-list__grip { display: none; }
  :host([data-mode="collapsed"]) .chat-thread-list__item-wrap {
    justify-content: center;
  }
  :host([data-mode="collapsed"]) .chat-thread-list__item {
    padding: 6px;
    justify-content: center;
    align-items: center;
    flex-direction: row;
  }
  :host([data-mode="collapsed"]) .chat-thread-list__new { display: none; }
  :host([data-mode="collapsed"]) .chat-sidenav__action--search {
    width: 32px;
    height: 32px;
    padding: 0;
    border-radius: var(--tplane-chat-radius-card);
    justify-content: center;
    background: transparent;
  }
  :host([data-mode="collapsed"]) .chat-sidenav__action--search .chat-sidenav__action-label {
    display: none;
  }
  /* Collapsed: thread list, project list, archived block, sections — all hidden. */
  :host([data-mode="collapsed"]) .chat-sidenav__threads,
  :host([data-mode="collapsed"]) .chat-sidenav__projects,
  :host([data-mode="collapsed"]) .chat-sidenav__archived,
  :host([data-mode="collapsed"]) .chat-sidenav__sections,
  :host([data-mode="collapsed"]) .chat-sidenav__primary {
    display: none;
  }
  /* Collapsed: reduce horizontal padding so 32×32 buttons sit centered. */
  :host([data-mode="collapsed"]) .chat-sidenav__topbar,
  :host([data-mode="collapsed"]) .chat-sidenav__actions {
    padding: 8px 4px;
    align-items: center;
    justify-content: center;
  }
`;
