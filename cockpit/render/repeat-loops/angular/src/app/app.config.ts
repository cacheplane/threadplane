import { ApplicationConfig } from '@angular/core';
import { provideRender } from '@threadplane/angular/render';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRender({}),
  ],
};
