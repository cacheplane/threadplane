import { Component, DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ɵwhenAgentDevelopmentHost } from '../../../../src/development-host';
// Importing the whole entry point must not touch the page or the agent layer.
import { ChatWelcomeComponent, ɵCHAT_RUNTIME } from '../../public-api';

const ROOT_TOKENS = 'tplane-chat-root-tokens';

/** True once a collector host is registered with the agent layer. */
function hostRegistered(): boolean {
  let registered = false;
  ɵwhenAgentDevelopmentHost(() => (registered = true))();
  return registered;
}

afterEach(() => TestBed.resetTestingModule());

// One ordered story: the registration is process-wide, so each step builds on
// the one before.
describe('the chat runtime', () => {
  it('does nothing when the package is imported', () => {
    expect(document.getElementById(ROOT_TOKENS)).toBeNull();
    expect(hostRegistered()).toBe(false);
  });

  it('does nothing for a component that is not a chat component', () => {
    @Component({ selector: 'chat-test-plain', template: 'plain' })
    class PlainComponent {}
    TestBed.createComponent(PlainComponent);
    expect(document.getElementById(ROOT_TOKENS)).toBeNull();
    expect(hostRegistered()).toBe(false);
  });

  it('sets the chat UI up when the first chat component is created', () => {
    TestBed.createComponent(ChatWelcomeComponent);
    expect(document.getElementById(ROOT_TOKENS)).not.toBeNull();
    expect(hostRegistered()).toBe(true);
  });

  it('adds the root tokens to the application document once', () => {
    const owned = document.implementation.createHTMLDocument('application');
    TestBed.configureTestingModule({
      providers: [{ provide: DOCUMENT, useValue: owned }],
    });
    TestBed.inject(ɵCHAT_RUNTIME);
    TestBed.createComponent(ChatWelcomeComponent);
    expect(owned.querySelectorAll(`#${ROOT_TOKENS}`)).toHaveLength(1);
    expect(document.querySelectorAll(`#${ROOT_TOKENS}`)).toHaveLength(1);
  });
});
