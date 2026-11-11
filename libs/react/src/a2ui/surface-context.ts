import { createContext, useContext } from 'react';
import type { A2uiValue } from '@threadplane/content/a2ui';

/** What a mounted surface offers its input components. */
export interface A2uiSurfaceWriter {
  /** False when the surface was given no store: inputs then show values and change nothing. */
  readonly editable: boolean;
  /** Writes one edit at a data model path; a missing path (a literal prop) is ignored. */
  readonly write: (path: string | undefined, value: A2uiValue) => void;
}

const READ_ONLY: A2uiSurfaceWriter = Object.freeze({
  editable: false,
  write: () => undefined,
});

export const A2uiSurfaceContext = createContext<A2uiSurfaceWriter>(READ_ONLY);

/** The surrounding surface's write channel; read-only outside an editable `A2uiSurface`. */
export function useA2uiSurfaceWriter(): A2uiSurfaceWriter {
  return useContext(A2uiSurfaceContext);
}

/** Internal: which components can send an event action from this surface, and how. */
export interface A2uiSurfaceActions {
  readonly actionable: (componentId: string) => boolean;
  readonly act: (componentId: string) => void;
}

export const A2uiActionContext = createContext<A2uiSurfaceActions>(
  Object.freeze({ actionable: () => false, act: () => undefined })
);

/** Internal: lets a Button used as a Modal's trigger be the one control that opens it. */
export interface A2uiModalTrigger {
  readonly expanded: boolean;
  readonly open: () => void;
  /** Called while a Button is mounted in the trigger; returns its release. */
  readonly claim: () => () => void;
}

export const A2uiModalTriggerContext = createContext<A2uiModalTrigger | null>(
  null
);
