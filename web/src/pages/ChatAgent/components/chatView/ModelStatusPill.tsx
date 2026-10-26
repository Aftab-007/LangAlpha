import type React from 'react';
import { useTranslation } from 'react-i18next';
import { Loader } from '@/components/ui/loader';
import { useModelName } from '@/hooks/useModelName';
import type { ModelStatus } from '../../session/types';
import { StatusLine } from './StatusLine';

/* Model resilience: the provider is retrying the current
   model, or has fallen back to a secondary. Transient —
   cleared on the first content event, on error, or on stop. */
export function ModelStatusPill({ modelStatus, isLoading }: {
  modelStatus: ModelStatus | null;
  isLoading: boolean;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const name = useModelName();
  if (!(modelStatus && isLoading)) return null;
  return (
    <StatusLine glyph={<Loader size={14} className="text-(--color-accent-primary)" />}>
      {modelStatus.kind === 'retrying'
        ? t('chat.modelRetrying', {
            model: name(modelStatus.model),
            attempt: modelStatus.attempt + 1,
            total: modelStatus.maxRetries + 1,
          })
        : t('chat.modelFallingBack', { model: name(modelStatus.toModel) })}
    </StatusLine>
  );
}
