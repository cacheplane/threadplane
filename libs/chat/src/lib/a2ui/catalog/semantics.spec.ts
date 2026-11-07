import { TestBed } from '@angular/core/testing';
import { RENDER_HOST } from '@threadplane/render';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { A2uiTextComponent } from './text.component';
import { A2uiChoicePickerComponent } from './choice-picker.component';

afterEach(() => TestBed.resetTestingModule());

describe('A2UI catalog semantics', () => {
  it.each([1, 2, 3, 4, 5])('exposes h%i text as a heading', (level) => {
    const fixture = TestBed.createComponent(A2uiTextComponent);
    fixture.componentRef.setInput('text', 'Book a flight');
    fixture.componentRef.setInput('variant', `h${level}`);
    fixture.detectChanges();
    const heading = fixture.nativeElement.querySelector(
      '[role="heading"],h1,h2,h3,h4,h5'
    );
    expect(heading?.textContent).toBe('Book a flight');
    expect(
      heading?.getAttribute('aria-level') ?? heading?.tagName.slice(1)
    ).toBe(String(level));
  });

  it.each(['body', 'caption'])(
    'keeps %s text out of heading navigation',
    (variant) => {
      const fixture = TestBed.createComponent(A2uiTextComponent);
      fixture.componentRef.setInput('variant', variant);
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector('[role="heading"],h1,h2,h3,h4,h5')
      ).toBeNull();
    }
  );

  it.each(['mutuallyExclusive', 'multipleSelection'])(
    'names the %s option group',
    (variant) => {
      TestBed.configureTestingModule({
        providers: [
          {
            provide: RENDER_HOST,
            useValue: { set: vi.fn(), emit: vi.fn(), result: vi.fn() },
          },
        ],
      });
      const fixture = TestBed.createComponent(A2uiChoicePickerComponent);
      fixture.componentRef.setInput('label', 'Origin');
      fixture.componentRef.setInput('variant', variant);
      fixture.componentRef.setInput('options', [
        { label: 'LAX', value: 'LAX' },
        { label: 'JFK', value: 'JFK' },
      ]);
      fixture.detectChanges();
      const group = fixture.nativeElement.querySelector(
        variant === 'mutuallyExclusive'
          ? '[role="radiogroup"]'
          : '[role="group"]'
      );
      expect(group?.getAttribute('aria-label')).toBe('Origin');
      expect(group?.querySelectorAll('input').length).toBe(2);
    }
  );
});
