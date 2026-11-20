import { InjectionToken } from '@angular/core';
import type { DemoAgent } from './agent-ref';

/**
 * Shared agent provided by `DemoShell` and consumed by routed mode
 * components. Created once per shell mount; survives mode navigations
 * because the router never unmounts the shell.
 */
export const DEMO_AGENT = new InjectionToken<DemoAgent>('DEMO_AGENT');
