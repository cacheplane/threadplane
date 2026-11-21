declare const THREADPLANE_CHAT_DEBUG: boolean;
declare const ngDevMode: boolean;

export const CHAT_DEBUG_INCLUDED =
  ngDevMode ||
  (typeof THREADPLANE_CHAT_DEBUG !== 'undefined' && THREADPLANE_CHAT_DEBUG === true);
