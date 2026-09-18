import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { loadFonts } from './fonts';
import { TEMPLATES } from './templates/registry';
import type { CardInput, RenderedCard } from './types';

export async function renderCard(input: CardInput): Promise<RenderedCard> {
  const entry = TEMPLATES[input.template];
  if (!entry) {
    throw new Error(
      `Unknown template "${input.template}". Known: ${Object.keys(TEMPLATES).join(', ')}.`,
    );
  }
  const fonts = await loadFonts();
  const svg = await satori(entry.component(input), {
    width: entry.width,
    height: entry.height,
    fonts: fonts.map((f) => ({
      name: f.name,
      data: f.data,
      weight: f.weight,
      style: f.style,
    })),
  });
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: entry.width } });
  const png = resvg.render().asPng();
  return {
    png: Buffer.from(png),
    width: entry.width,
    height: entry.height,
    contentType: 'image/png',
  };
}
