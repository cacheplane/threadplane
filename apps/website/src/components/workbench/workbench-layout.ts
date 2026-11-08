export interface WorkbenchLayout {
  split: number;
  height: number;
  files: number;
}

export const WORKBENCH_LAYOUT_STORAGE_KEY =
  'threadplane.learning-workbench.layout.v1';

export const DEFAULT_WORKBENCH_LAYOUT: Readonly<WorkbenchLayout> = {
  split: 44,
  height: 400,
  files: 190,
};

export const WORKBENCH_LAYOUT_LIMITS = {
  split: { min: 25, max: 75 },
  height: { min: 360, max: 800 },
  files: { min: 140, max: 320 },
} as const;

export function normalizeWorkbenchLayout(value: unknown): WorkbenchLayout {
  const candidate =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const bounded = (key: keyof WorkbenchLayout) => {
    const number = candidate[key];
    const { min, max } = WORKBENCH_LAYOUT_LIMITS[key];
    return typeof number === 'number' && Number.isFinite(number)
      ? Math.min(max, Math.max(min, number))
      : DEFAULT_WORKBENCH_LAYOUT[key];
  };
  return {
    split: bounded('split'),
    height: bounded('height'),
    files: bounded('files'),
  };
}

export function readWorkbenchLayout(): WorkbenchLayout {
  try {
    return normalizeWorkbenchLayout(
      JSON.parse(
        window.localStorage.getItem(WORKBENCH_LAYOUT_STORAGE_KEY) ?? 'null'
      )
    );
  } catch {
    return { ...DEFAULT_WORKBENCH_LAYOUT };
  }
}

export function writeWorkbenchLayout(layout: WorkbenchLayout): void {
  try {
    window.localStorage.setItem(
      WORKBENCH_LAYOUT_STORAGE_KEY,
      JSON.stringify(normalizeWorkbenchLayout(layout))
    );
  } catch {
    // Layout controls remain available when browser storage is unavailable.
  }
}
