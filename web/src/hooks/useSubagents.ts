import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from '@/components/ui/use-toast';
import { queryKeys } from '../lib/queryKeys';
import {
  deleteSubagent,
  formatApiErrorDetail,
  getSubagents,
  isSubagentVersionConflict,
  putSubagent,
  SUBAGENT_INHERIT,
  type SubagentFields,
  type SubagentsResponse,
  type SubagentView,
} from '../pages/ChatAgent/utils/api';

/**
 * React Query hooks for the Subagents pane. One list entry holds every
 * subagent, so every write lands back in it: the PUT's answer replaces its
 * row, then the list is re-read, since one write can change another row's
 * problems (a description that now matches, a name that now collides).
 *
 * Writes share one mutation scope, so they reach the server in the order the
 * user made them and each carries the version the one before it produced.
 * Two switches flipped in a row would otherwise both send the version they
 * were clicked on, and the second would be refused as a conflict with the
 * first.
 */

const WRITE_SCOPE = { id: 'subagents' };

export function useSubagents() {
  return useQuery({
    queryKey: queryKeys.subagents.list(),
    queryFn: getSubagents,
    staleTime: 30_000,
    // The agent edits these files mid-thread, and the main agent's settings
    // and each row's problems follow what the user changes in Settings, both
    // away from this page, so a surface showing the list re-reads it when it
    // appears or the window regains focus, even while fresh.
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  });
}

function cachedList(qc: QueryClient): SubagentsResponse | undefined {
  return qc.getQueryData<SubagentsResponse>(queryKeys.subagents.list());
}

function cachedView(qc: QueryClient, name: string): SubagentView | undefined {
  return cachedList(qc)?.subagents.find((s) => s.name === name);
}

function putRow(qc: QueryClient, view: SubagentView) {
  qc.setQueryData<SubagentsResponse>(queryKeys.subagents.list(), (prev) => {
    if (!prev) return prev;
    const at = prev.subagents.findIndex((s) => s.name === view.name);
    const subagents =
      at < 0
        ? [...prev.subagents, view]
        : prev.subagents.map((s, i) => (i === at ? view : s));
    return { ...prev, subagents };
  });
}

/**
 * What a patch shows before the server answers. A null clears the user's
 * value, which on a base means the base's own, and on a custom one means
 * following the thread; `inherit` follows the thread either way.
 */
function applyFields(view: SubagentView, fields: SubagentFields): SubagentView {
  const next: Record<string, unknown> = { ...view };
  for (const [key, value] of Object.entries(fields)) {
    next[key] =
      value === SUBAGENT_INHERIT
        ? null
        : value === null && view.base && key in view.base
          ? view.base[key as keyof typeof view.base]
          : value;
  }
  return next as unknown as SubagentView;
}

function invalidate(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: queryKeys.subagents.all });
}

/** Says a write was refused because the file moved under it, and re-reads. */
function useConflictToast() {
  const { t } = useTranslation();
  return (err: unknown) => {
    if (isSubagentVersionConflict(err)) {
      toast({
        title: t('plugins.subagents.conflictTitle'),
        description: t('plugins.subagents.conflictBody'),
      });
      return true;
    }
    return false;
  };
}

export interface SubagentPatch {
  name: string;
  fields: SubagentFields;
}

/**
 * One control's write to an existing subagent. Shown at once and read back
 * from the server's answer; a refusal puts the list back as the server has it.
 */
export function usePatchSubagent() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const conflict = useConflictToast();
  return useMutation({
    scope: WRITE_SCOPE,
    mutationFn: ({ name, fields }: SubagentPatch) => {
      // Read when the write runs, not when it was asked for: an earlier write
      // in the scope has replaced the version by then.
      const version = cachedView(qc, name)?.version ?? null;
      return putSubagent(name, { version, fields });
    },
    onMutate: async ({ name, fields }) => {
      await qc.cancelQueries({ queryKey: queryKeys.subagents.list() });
      const view = cachedView(qc, name);
      if (view) putRow(qc, applyFields(view, fields));
    },
    onSuccess: (view) => {
      putRow(qc, view);
      invalidate(qc);
    },
    onError: (err) => {
      invalidate(qc);
      if (conflict(err)) return;
      toast({
        variant: 'destructive',
        title: t('plugins.subagents.saveFailed'),
        description: formatApiErrorDetail(err),
      });
    },
  });
}

/**
 * A new custom subagent, blank or copied from another. The caller shows a
 * refused field beside the field, so this only lands the row.
 */
export function useCreateSubagent() {
  const qc = useQueryClient();
  return useMutation({
    scope: WRITE_SCOPE,
    mutationFn: ({
      name,
      startFrom,
      fields,
    }: {
      name: string;
      startFrom: string | null;
      fields: SubagentFields;
    }) => putSubagent(name, { version: null, start_from: startFrom, fields }),
    onSuccess: (view) => {
      putRow(qc, view);
      invalidate(qc);
    },
    onError: () => invalidate(qc),
  });
}

/**
 * Text the user drafted. The caller first checks that the saved text is still
 * what the draft started from, so this sends the latest version: a switch
 * flipped while typing must not refuse the save. A refusal keeps the draft,
 * and the caller says why beside it.
 */
export function useSaveSubagentText() {
  const qc = useQueryClient();
  return useMutation({
    scope: WRITE_SCOPE,
    mutationFn: ({ name, fields }: SubagentPatch) => {
      const version = cachedView(qc, name)?.version ?? null;
      return putSubagent(name, { version, fields });
    },
    onSuccess: (view) => {
      putRow(qc, view);
      invalidate(qc);
    },
    onError: () => invalidate(qc),
  });
}

/** Deletes a custom subagent, or drops a base's override (the reset). */
export function useDeleteSubagent() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const conflict = useConflictToast();
  return useMutation({
    scope: WRITE_SCOPE,
    mutationFn: (name: string) => {
      const version = cachedView(qc, name)?.version ?? '';
      return deleteSubagent(name, version);
    },
    onSuccess: () => invalidate(qc),
    onError: (err) => {
      invalidate(qc);
      if (conflict(err)) return;
      toast({
        variant: 'destructive',
        title: t('plugins.subagents.saveFailed'),
        description: formatApiErrorDetail(err),
      });
    },
  });
}

/** The bulk bar's radius: one list, re-read once after the whole run. */
export function invalidateSubagents(qc: QueryClient) {
  invalidate(qc);
}
