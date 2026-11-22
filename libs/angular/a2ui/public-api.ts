// A2UI for the Angular chat UI. `<chat [a2ui]="a2uiRenderer()">` renders A2UI
// content with it; the chat entry point holds none of this code, so an
// application without A2UI bundles none of it.
export { a2uiRenderer, A2uiMessageSurfacesComponent } from './src/message-surfaces.component';
export type { A2uiRendererOptions } from './src/message-surfaces.component';

// A2UI
export { createA2uiSurfaceStore } from './src/surface-store';
export type { A2uiSurfaceStore, A2uiSurfaceState } from './src/surface-store';
export { normalizeViewEntry } from './src/views';
export type { A2uiViewEntry, A2uiViews } from './src/views';
export type { A2uiComponentView } from './src/component-view';
export { createPartialArgsBridge } from './src/partial-args-bridge';
export type { PartialArgsBridge } from './src/partial-args-bridge';
export { normalizeEnvelopeArgs } from './src/envelope-normalizer';
export { A2uiSurfaceComponent } from './src/surface.component';
export { buildA2uiActionMessage } from './src/build-action-message';
export { a2uiBasicCatalog } from './src/catalog/index';
export { emitBinding } from './src/catalog/emit-binding';
export { a2uiClientCapabilities } from './src/capabilities';

// A2UI catalog components (for custom catalog composition via withViews)
export { A2uiTextFieldComponent } from './src/catalog/text-field.component';
export { A2uiCheckBoxComponent } from './src/catalog/check-box.component';
export { A2uiButtonComponent } from './src/catalog/button.component';
export { A2uiChoicePickerComponent } from './src/catalog/choice-picker.component';
export { A2uiSliderComponent } from './src/catalog/slider.component';
export { A2uiDateTimeInputComponent } from './src/catalog/date-time-input.component';
export { A2uiTextComponent } from './src/catalog/text.component';
export { A2uiIconComponent } from './src/catalog/icon.component';
export { A2uiImageComponent } from './src/catalog/image.component';
export { A2uiColumnComponent } from './src/catalog/column.component';
export { A2uiRowComponent } from './src/catalog/row.component';
export { A2uiCardComponent } from './src/catalog/card.component';
export { A2uiDividerComponent } from './src/catalog/divider.component';
export { A2uiListComponent } from './src/catalog/list.component';
export { A2uiModalComponent } from './src/catalog/modal.component';
export { A2uiTabsComponent } from './src/catalog/tabs.component';
export { A2uiAudioPlayerComponent } from './src/catalog/audio-player.component';
export { A2uiVideoComponent } from './src/catalog/video.component';

// A2UI types (re-exported from @threadplane/a2ui for convenience)
export type {
  A2uiActionMessage, A2uiErrorMessage, A2uiClientDataModel, A2uiClientCapabilities,
  A2uiSurface, A2uiComponent, A2uiComponentBase, A2uiCatalogComponent, A2uiTheme,
  DynamicString, DynamicNumber, DynamicBoolean, DynamicStringList, DynamicValue,
  A2uiChildren, A2uiAction, A2uiEventAction, A2uiFunctionAction, A2uiCheck,
  A2uiPathRef, A2uiFunctionCall,
} from '@threadplane/a2ui';
export {
  isPathRef, isFunctionCall,
  A2UI_WIRE_VERSION, A2UI_MIME_TYPE, A2UI_BASIC_CATALOG_ID,
} from '@threadplane/a2ui';
