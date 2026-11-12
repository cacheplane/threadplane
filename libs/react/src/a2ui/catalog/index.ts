import type { ReactRenderRegistry } from '../../render/index.js';
import { A2uiAudioPlayer } from './audio-player.js';
import { A2uiCard } from './card.js';
import { A2uiCheckBox } from './check-box.js';
import { A2uiColumn } from './column.js';
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

const CATALOG: ReactRenderRegistry = Object.freeze({
  AudioPlayer: A2uiAudioPlayer,
  Card: A2uiCard,
  CheckBox: A2uiCheckBox,
  Column: A2uiColumn,
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

/**
 * The A2UI basic catalog so far: Text, Image, Icon, Video, AudioPlayer, Row,
 * Column, List, Card, Divider, Tabs, Modal, TextField, CheckBox and Slider.
 * The three inputs write to the surface's store when `A2uiSurface` is given
 * one; none of these sends an action.
 */
export function a2uiBasicCatalog(): ReactRenderRegistry {
  return CATALOG;
}
