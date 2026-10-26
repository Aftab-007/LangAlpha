import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { payerLabel, type Payer } from '@/lib/modelPayer';

/** Who pays for a turn on a model, set beside its name. Nothing for a model
 *  with no payer, so a caller passes whatever its map holds. `provider` is
 *  the model's, which names a subscription's plan. */
export function PayerBadge({ payer, provider, className }: {
  payer: Payer | undefined;
  provider?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!payer) return null;
  return (
    <span
      className={cn('flex-none rounded px-[5px] py-px text-[0.625rem] font-medium leading-normal', className)}
      style={{ backgroundColor: 'var(--color-bg-tag)', color: 'var(--color-text-tertiary)' }}
    >
      {payerLabel(t, payer, provider)}
    </span>
  );
}
