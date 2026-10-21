import type { IntroVisualId } from '../../registry';
import { chatScenes } from './chat';
import { dashboardScenes } from './dashboard';
import { threadScenes } from './thread';
import type { IntroScene } from './types';

export type { IntroScene } from './types';

export const INTRO_SCENES: Record<IntroVisualId, IntroScene> = {
  ...chatScenes,
  ...threadScenes,
  ...dashboardScenes,
};
