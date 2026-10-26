import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAvailableModels } from '@/api/model';
import { getModelDisplayName } from '@/components/ui/chat-input.helpers';
import type { ModelMetadataEntry } from '@/hooks/useFilteredModels';
import { CACHE_ONLY_META, queryKeys } from '@/lib/queryKeys';

/**
 * A model's name as the composer pill prints it, for a surface handed a
 * manifest key (a stream event, a saved preference). Read from the catalog
 * the composer already loaded rather than fetched: a shared link has no
 * composer and may have no session to fetch with, and there the key, tidied,
 * will do.
 */
export function useModelName(): (id: string) => string {
  const metadata = useCachedMetadata();
  return useCallback((id: string) => getModelDisplayName(id, metadata), [metadata]);
}

/** A model's provider, read the same way, for the payer named beside it. */
export function useModelProvider(): (id: string) => string | undefined {
  const metadata = useCachedMetadata();
  return useCallback((id: string) => metadata?.[id]?.provider, [metadata]);
}

function useCachedMetadata(): Record<string, ModelMetadataEntry> | undefined {
  const { data } = useQuery({
    queryKey: queryKeys.models.all,
    queryFn: getAvailableModels,
    enabled: false,
    meta: CACHE_ONLY_META,
  });
  return (data as { model_metadata?: Record<string, ModelMetadataEntry> } | undefined)?.model_metadata;
}
