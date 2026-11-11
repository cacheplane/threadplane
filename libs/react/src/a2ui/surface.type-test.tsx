import type { A2uiSurfaceSnapshot } from '@threadplane/content/a2ui';
import type { ReactRenderRegistry } from '../render/index.js';
import { A2uiSurface, a2uiBasicCatalog, type A2uiSurfaceProps } from './index.js';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Assert<T extends true> = T;
export type PropsContract = Assert<
  Equal<
    A2uiSurfaceProps,
    {
      readonly surface: A2uiSurfaceSnapshot;
      readonly catalog?: ReactRenderRegistry;
      readonly className?: string;
    }
  >
>;
export type CatalogContract = Assert<
  Equal<typeof a2uiBasicCatalog, () => ReactRenderRegistry>
>;
declare const surface: A2uiSurfaceSnapshot;
const props: A2uiSurfaceProps = { surface };
<A2uiSurface {...props} />;
<A2uiSurface surface={surface} catalog={a2uiBasicCatalog()} className="mine" />;
// @ts-expect-error Props are readonly.
props.surface = surface;
// @ts-expect-error A surface is required.
<A2uiSurface />;
// @ts-expect-error The whole surfaces snapshot is not one surface.
<A2uiSurface surface={{ surfaces: [surface] }} />;
// @ts-expect-error A catalog maps names to components, not to elements.
<A2uiSurface surface={surface} catalog={{ Text: <span /> }} />;
// @ts-expect-error Actions are not handled by this read-only surface.
<A2uiSurface surface={surface} onAction={() => undefined} />;
// @ts-expect-error The catalog is readonly.
a2uiBasicCatalog()['Text'] = () => null;
