/**
 * Create a computer: a name, where it runs, and its spec.
 *
 * Opened over the Computers dialog, which owns the request and scrolls to the
 * new row once it lands. Mounted only while open, so every opening starts
 * from a blank form. The provider and the tier are locked by plan the same
 * way, and either lock brings up the same way out as the spec dialog. At the
 * plan's computer cap only a machine the user brings is left open, and the
 * Computers dialog opens this form only when one is.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ModalShell } from '@/components/ui/ModalShell';
import { isPlatformMode } from '@/config/hostMode';
import type { ComputerCreate, ComputerProviderOption, ResourceTier, WorkspaceQuota } from '@/types/api';

import { useComputerProviders } from '../hooks/useComputers';
import { useTierQuota } from '../hooks/useTierQuota';
import { COMPUTER_NAME_MAX } from './computerName';
import { SshSetup } from './sshSetup';
import { useSshSetup } from './sshSetupState';
import { PlanUpgradeHint } from './planUpgradeHint';
import {
  computerCapReached,
  defaultProviderKind,
  isProviderLocked,
  providerCountsTowardCap,
  providerLabel,
  providerManagesSpec,
  providerOptions,
} from './providerUi';
import { RadioCardGroup } from './radioCardGroup';
import {
  TIER_ORDER,
  TierRadioGroup,
  isTierBlocked,
  needsBiggerPlan,
  offeredTiers,
  tierCapacity,
  tierLabel,
} from './tierUi';

interface CreateComputerDialogProps {
  onClose: () => void;
  onSubmit: (body: ComputerCreate) => void;
  /** The request is in flight. */
  busy: boolean;
  /** The last refusal, already worded for the user. */
  error: string | null;
}

