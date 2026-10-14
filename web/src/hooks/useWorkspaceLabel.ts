import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

interface LabelledWorkspace {
  status?: string | null;
  name?: string | null;
  description?: string | null;
}

export interface WorkspaceText {
  name: string;
  description: string;
  /** The short kind a tile shows beside the date. */
  tag: string;
}

/**
 * A workspace's display text. The per-user flash row is the Chief of Staff's
 * Home, and keeps its stored name "Flash" and description so older clients
 * still know it; the UI calls it "All workspaces", the choice it stands for,
 * and describes that choice.
 */
export function useWorkspaceText(): (workspace: LabelledWorkspace | null | undefined) => WorkspaceText {
  const { t } = useTranslation();
  return useCallback(
    (workspace) => {
      if (workspace?.status === 'flash') {
        return {
          name: t('agents.allWorkspaces'),
          description: t('agents.widgets.allWorkspacesDesc'),
          tag: t('agents.widgets.tagAllWorkspaces'),
        };
      }
      return {
        name: workspace?.name ?? '',
        description: workspace?.description ?? '',
        tag: t('dashboard.widgets.workspacePicker.tagWorkspace'),
      };
    },
    [t],
  );
}

/** A workspace's display name, for a surface that shows only that. */
export function useWorkspaceLabel(): (workspace: LabelledWorkspace | null | undefined) => string {
  const text = useWorkspaceText();
  return useCallback((workspace) => text(workspace).name, [text]);
}
