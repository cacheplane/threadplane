import { InjectionToken } from '@angular/core';
import type { createApplication } from '../../shared/application';

export type Application = ReturnType<typeof createApplication>;

// The browser entry supplies one stable owner; views only borrow it.
export const APPLICATION = new InjectionToken<Application | null>(
  'Native conversation application'
);
