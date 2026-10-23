import type { A2uiMessage, A2uiTheme } from '@threadplane/a2ui';

/** Finite plain data. Arrays preserve holes and explicit undefined entries. */
export type A2uiValue =
  | string | number | boolean | null | undefined
  | { readonly [key: string]: A2uiValue }
  | readonly A2uiValue[];

export interface A2uiComponentSnapshot {
  readonly id: string;
  readonly component: string;
  readonly [key: string]: A2uiValue;
}

export interface A2uiSurfaceSnapshot {
  readonly surfaceId: string;
  readonly catalogId: string;
  readonly theme?: Readonly<A2uiTheme>;
  readonly sendDataModel?: boolean;
  readonly components: readonly A2uiComponentSnapshot[];
  readonly dataModel: A2uiValue;
}

export interface A2uiSurfacesSnapshot {
  readonly surfaces: readonly A2uiSurfaceSnapshot[];
}

export interface A2uiSurfaces {
  readonly getSnapshot: () => A2uiSurfacesSnapshot;
  readonly subscribe: (notify: () => void) => () => void;
  readonly apply: (message: A2uiMessage) => void;
  readonly dispose: () => void;
}
