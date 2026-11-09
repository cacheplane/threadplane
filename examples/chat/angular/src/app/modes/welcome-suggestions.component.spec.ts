import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ChatSelectComponent } from '@threadplane/chat';
import { WelcomeSuggestionsComponent } from './welcome-suggestions.component';
import { suggestionsForAppMode } from './welcome-suggestions';

describe('LangGraph welcome suggestions', () => {
  let fx: ComponentFixture<WelcomeSuggestionsComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [WelcomeSuggestionsComponent] });
    fx = TestBed.createComponent(WelcomeSuggestionsComponent);
    fx.detectChanges();
  });

  function featured(): HTMLButtonElement {
    return fx.nativeElement.querySelector('.welcome-suggestions__featured');
  }

  function catalog(): ChatSelectComponent {
    return fx.debugElement.query(By.directive(ChatSelectComponent)).componentInstance;
  }

  it('shows the featured label and description without requiring hover', () => {
    const prompt = suggestionsForAppMode(false).featured;
    expect(featured().textContent).toContain(prompt.label);
    expect(featured().textContent).toContain(prompt.description);
    expect(featured().getAttribute('aria-label')).toBe(prompt.label);
    expect(featured().getAttribute('aria-description')).toBe(prompt.description);
  });

  it('submits the exact curated value when the description is clicked', () => {
    const values: string[] = [];
    fx.componentInstance.selected.subscribe(value => values.push(value));
    const description = featured().querySelector<HTMLElement>('.welcome-suggestions__description');
    if (!description) throw new Error('Featured prompt description is missing');
    description.click();
    expect(values).toEqual([suggestionsForAppMode(false).featured.value]);
  });

  it('changes the featured prompt and complete catalog for App mode', () => {
    fx.componentRef.setInput('appModeOn', true);
    fx.detectChanges();
    const suggestions = suggestionsForAppMode(true);
    expect(featured().textContent).toContain(suggestions.featured.label);
    expect(catalog().options()).toEqual(
      suggestions.more.map(({ value, label, description }) => ({ value, label, description }))
    );
  });

  it('preserves all remaining prompt labels, descriptions, and submitted values', () => {
    expect(catalog().options()).toEqual(
      suggestionsForAppMode(false).more.map(({ value, label, description }) => ({ value, label, description }))
    );
    const values: string[] = [];
    fx.componentInstance.selected.subscribe(value => values.push(value));
    const value = catalog().options()[0].value;
    catalog().value.set(value);
    expect(values).toEqual([value]);
  });

  it('keeps More prompts as an accessible dropdown', () => {
    const trigger: HTMLButtonElement = fx.nativeElement.querySelector('chat-select button');
    expect(trigger.textContent).toContain('More prompts');
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
    expect(catalog().menuLabel()).toBe('More demo prompts');
  });

  it('uses a curated featured override and ignores unrecognized ids', () => {
    fx.componentRef.setInput('featuredId', 'approve-before-a-destructive');
    fx.detectChanges();
    expect(featured().textContent).toContain(
      suggestionsForAppMode(false, 'approve-before-a-destructive').featured.label
    );
    fx.componentRef.setInput('featuredId', 'not-a-prompt');
    fx.detectChanges();
    expect(featured().textContent).toContain(suggestionsForAppMode(false).featured.label);
    expect(fx.nativeElement.textContent).not.toContain('not-a-prompt');
  });
});
