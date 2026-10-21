import type { IntroVisualId } from '../../registry';
import { chatScenes } from './chat';
import { dashboardScenes } from './dashboard';
import { dashboardAttachScenes } from './dashboardAttach';
import { threadScenes } from './thread';
import { workspaceScenes } from './workspaces';
import type { IntroScene } from './types';

export type { IntroScene } from './types';

export const INTRO_SCENES: Record<IntroVisualId, IntroScene> = {
  ...chatScenes,
  ...workspaceScenes,
  ...threadScenes,
  ...dashboardScenes,
  ...dashboardAttachScenes,
};
