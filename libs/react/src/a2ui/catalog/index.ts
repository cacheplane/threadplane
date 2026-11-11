import type { ReactRenderRegistry } from '../../render/index.js';
import { A2uiCard } from './card.js';
import { A2uiColumn } from './column.js';
import { A2uiDivider } from './divider.js';
import { A2uiRow } from './row.js';
import { A2uiText } from './text.js';

const CATALOG: ReactRenderRegistry = Object.freeze({
  Card: A2uiCard,
  Column: A2uiColumn,
  Divider: A2uiDivider,
  Row: A2uiRow,
  Text: A2uiText,
});

/**
 * The static part of the A2UI basic catalog: Text, Row, Column, Card and Divider.
 * Spread it into your own registry to add or replace components.
 */
export function a2uiBasicCatalog(): ReactRenderRegistry {
  return CATALOG;
}