function CreateComputerDialog({ onClose, onSubmit, busy, error }: CreateComputerDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const formId = useId();
  const nameId = useId();
  const [name, setName] = useState('');
  const [pickedKind, setPickedKind] = useState<string | null>(null);
  const [pickedTier, setPickedTier] = useState<ResourceTier>('standard');
  const errorRef = useRef<HTMLParagraphElement>(null);

  // The SSH summary makes the form taller than the dialog, so a refusal would
  // land below the fold with nothing visible changing.
  useEffect(() => {
    if (error && !busy) errorRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [error, busy]);

  const { data: providerData } = useComputerProviders({ enabled: true });
  const { data: quota } = useTierQuota({ enabled: true });
  const providers = providerData?.providers ?? [];
  // One provider is no choice: the request then names none and the server
  // uses its default, as it does while the list is still loading.
  const choosesProvider = providers.length > 1;

  const atCap = computerCapReached(quota);

  // Derived rather than seeded: the list and the quota land after the form
  // opens and can refetch while it is open, and a pick they have since locked
  // falls back to what is open instead of being sent to earn a 403. So does a
  // size the picked provider does not run.
  const picked = providers.find((p) => p.kind === pickedKind);
  const kind = picked && !isProviderLocked(picked, atCap) ? picked.kind : defaultProviderKind(providers, atCap);
  const offer = offeredTiers(providers.find((p) => p.kind === kind));
  const tier: ResourceTier =
    offer.tiers.includes(pickedTier) && !isTierBlocked(tierCapacity(quota, pickedTier)) ? pickedTier : 'standard';

  const isSsh = kind === 'ssh';
  const ssh = useSshSetup(isSsh);
  // A machine the user brings is sized by them, so its tier is never a pick.
  const managesSpec = kind === null || providerManagesSpec(kind);

  // A size the plan allows that this provider does not run but another open
  // one does (Extra Large, on E2B alone) is named with the way there, in
  // place of the upgrade line: a bigger plan is not what the user lacks.
  const elsewhere = managesSpec && kind !== null ? tierElsewhere(providers, kind, offer.tiers, quota, atCap) : null;
  const capLocked = atCap && providers.some((p) => providerCountsTowardCap(p.kind));
  const providerLocked = choosesProvider && providers.some((p) => isProviderLocked(p));
  const tierLocked = managesSpec && !elsewhere && offer.tiers.some((id) => needsBiggerPlan(quota, id));
  // The cap is the lock in the way of the most, so it is the one named.
  const upgradeLead = capLocked
    ? t('computer.capPlanLimited', 'Need more computers than your plan includes?')
    : providerLocked && tierLocked
      ? t('computer.planLimitedBoth', "Need a provider or spec your plan doesn't include?")
      : providerLocked
        ? t('computer.planLimitedProvider', "Need a provider your plan doesn't include?")
        : tierLocked
          ? t('computer.spec.planLimited', 'Need a bigger spec than your plan includes?')
          : null;
  // The body the form would send, or null while it cannot send one. An SSH
  // machine's comes from its setup and always names its kind, since the
  // server takes a target only with it.
  const trimmedName = name.trim();
  const fields: ComputerCreate | null = isSsh
    ? ssh.create && { ...ssh.create, resource_tier: 'standard', kind }
    : {
      ...(trimmedName ? { name: trimmedName } : {}),
      resource_tier: tier,
      ...(choosesProvider && kind ? { kind } : {}),
    };
  // Every provider on offer locked leaves nothing to create on. The cap locks
  // even a lone provider, which the form shows no choice for.
  const blocked = ((choosesProvider || atCap) && kind === null) || !fields;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy || blocked) return;
    onSubmit(fields);
  };

  const footer = (
    <div className="flex items-center justify-end gap-2">
      <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
        {t('common.cancel')}
      </Button>
      <Button type="submit" form={formId} disabled={busy || blocked} aria-busy={busy}>
        {isSsh
          ? (busy ? t('computer.adding', 'Adding...') : t('computer.add', 'Add computer'))
          : (busy ? t('computer.creating', 'Creating...') : t('computer.create', 'Create computer'))}
      </Button>
    </div>
  );

  return (
    <ModalShell
      labelId={titleId}
      title={t('computer.newComputer', 'New computer')}
      subtitle={t(
        'computer.createDesc',
        'A separate machine with its own files. Workspaces you put on it start and stop with it.',
      )}
      onClose={onClose}
      closeDisabled={busy}
      width="standard"
      density="form"
      stacked
      footer={footer}
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-4">
        {!isSsh && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={nameId} className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              {t('computer.nameLabel', 'Name')}{' '}
              <span className="font-normal" style={{ color: 'var(--color-text-tertiary)' }}>{t('common.optional')}</span>
            </label>
            <Input
              id={nameId}
              value={name}
              maxLength={COMPUTER_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              style={{
                backgroundColor: 'var(--color-bg-input)',
                borderColor: 'var(--color-border-muted)',
                color: 'var(--color-text-primary)',
              }}
            />
          </div>
        )}

        {choosesProvider && (
          <RadioCardGroup
            options={providerOptions(t, providers, atCap).map((o) =>
              // Beside the title, where a lock note would sit; a lock note wins.
              o.value === 'ssh' && !o.note ? { ...o, note: t('computer.ssh.previewLabel', 'Preview') } : o,
            )}
            value={kind}
            onChange={setPickedKind}
            label={t('computer.provider.label', 'Provider')}
            // Side by side keeps the form short; a third provider joins the row.
            columns={providers.length >= 3 ? 3 : 2}
          />
        )}

        {isSsh ? (
          <SshSetup state={ssh} busy={busy} nameMaxLength={COMPUTER_NAME_MAX} />
        ) : (
          <TierRadioGroup
            offer={offer}
            value={tier}
            onChange={setPickedTier}
            label={t('computer.tierLabel', 'Computer spec')}
            quota={quota}
          />
        )}

        {elsewhere && (
          <p className="text-xs" data-testid="create-computer-tier-elsewhere" style={{ color: 'var(--color-text-secondary)' }}>
            {t('computer.tierElsewhere', '{{tier}} is available on {{provider}}.', {
              tier: tierLabel(t, elsewhere.tier),
              provider: providerLabel(elsewhere.kind, t),
            })}{' '}
            <button
              type="button"
              className="underline font-medium"
              style={{ color: 'var(--color-text-primary)' }}
              disabled={busy}
              onClick={() => {
                setPickedKind(elsewhere.kind);
                setPickedTier(elsewhere.tier);
              }}
            >
              {t('computer.switchProvider', 'Switch to {{provider}}', { provider: providerLabel(elsewhere.kind, t) })}
            </button>
          </p>
        )}

        {upgradeLead && <PlanUpgradeHint lead={upgradeLead} testId="create-computer-plan-cta" />}

        {error && !busy && (
          <p ref={errorRef} className="text-sm" role="alert" style={{ color: 'var(--color-icon-danger)' }}>
            {error}
          </p>
        )}
      </form>
    </ModalShell>
  );
}

/**
 * The biggest size the plan has a slot of that `kind` does not run, and the
 * first other open provider that does. A size it lacks or has spent is no
 * reason to switch.
 */
function tierElsewhere(
  providers: readonly ComputerProviderOption[],
  kind: string,
  offered: readonly ResourceTier[],
  quota: WorkspaceQuota | null | undefined,
  atCap: boolean,
): { tier: ResourceTier; kind: string } | null {
  if (!isPlatformMode) return null;
  for (const tier of [...TIER_ORDER].reverse()) {
    const capacity = tierCapacity(quota, tier);
    if (!capacity || isTierBlocked(capacity) || offered.includes(tier)) continue;
    const other = providers.find(
      (p) =>
        p.kind !== kind &&
        providerManagesSpec(p.kind) &&
        !isProviderLocked(p, atCap) &&
        offeredTiers(p).tiers.includes(tier),
    );
    if (other) return { tier, kind: other.kind };
  }
  return null;
}

export default CreateComputerDialog;
