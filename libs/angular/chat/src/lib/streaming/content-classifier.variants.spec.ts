import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { createContentClassifier, type ContentType } from './content-classifier';

interface Row {
  name: string;
  pushes: readonly string[];
  expectedType: ContentType;
}

const rows: Row[] = [
  { name: 'single dash', pushes: ['-'], expectedType: 'pending' },
  { name: 'two dashes', pushes: ['--'], expectedType: 'pending' },
  { name: 'three dashes', pushes: ['---'], expectedType: 'pending' },
  { name: '---a', pushes: ['---a'], expectedType: 'pending' },
  { name: '---a2u', pushes: ['---a2u'], expectedType: 'pending' },
  { name: '---a2ui_JSON--- single chunk', pushes: ['---a2ui_JSON---'], expectedType: 'a2ui' },
  { name: '---a2ui_JSON--- in many chunks', pushes: ['---', 'a2u', 'i_JSON', '---'], expectedType: 'a2ui' },
  { name: 'markdown bullet leading dash space', pushes: ['- bullet'], expectedType: 'markdown' },
  { name: 'markdown HR three dashes space', pushes: ['--- horizontal'], expectedType: 'markdown' },
  { name: 'dash followed by non-prefix char', pushes: ['-x'], expectedType: 'markdown' },
  { name: 'long dash-led plain text', pushes: ['-this is just text leading dashes'], expectedType: 'markdown' },
  { name: 'leading brace', pushes: ['{'], expectedType: 'json-render' },
  { name: 'leading whitespace then brace', pushes: ['\n  {'], expectedType: 'json-render' },
  { name: 'leading whitespace then dash', pushes: ['   -'], expectedType: 'pending' },
  { name: 'empty', pushes: [''], expectedType: 'pending' },
  { name: 'whitespace only', pushes: ['   \n  '], expectedType: 'pending' },
];

describe('ContentClassifier — input variance', () => {
  it.each(rows)('$name', (row) => {
    TestBed.configureTestingModule({});
    let type!: ContentType;
    TestBed.runInInjectionContext(() => {
      const c = createContentClassifier();
      let accumulated = '';
      for (const chunk of row.pushes) {
        accumulated += chunk;
        c.update(accumulated);
      }
      type = c.type();
    });
    expect(type).toBe(row.expectedType);
  });
});
