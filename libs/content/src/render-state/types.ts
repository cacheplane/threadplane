/** Plain application-owned data. All captured containers are recursively frozen. */
export type RenderStateValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly RenderStateValue[]
  | { readonly [key: string]: RenderStateValue };

/** The direct owned root record, stable between accepted writes. */
export type RenderStateSnapshot = {
  readonly [key: string]: RenderStateValue;
};

export interface RenderStateChange {
  readonly path: string;
  readonly value: RenderStateValue;
}

export interface RenderState {
  readonly getSnapshot: () => RenderStateSnapshot;
  readonly get: (path: string) => RenderStateValue;
  readonly set: (path: string, value: unknown) => void;
  readonly update: (updates: Readonly<Record<string, unknown>>) => void;
  readonly lastChange: () => RenderStateChange | undefined;
  readonly subscribe: (notify: () => void) => () => void;
  readonly dispose: () => void;
}
