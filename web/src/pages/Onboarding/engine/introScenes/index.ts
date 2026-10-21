import type { IntroVisualId } from '../../registry';
import { automationScenes } from './automations';
import { chatScenes } from './chat';
import { dashboardScenes } from './dashboard';
import { dashboardAttachScenes } from './dashboardAttach';
import { marketScenes } from './market';
import { threadScenes } from './thread';
import { threadChartScenes } from './threadChart';
import { threadFileScenes } from './threadFiles';
import { workspaceScenes } from './workspaces';
import type { IntroScene } from './types';

export type { IntroScene } from './types';

export const INTRO_SCENES: Record<IntroVisualId, IntroScene> = {
  ...chatScenes,
  ...workspaceScenes,
  ...threadFileScenes,
  ...threadChartScenes,
  ...threadScenes,
  ...dashboardScenes,
  ...dashboardAttachScenes,
  ...marketScenes,
  ...automationScenes,
};
