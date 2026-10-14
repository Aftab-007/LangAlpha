import { useTranslation } from 'react-i18next';
import { useFlashWorkspace } from '@/hooks/useFlashWorkspace';

type AgentMode = string | null | undefined;

export interface AgentModeLabels {
  /** Where an automation runs, in one phrase that names its workspace when
   *  given. Without one it is also the agent picker's choice. */
  label: (mode: AgentMode, workspaceName?: string) => string;
}

/**
 * Where an automation runs, as the reader sees it. The stored modes stay
 * `flash` and `ptc`, and read as a place: All workspaces, where the Chief of
 * Staff runs, or one workspace and its Analyst.
 */
export function useAgentModeLabels(): AgentModeLabels {
  const { t } = useTranslation();
  return {
    label: (mode, workspaceName) => {
      if (mode !== 'ptc') return t('agents.allWorkspaces');
      return workspaceName ? t('agents.inWorkspace', { workspace: workspaceName }) : t('automation.detailWorkspace');
    },
  };
}

/**
 * The mode an automation runs in, for showing and editing it. The Chief of
 * Staff files its automations as `ptc` in Home, which runs where `flash`
 * does, so they read as All workspaces rather than a workspace the lists
 * leave out.
 */
export function useRunsAs() {
  const homeId = useFlashWorkspace()?.id;
  return <M extends AgentMode>(mode: M, workspaceId?: string | null): M | 'flash' =>
    mode === 'ptc' && !!workspaceId && workspaceId === homeId ? 'flash' : mode;
}
