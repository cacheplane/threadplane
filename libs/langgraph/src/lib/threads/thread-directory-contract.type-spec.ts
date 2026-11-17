import type * as Core from '@threadplane/core';
import type * as Chat from '@threadplane/chat';

// Pins the Angular copy of ThreadDirectory in @threadplane/chat to the
// framework-neutral contract in @threadplane/core.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
  ? true
  : false;

export const entry: Equal<Core.ThreadEntry, Chat.ThreadEntry> = true;
export const project: Equal<Core.ProjectEntry, Chat.ProjectEntry> = true;
export const status: Equal<Core.ThreadDirectoryStatus, Chat.ThreadDirectoryStatus> = true;
export const snapshot: Equal<Core.ThreadDirectorySnapshot, Chat.ThreadDirectorySnapshot> = true;
export const error: Equal<Core.AgentError, Chat.ThreadDirectoryError> = true;

// create() differs only in its metadata value type (PlainValue vs unknown),
// so the core directory is assignable to the chat one, not the reverse.
export const assignable: Core.ThreadDirectory extends Chat.ThreadDirectory ? true : false = true;
export const rest: Equal<
  Omit<Core.ThreadDirectory, 'create'>,
  Omit<Chat.ThreadDirectory, 'create'>
> = true;
