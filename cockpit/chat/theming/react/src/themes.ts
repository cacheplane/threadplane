/** Closed, demo-local choices; values live on the same chat root in CSS. */
export const themes = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'ocean', label: 'Ocean' },
  { id: 'forest', label: 'Forest' },
] as const;
export type Theme = (typeof themes)[number]['id'];
export const chatTokens = [
  '--tp-chat-text',
  '--tp-chat-muted',
  '--tp-chat-border',
  '--tp-chat-surface',
  '--tp-chat-accent',
  '--tp-chat-on-accent',
  '--tp-chat-danger',
  '--tp-chat-gap',
] as const;
