import { useState, useSyncExternalStore } from 'react';
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
      { id: 'root', component: 'Column', children: ['title', 'card', 'rule', 'row', 'gallery', 'legs', 'rules', 'extra'] },
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
      { id: 'legs', component: 'Tabs', tabs: [{ title: 'Outbound', child: 'out' }, { title: { path: '/returnTitle' }, child: 'back' }] },
      { id: 'out', component: 'Text', text: 'Train 6601' },
      { id: 'back', component: 'Text', text: 'Train 6624' },
      { id: 'rules', component: 'Modal', trigger: 'rulesLabel', content: 'rulesBody' },
      { id: 'rulesLabel', component: 'Text', text: 'Fare rules' },
      { id: 'rulesBody', component: 'Text', text: 'Refundable until departure' },
      { id: 'extra', component: 'Button', child: 'label', action: { event: { name: 'book' } } },
      { id: 'label', component: 'Text', text: 'Book <b>now</b>' },
    ] } },
    { version: 'v0.9', updateDataModel: { surfaceId: 'trip', path: '/summary', value: summary } },
    { version: 'v0.9', updateDataModel: { surfaceId: 'trip', path: '/returnTitle', value: 'Return' } },
  ] as unknown as Parameters<A2uiSurfaces['apply']>[0][];
  for (const message of messages) surfaces.apply(message);
  const [surface] = surfaces.getSnapshot().surfaces;
  surfaces.dispose();
  return surface;
}
const PHOTO = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="teal"/></svg>')}`;
const SUMMARIES = ['Two nights in Lyon', 'Three-nights-with-an-unbroken-summary-that-must-wrap-inside-the-card-and-never-widen-the-page'];

/** One long-lived store: the form's edits live here, not in the page. */
const formSurfaces = createA2uiSurfaces();
for (const message of [
  { version: 'v0.9', createSurface: { surfaceId: 'form', catalogId: 'basic' } },
  { version: 'v0.9', updateComponents: { surfaceId: 'form', components: [
    { id: 'root', component: 'Column', children: ['guest', 'greeting', 'notes', 'window', 'party', 'fixed'] },
    { id: 'guest', component: 'TextField', label: 'Guest', value: { path: '/booking/guest' }, placeholder: 'Full name' },
    { id: 'greeting', component: 'Text', text: { path: '/booking/guest' }, variant: 'h3' },
    { id: 'notes', component: 'TextField', label: 'Notes', variant: 'longText', value: { path: '/booking/notes' } },
    { id: 'window', component: 'CheckBox', label: 'Window seat', value: { path: '/booking/window' } },
    { id: 'party', component: 'Slider', label: 'Party', value: { path: '/party' }, min: 1, max: 8 },
    { id: 'fixed', component: 'TextField', label: 'Reference', value: 'LYS-6601' },
  ] } },
  { version: 'v0.9', updateDataModel: { surfaceId: 'form', value: { booking: { guest: 'Ada', notes: '', window: false }, party: 2 } } },
] as unknown as Parameters<A2uiSurfaces['apply']>[0][]) formSurfaces.apply(message);

function FormFixture() {
  const snapshot = useSyncExternalStore(formSurfaces.subscribe, formSurfaces.getSnapshot);
  const [mounted, setMounted] = useState(true);
  const [editable, setEditable] = useState(true);
  const form = snapshot.surfaces[0];
  return (
    <section aria-label="Booking form">
      <button type="button" onClick={() => setMounted((value) => !value)}>Toggle form</button>
      <button type="button" onClick={() => setEditable((value) => !value)}>Toggle editing</button>
      <button type="button" onClick={() => formSurfaces.apply({ version: 'v0.9', updateDataModel: { surfaceId: 'form', path: '/booking/guest', value: 'Agent Smith' } } as unknown as Parameters<A2uiSurfaces['apply']>[0])}>Agent sets guest</button>
      {mounted ? <A2uiSurface surface={form} surfaces={editable ? formSurfaces : undefined} /> : null}
      <output data-testid="form-model" style={{ display: 'block', overflowWrap: 'anywhere' }}>{JSON.stringify(form.dataModel)}</output>
    </section>
  );
}

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
      <FormFixture />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<A2uiSurfaceFixture />);
