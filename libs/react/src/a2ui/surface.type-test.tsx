import type {
  A2uiActionMessage,
  A2uiSurfaces,
  A2uiSurfaceSnapshot,
  A2uiValidationErrorMessage,
  A2uiValue,
} from '@threadplane/content/a2ui';
import type { ReactRenderRegistry } from '../render/index.js';
import {
  A2uiSurface,
  a2uiBasicCatalog,
  useA2uiSurfaceWriter,
  type A2uiSurfaceProps,
  type A2uiSurfaceWriter,
} from './index.js';
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
      readonly surfaces?: A2uiSurfaces;
      readonly onAction?: (message: A2uiActionMessage) => void;
      readonly onValidationError?: (
        error: A2uiValidationErrorMessage
      ) => void;
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
<A2uiSurface
  surface={surface}
  onAction={(message) => {
    const name: string = message.action.name;
    const guest = message.action.context['guest'];
    const model = message.metadata?.a2uiClientDataModel.surfaces['s'];
    void [name, guest, model];
    // @ts-expect-error A message is immutable.
    message.action.name = 'other';
  }}
/>;
// @ts-expect-error The handler receives a message, not a name and context.
<A2uiSurface surface={surface} onAction={(name: string, context: object) => undefined} />;
<A2uiSurface
  surface={surface}
  onValidationError={(error) => {
    const code: 'VALIDATION_FAILED' = error.error.code;
    const path: string | undefined = error.error.path;
    void [code, path, error.error.message];
    // @ts-expect-error An error is immutable.
    error.error.message = 'other';
  }}
/>;
// @ts-expect-error The handler receives an error message, not text.
<A2uiSurface surface={surface} onValidationError={(text: string) => undefined} />;
// @ts-expect-error The catalog is readonly.
a2uiBasicCatalog()['Text'] = () => null;
export type WriterContract = Assert<
  Equal<
    A2uiSurfaceWriter,
    {
      readonly editable: boolean;
      readonly write: (path: string | undefined, value: A2uiValue) => void;
    }
  >
>;
export type WriterHookContract = Assert<
  Equal<typeof useA2uiSurfaceWriter, () => A2uiSurfaceWriter>
>;
declare const surfaces: A2uiSurfaces;
<A2uiSurface surface={surface} surfaces={surfaces} />;
const written: boolean = surfaces.setValue('s', '/form/name', 'Ada');
void written;
surfaces.setValue('s', '/list', [1, { nested: null }]);
// @ts-expect-error A snapshot is not the store that receives edits.
<A2uiSurface surface={surface} surfaces={{ surfaces: [surface] }} />;
// @ts-expect-error The surface does not take edited values back as props.
<A2uiSurface surface={surface} value={{}} />;
// @ts-expect-error The surface does not report each edit to the application.
<A2uiSurface surface={surface} onValueChange={() => undefined} />;
// @ts-expect-error A function is not data.
surfaces.setValue('s', '/x', () => 1);
// @ts-expect-error An edit names a surface, a path and a value.
surfaces.setValue('/x', 1);
declare const writer: A2uiSurfaceWriter;
writer.write('/x', 1);
writer.write(undefined, 'ignored');
// @ts-expect-error The channel is readonly.
writer.editable = true;
