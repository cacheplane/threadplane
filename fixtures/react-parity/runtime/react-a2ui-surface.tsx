import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { A2uiSurface } from '@threadplane/react/a2ui';
import '@threadplane/react/a2ui/styles.css';
import { createA2uiSurfaces, type A2uiSurfaces } from '@threadplane/content/a2ui';

// Only consumers that install the optional A2UI protocol package load this file.
/** One static surface accumulated from wire messages by the installed content package. */
function tripSurface(summary: string) {
  const surfaces = createA2uiSurfaces();
  const messages = [
    { version: 'v0.9', createSurface: { surfaceId: 'trip', catalogId: 'basic' } },
    { version: 'v0.9', updateComponents: { surfaceId: 'trip', components: [
      { id: 'root', component: 'Column', children: ['title', 'card', 'rule', 'row', 'gallery', 'extra'] },
      { id: 'title', component: 'Text', text: 'Lyon trip', variant: 'h2' },
      { id: 'card', component: 'Card', child: 'summary' },
      { id: 'summary', component: 'Text', text: { path: '/summary' } },
      { id: 'rule', component: 'Divider' },
      { id: 'row', component: 'Row', children: ['depart', 'bar', 'time'], justify: 'spaceBetween', align: 'center' },
      { id: 'depart', component: 'Text', text: 'Depart', variant: 'caption' },
      { id: 'bar', component: 'Divider', axis: 'vertical' },
      { id: 'time', component: 'Text', text: '09:40' },
      { id: 'gallery', component: 'List', direction: 'horizontal', align: 'center', children: ['photo', 'pin', 'caption'] },
      { id: 'photo', component: 'Image', url: PHOTO, description: 'Lyon skyline', variant: 'avatar', fit: 'cover' },
      { id: 'pin', component: 'Icon', name: { svgPath: 'M480-80 160-400l320-480 320 480L480-80Z' } },
      { id: 'caption', component: 'Text', text: 'Old town', variant: 'caption' },
      { id: 'extra', component: 'Button', child: 'label', action: { event: { name: 'book' } } },
      { id: 'label', component: 'Text', text: 'Book <b>now</b>' },
    ] } },
    { version: 'v0.9', updateDataModel: { surfaceId: 'trip', path: '/summary', value: summary } },
  ] as unknown as Parameters<A2uiSurfaces['apply']>[0][];
  for (const message of messages) surfaces.apply(message);
  const [surface] = surfaces.getSnapshot().surfaces;
  surfaces.dispose();
  return surface;
}
const PHOTO = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="teal"/></svg>')}`;
const SUMMARIES = ['Two nights in Lyon', 'Three-nights-with-an-unbroken-summary-that-must-wrap-inside-the-card-and-never-widen-the-page'];

function A2uiSurfaceFixture() {
  const [rtl, setRtl] = useState(false);
  const [long, setLong] = useState(false);
  const [surface, setSurface] = useState(() => tripSurface(SUMMARIES[0]));
  return (
    <main dir={rtl ? 'rtl' : 'ltr'}>
      <h1>Installed A2UI surface</h1>
      <label><input type="checkbox" checked={rtl} onChange={(event) => setRtl(event.target.checked)} />Right to left</label>
      <label><input type="checkbox" checked={long} onChange={(event) => { setLong(event.target.checked); setSurface(tripSurface(SUMMARIES[event.target.checked ? 1 : 0])); }} />Long summary</label>
      <A2uiSurface surface={surface} />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<A2uiSurfaceFixture />);
