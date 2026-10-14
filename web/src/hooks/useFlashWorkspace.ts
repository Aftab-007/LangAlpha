import { createElement } from 'react';
import { queryOptions, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { House, Layers, type LucideProps } from 'lucide-react';
import { queryKeys } from '@/lib/queryKeys';
import { getFlashWorkspace } from '@/pages/ChatAgent/utils/api';

/**
 * The query every surface reading `workspaces.flash()` shares, so none can
 * fetch it without the catalog refresh below.
 *
 * The request upserts the row, and the insert switches Home off for every
 * server new workspaces start without, which a catalog read from before it
 * lacks. A fetch with the row already cached cannot be that insert, so only
 * one on an empty cache refetches the catalog.
 */
export function flashWorkspaceQuery(queryClient: QueryClient) {
  return queryOptions({
    queryKey: queryKeys.workspaces.flash(),
    queryFn: async () => {
      const first = queryClient.getQueryData(queryKeys.workspaces.flash()) === undefined;
      const workspace = await getFlashWorkspace();
      if (first) void queryClient.invalidateQueries({ queryKey: queryKeys.mcp.catalog() });
      return workspace;
    },
    // Only its id never changes. Home's computer and folder arrive with its
    // first start or turn, which re-read them into the detail query; read
    // them there.
    staleTime: Infinity,
    // Kept with no reader too, since the app shell reads it only on a click:
    // a fetch on an empty cache counts as the first and refetches the catalog.
    gcTime: Infinity,
  });
}

/**
 * Home as a scope-control option, or `undefined` until it resolves.
 *
 * Home runs on one per-user workspace that the gallery listing hides. It is
 * upserted on first use, so ensure it here: a server can be switched off for
 * Home before the user ever opens a chat there. It is named Home here because
 * "All workspaces" already means every workspace in a plugin's scope.
 */
export function useFlashWorkspace(): { id: string; name: string } | undefined {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data } = useQuery(flashWorkspaceQuery(queryClient));
  const id = data?.workspace_id;
  if (!id) return undefined;
  return { id, name: t('agents.home') };
}

/**
 * What a navigation into the flash workspace tells the chat: its status,
 * since nothing else names the row before it loads. The thread view reads it
 * as Home (ChatView's isHome).
 */
export const FLASH_ROUTE_STATE = { workspaceStatus: 'flash' } as const;

export interface FlashRowIconProps extends LucideProps {
  /** Where the row is named Home, as in a plugin's scope (useFlashWorkspace):
   *  the house that name goes with, since "All workspaces" there already
   *  means every workspace. */
  home?: boolean;
}

/** The flash row's glyph: the stack that reads as All workspaces, or the
 *  house where the row is named Home. */
export function FlashRowIcon({ home = false, ...props }: FlashRowIconProps) {
  return createElement(home ? House : Layers, props);
}
