import {
  createComponent,
  provideZonelessChangeDetection,
  type ComponentRef,
} from '@angular/core';
import { createApplication } from '@angular/platform-browser';
import { AppComponent } from '../angular/src/app.component';
import { APPLICATION } from '../angular/src/application.token';
import { createViewOwner } from './view-owner';

// A single owner lives outside every component creation and destruction.
const { owner, application, controls } = createViewOwner();
const container = document.getElementById('root')!;
const angular = await createApplication({
  providers: [
    provideZonelessChangeDetection(),
    { provide: APPLICATION, useValue: application },
  ],
});
let component: ComponentRef<AppComponent> | undefined;
let host: HTMLElement | undefined;
async function mount() {
  if (component) throw Error('Already mounted');
  host = document.createElement('native-conversation');
  container.append(host);
  component = createComponent(AppComponent, {
    hostElement: host,
    environmentInjector: angular.injector,
  });
  angular.attachView(component.hostView);
  component.changeDetectorRef.detectChanges();
  await angular.whenStable();
}
Object.assign(window, {
  nativeViewProof: {
    ...controls,
    mount,
    unmount() {
      if (component) {
        angular.detachView(component.hostView);
        component.destroy();
        component = undefined;
      }
      host?.remove();
      host = undefined;
    },
  },
});
owner.start();
await mount();
