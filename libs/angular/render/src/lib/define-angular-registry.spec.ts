import { Component } from '@angular/core';
import { describe, it, expect } from 'vitest';
import { z } from 'zod/v4';
import { defineAngularRegistry } from './define-angular-registry';
import { DefaultFallbackComponent } from './default-fallback.component';

@Component({ selector: 'render-x-real', standalone: true, template: '' })
class RealComponent {}
@Component({ selector: 'render-x-fallback', standalone: true, template: '' })
class CustomFallback {}

describe('defineAngularRegistry / getEntry', () => {
  it('preserves component, fallback, schema, and description for object entries', () => {
    const schema = z.object({ day: z.number() });
    const reg = defineAngularRegistry({
      card: { component: RealComponent, fallback: CustomFallback, schema, description: 'a card' },
    });
    const entry = reg.getEntry('card');
    expect(entry?.component).toBe(RealComponent);
    expect(entry?.fallback).toBe(CustomFallback);
    expect(entry?.schema).toBe(schema);
    expect(entry?.description).toBe('a card');
  });

  it('bare Type entries get the default fallback and no schema', () => {
    const reg = defineAngularRegistry({ plain: RealComponent });
    const entry = reg.getEntry('plain');
    expect(entry?.component).toBe(RealComponent);
    expect(entry?.fallback).toBe(DefaultFallbackComponent);
    expect(entry?.schema).toBeUndefined();
  });

  it('returns undefined for an unregistered name; names() lists keys', () => {
    const reg = defineAngularRegistry({ a: RealComponent });
    expect(reg.getEntry('missing')).toBeUndefined();
    expect(reg.names()).toEqual(['a']);
  });
});
