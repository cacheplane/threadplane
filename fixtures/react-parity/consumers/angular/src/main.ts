import { Component } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import * as angular from '@threadplane/angular';
/* PACKAGE_IMPORTS */

@Component({
  selector: 'app-root',
  standalone: true,
  template: '<p>Private Angular scaffold: {{ supportedExportCount }} supported exports.</p>',
})
class App {
  readonly supportedExportCount = Object.keys(angular).length /* PACKAGE_EXPORT_COUNT */;
}

bootstrapApplication(App).catch(console.error);
