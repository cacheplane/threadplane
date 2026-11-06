'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { parseDocsNarrativePath } from '@threadplane/cockpit-registry/docs-routes';
import { frameworkForPath, frameworkPreference } from './framework-preference';

export function useDocsFramework(pathname: string | null = '') {
  const currentPath = pathname ?? '';
  const preference = useSyncExternalStore(
    frameworkPreference.subscribe,
    frameworkPreference.getSnapshot,
    frameworkPreference.getServerSnapshot
  );
  const route = parseDocsNarrativePath(currentPath);
  const routeFramework =
    route?.scope === 'framework' ? route.framework : undefined;
  useEffect(() => {
    if (routeFramework) frameworkPreference.setPreference(routeFramework);
  }, [currentPath, routeFramework]);
  return frameworkForPath(currentPath, preference);
}
