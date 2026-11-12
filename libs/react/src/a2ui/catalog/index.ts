import type { ReactRenderRegistry } from '../../render/index.js';
import { A2uiAudioPlayer } from './audio-player.js';
import { A2uiCard } from './card.js';
import { A2uiColumn } from './column.js';
import { A2uiDivider } from './divider.js';
import { A2uiIcon } from './icon.js';
import { A2uiImage } from './image.js';
import { A2uiList } from './list.js';
import { A2uiRow } from './row.js';
import { A2uiText } from './text.js';
import { A2uiVideo } from './video.js';

const CATALOG: ReactRenderRegistry = Object.freeze({
  AudioPlayer: A2uiAudioPlayer,
  Card: A2uiCard,
  Column: A2uiColumn,
  Divider: A2uiDivider,
  Icon: A2uiIcon,
  Image: A2uiImage,
  List: A2uiList,
  Row: A2uiRow,
  Text: A2uiText,
  Video: A2uiVideo,
});

/**
 * The display part of the A2UI basic catalog: Text, Image, Icon, Video,
 * AudioPlayer, Row, Column, List, Card and Divider. None of them is a control.
 * Spread it into your own registry to add or replace components.
 */
export function a2uiBasicCatalog(): ReactRenderRegistry {
  return CATALOG;
}
