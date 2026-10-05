/**
 * Social card for ag-ui.threadplane.ai. Exported into
 * examples/ag-ui/angular/public/social-card.png by scripts/export-demo-cards.mjs;
 * the demo's index.html points og:image at that committed file, not here.
 *
 * Static, so a Satori markup error fails `nx build website` instead of
 * 500ing in public.
 */
import { demoMeta } from '../../../lib/demo-meta';
import { renderDemoCard } from '../../card/demo-card';

export const dynamic = 'force-static';
export const runtime = 'nodejs';

export async function GET() {
  return renderDemoCard(demoMeta('ag-ui'));
}
