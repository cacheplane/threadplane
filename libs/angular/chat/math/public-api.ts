// LaTeX math in chat markdown, with the application's KaTeX. Its own entry
// point so that an application can provide math from its root configuration
// without bringing the chat UI into its initial bundle: every chat symbol
// shares one bundled module, and importing any of them eagerly would.
export { provideChatMath, ChatMathRenderer } from './src/chat-math';
export type { ChatMathLoader, ChatMathModule } from './src/chat-math';
