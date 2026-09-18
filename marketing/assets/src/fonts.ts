import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export interface SatoriFont {
  name: string;
  data: Buffer;
  weight: 400 | 600 | 700;
  style: 'normal';
}

let cached: SatoriFont[] | null = null;

/**
 * The four faces the card kit uses: Archivo Black for display, Archivo 400/600
 * for body, JetBrains Mono 700 for the eyebrow and pills. Same TTFs as
 * `apps/website/src/app/card/fonts/`, which are instanced to a single weight
 * and stripped of the variable tables satori cannot parse.
 *
 * Archivo Black is registered at 400, not 700: it is a single-weight family,
 * and naming it 700 would make satori resolve a bold request to a face that
 * does not contain one.
 */
export async function loadFonts(): Promise<SatoriFont[]> {
  if (cached) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  const fontsDir = join(here, '..', 'fonts');
  const [archivoBlack, archivoReg, archivoSemi, monoBold] = await Promise.all([
    readFile(join(fontsDir, 'ArchivoBlack-Regular.ttf')),
    readFile(join(fontsDir, 'Archivo-Regular.ttf')),
    readFile(join(fontsDir, 'Archivo-SemiBold.ttf')),
    readFile(join(fontsDir, 'JetBrainsMono-Bold.ttf')),
  ]);
  cached = [
    { name: 'Archivo Black', data: archivoBlack, weight: 400, style: 'normal' },
    { name: 'Archivo', data: archivoReg, weight: 400, style: 'normal' },
    { name: 'Archivo', data: archivoSemi, weight: 600, style: 'normal' },
    { name: 'JetBrains Mono', data: monoBold, weight: 700, style: 'normal' },
  ];
  return cached;
}
