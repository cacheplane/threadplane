import { CardShell } from './card-shell';
import type { CardInput } from '../types';

export function XCard(input: CardInput) {
  return <CardShell input={input} headlineSize={76} padding="76px 84px" />;
}
