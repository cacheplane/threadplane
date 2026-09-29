import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from '../react/src/app';
import { createViewOwner } from './view-owner';
import '../shared/tokens.css';
import '../shared/styles.css';

const { owner, application, controls } = createViewOwner();
const container = document.getElementById('root')!;
let root: Root | undefined;
const mount = () => {
  if (root) throw Error('Already mounted');
  root = createRoot(container);
  root.render(
    <StrictMode>
      <App application={application} />
    </StrictMode>
  );
};
Object.assign(window, {
  nativeViewProof: {
    ...controls,
    mount,
    unmount() {
      root?.unmount();
      root = undefined;
    },
  },
});
owner.start();
mount();
