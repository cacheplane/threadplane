import type {
  ReactRenderRegistry,
  RenderReadinessEntry,
} from '../../render/index.js';
import { A2uiAudioPlayer } from './audio-player.js';
import { A2uiButton } from './button.js';
import { A2uiCard } from './card.js';
import { A2uiCheckBox } from './check-box.js';
import { A2uiChoicePicker } from './choice-picker.js';
import { A2uiColumn } from './column.js';
import { A2uiDateTimeInput } from './date-time-input.js';
import { A2uiDivider } from './divider.js';
import { A2uiIcon } from './icon.js';
import { A2uiImage } from './image.js';
import { A2uiList } from './list.js';
import { A2uiModal } from './modal.js';
import { A2uiRow } from './row.js';
import { A2uiSlider } from './slider.js';
import { A2uiTabs } from './tabs.js';
import { A2uiText } from './text.js';
import { A2uiTextField } from './text-field.js';
import { A2uiVideo } from './video.js';

/**
 * An input waits, like every other component, while a prop such as its label
 * has not arrived; its `value` alone may stay undefined, because the person
 * fills an unseeded field.
 */
const ready: RenderReadinessEntry['isReady'] = (props) =>
  Object.entries(props).every(
    ([key, value]) => key === 'value' || value !== undefined
  );
const input = (
  component: RenderReadinessEntry['component']
): RenderReadinessEntry =>
  Object.freeze({ kind: 'readiness', component, isReady: ready });

/** Every basic component, mounted at once, for a surface whose `pendingFallback` is null. */
const EAGER: ReactRenderRegistry = Object.freeze({
  AudioPlayer: A2uiAudioPlayer,
  Button: A2uiButton,
  Card: A2uiCard,
  CheckBox: A2uiCheckBox,
  ChoicePicker: A2uiChoicePicker,
  Column: A2uiColumn,
  DateTimeInput: A2uiDateTimeInput,
  Divider: A2uiDivider,
  Icon: A2uiIcon,
  Image: A2uiImage,
  List: A2uiList,
  Modal: A2uiModal,
  Row: A2uiRow,
  Slider: A2uiSlider,
  Tabs: A2uiTabs,
  Text: A2uiText,
  TextField: A2uiTextField,
  Video: A2uiVideo,
});

const CATALOG: ReactRenderRegistry = Object.freeze({
  ...EAGER,
  CheckBox: input(A2uiCheckBox),
  ChoicePicker: input(A2uiChoicePicker),
  DateTimeInput: input(A2uiDateTimeInput),
  Slider: input(A2uiSlider),
  TextField: input(A2uiTextField),
});

/**
 * The A2UI basic catalog: Text, Image, Icon, Video, AudioPlayer, Row, Column,
 * List, Card, Divider, Tabs, Modal, TextField, CheckBox, ChoicePicker,
 * DateTimeInput, Slider and Button. Inputs write to the surface's store when `A2uiSurface` is given one;
 * a Button hands its event action to the surface's `onAction`. A component
 * shows a placeholder while a data-bound prop has no value yet, except an
 * input's own `value`.
 */
export function a2uiBasicCatalog(): ReactRenderRegistry {
  return CATALOG;
}

/** The basic catalog without any wait, so every component mounts at once. */
export function a2uiEagerCatalog(): ReactRenderRegistry {
  return EAGER;
}
