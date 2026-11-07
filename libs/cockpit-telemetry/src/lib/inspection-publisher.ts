import { InjectionToken } from '@angular/core';
import type { InspectionFrame } from '@threadplane/cockpit-runtime-bridge';

/** A local, optional observation channel, independent of analytics and credentials. */
export const COCKPIT_INSPECTION_PUBLISHER = new InjectionToken<
  ((frame: InspectionFrame) => void) | null
>('COCKPIT_INSPECTION_PUBLISHER', { providedIn: 'root', factory: () => null });
