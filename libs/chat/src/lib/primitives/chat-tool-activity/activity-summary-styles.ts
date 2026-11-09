/** Shared by the built-in group and direct activity-group presentation. */
export const ACTIVITY_SUMMARY_STYLES = `
.tp-tool-activity__label { min-inline-size:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.tp-tool-activity__cue { flex:none; white-space:nowrap; color:var(--tplane-chat-text-muted,GrayText); font-size:12px; }
.tp-tool-activity__status { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
@media (prefers-reduced-motion:no-preference) and (forced-colors:none) {
  @supports (background-clip:text) or (-webkit-background-clip:text) {
    @keyframes tp-tool-activity-shimmer { from { background-position:200% 0; } to { background-position:-200% 0; } }
    .tp-tool-activity__label[data-active='true'] {
      background-image:linear-gradient(100deg,var(--tplane-chat-text-muted,GrayText) 35%,var(--tplane-chat-text,CanvasText) 50%,var(--tplane-chat-text-muted,GrayText) 65%);
      background-size:200% 100%; background-clip:text; -webkit-background-clip:text; color:transparent;
      animation:tp-tool-activity-shimmer 2.4s linear infinite;
    }
  }
}
@media (forced-colors:active) { .tp-tool-activity__label, .tp-tool-activity__cue { color:CanvasText; } }
`;
