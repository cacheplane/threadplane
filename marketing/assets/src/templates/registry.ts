import type { ReactElement } from 'react';
import type { CardInput, TemplateId } from '../types';
import { XCard } from './x-card';
import { OgCard } from './og-card';

interface TemplateEntry {
  component: (input: CardInput) => ReactElement;
  width: number;
  height: number;
}

export const TEMPLATES: Record<TemplateId, TemplateEntry> = {
  'x-card': { component: XCard, width: 1200, height: 675 },
  'og-card': { component: OgCard, width: 1200, height: 630 },
};
