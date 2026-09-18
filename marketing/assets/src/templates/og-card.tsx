import { CardShell } from './card-shell';
import type { CardInput } from '../types';

export function OgCard(input: CardInput) {
  return <CardShell input={input} headlineSize={72} padding="72px 80px" />;
}
