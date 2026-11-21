import { ApplicationConfig } from '@angular/core';
import { provideRender } from '@threadplane/angular/render';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRender({
      functions: {
        formatDate: (args: Record<string, unknown>) => new Date(args['value'] as string).toLocaleDateString(),
        uppercase: (args: Record<string, unknown>) => (args['value'] as string).toUpperCase(),
        multiply: (args: Record<string, unknown>) => (args['a'] as number) * (args['b'] as number),
        reverse: (args: Record<string, unknown>) => (args['value'] as string).split('').reverse().join(''),
      },
    }),
  ],
};
