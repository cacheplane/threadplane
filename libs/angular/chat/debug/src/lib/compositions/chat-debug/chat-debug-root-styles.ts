const CHAT_DEBUG_ROOT_STYLES = `
@layer tplane-chat-debug {
  :root {
    --tplane-chat-sidebar-claim-right: 0px;
    --tplane-chat-debug-panel-size-h: 40vh;
    --tplane-chat-debug-panel-size-w: 420px;
  }
  :root[data-threadplane-chat-debug="bottom"] {
    --tplane-chat-debug-claim-bottom: var(--tplane-chat-debug-panel-size-h, 40vh);
    --tplane-chat-occupy-bottom: var(--tplane-chat-debug-panel-size-h, 40vh);
  }
  :root[data-threadplane-chat-debug="right"] {
    --tplane-chat-debug-claim-right: var(--tplane-chat-debug-panel-size-w, 420px);
    --tplane-chat-occupy-right: var(--tplane-chat-debug-panel-size-w, 420px);
  }
  :root[data-threadplane-chat-debug="left"] {
    --tplane-chat-debug-claim-left: var(--tplane-chat-debug-panel-size-w, 420px);
    --tplane-chat-occupy-left: var(--tplane-chat-debug-panel-size-w, 420px);
  }
}
`;

const STYLE_ELEMENT_ID = 'tplane-chat-debug-root-styles';

export function ensureChatDebugRootStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = CHAT_DEBUG_ROOT_STYLES;
  document.head.appendChild(style);
}
