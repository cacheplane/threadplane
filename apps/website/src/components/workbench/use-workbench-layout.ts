'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_WORKBENCH_LAYOUT,
  normalizeWorkbenchLayout,
  readWorkbenchLayout,
  type WorkbenchLayout,
  writeWorkbenchLayout,
} from './workbench-layout';

export function useWorkbenchLayout() {
  const [layout, setLayout] = useState<WorkbenchLayout>({
    ...DEFAULT_WORKBENCH_LAYOUT,
  });
  const current = useRef(layout);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    current.current = readWorkbenchLayout();
    setLayout(current.current);
    return () => {
      mounted.current = false;
    };
  }, []);

  const update = useCallback(
    (patch: Partial<WorkbenchLayout>, persist = true) => {
      if (!mounted.current) return;
      const next = normalizeWorkbenchLayout({ ...current.current, ...patch });
      current.current = next;
      setLayout(next);
      if (persist) writeWorkbenchLayout(next);
    },
    []
  );

  const reset = useCallback(() => update(DEFAULT_WORKBENCH_LAYOUT), [update]);

  return { layout, update, reset };
}
