import type { PlainValue } from './tool.js';

/** Authored source metadata, owned by a snapshot. Strings are display data,
 * not a certification of safe navigation, HTML or source accuracy. */
export interface Citation {
  readonly id: string;
  readonly index: number;
  readonly title?: string;
  readonly url?: string;
  readonly snippet?: string;
  readonly sourceType?: string;
  readonly iconUrl?: string;
  readonly publishedAt?: string | number;
  readonly extra?: Readonly<Record<string, PlainValue>>;
}
