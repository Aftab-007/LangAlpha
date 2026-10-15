import { useTranslation } from 'react-i18next';
import { useHomeWorkspaceId } from '@/hooks/useHomeWorkspace';
import { type PlaceRow, runsInHome, workspaceOf } from '../utils/place';

export interface AutomationPlace {
  /** Home's id, which stands for All workspaces; undefined until it resolves. */
  homeId: string | undefined;
  runsInHome: (row: PlaceRow) => boolean;
  /** The workspace the row runs in (see utils/place). */
  workspaceOf: (row: PlaceRow) => string | null;
  /** Where the row runs, in one phrase that names its workspace when given. */
  label: (row: PlaceRow, workspaceName?: string) => string;
}

/**
 * Where an automation runs, as the reader sees it: All workspaces, where the
 * Chief of Staff runs from Home, or one workspace and its Analyst.
 */
export function useAutomationPlace(): AutomationPlace {
  const { t } = useTranslation();
  const homeId = useHomeWorkspaceId();
  const inHome = (row: PlaceRow) => runsInHome(row, homeId);
  return {
    homeId,
    runsInHome: inHome,
    workspaceOf: (row) => workspaceOf(row, homeId),
    label: (row, workspaceName) => {
      if (inHome(row)) return t('agents.allWorkspaces');
      return workspaceName ? t('agents.inWorkspace', { workspace: workspaceName }) : t('automation.detailWorkspace');
    },
  };
}
