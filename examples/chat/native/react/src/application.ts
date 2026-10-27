import {
  createApplication,
  type ApplicationOptions,
} from '../../shared/application.js';
import { createA2uiMessageContent } from './a2ui-message-content.js';

interface ReactApplicationOptions
  extends Omit<ApplicationOptions, 'contentFactory'> {
  // Private composition seam; the view only receives prepared immutable rows.
  readonly a2ui?: Omit<
    NonNullable<Parameters<typeof createA2uiMessageContent>[0]>,
    'markdownFactory'
  >;
}

export function createReactApplication(options: ReactApplicationOptions) {
  return createApplication({
    ...options,
    contentFactory: () =>
      createA2uiMessageContent({
        ...options.a2ui,
        markdownFactory: options.markdownFactory,
      }),
  });
}

export type ReactApplication = ReturnType<typeof createReactApplication>;
export type ReactApplicationSnapshot = ReturnType<
  ReactApplication['getSnapshot']
>;
