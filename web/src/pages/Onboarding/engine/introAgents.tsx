import { useTranslation } from 'react-i18next';

/** The two agents' names in the scenes, translated like the intro copy beside
    the scene. */
export function useAgentNames() {
  const { t } = useTranslation();
  return {
    home: t('agents.chiefOfStaff'),
    homeRun: t('agents.intro.chiefOfStaffRun'),
    handoff: t('agents.intro.handoff'),
    taskHandoff: t('agents.intro.taskHandoff'),
    worker: t('agents.analyst'),
    footer: t('agents.intro.footer'),
  };
}
