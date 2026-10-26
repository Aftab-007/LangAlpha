/**
 * Who pays the vendor when a turn runs on a model, the answer every model
 * name carries as its badge.
 *
 * The client's copy of the server's ladder (`resolve_model_client`): a model
 * on a subscription provider runs only on that sign-in; any other model runs
 * on the user's own key when one serves it and their keys are switched on,
 * and otherwise on the deployment, which bills credits on a hosted account
 * and spends its own key on a self-hosted one.
 */
import { isPlatformMode } from '@/config/hostMode';
import type { ConfiguredProvider } from '@/hooks/useConfiguredProviders';
import { SERVER_KEY, isOwnKey } from '@/lib/ownKey';
import type { KeyCandidates } from '@/components/model/types';
import type { PlatformModelsResponse } from '@/types/platform';

export type Payer = 'subscription' | 'own_key' | 'credits' | 'server_key';

/** The i18n key of each payer's badge. */
const PAYER_LABEL_KEYS: Record<Payer, string> = {
  subscription: 'payer.subscription',
  own_key: 'payer.ownKey',
  credits: 'payer.credits',
  server_key: 'payer.serverKey',
};

// The plan a sign-in draws on, named as its maker sells it. A bare
// "Subscription" beside "Credits" reads as the user's LangAlpha plan, which is
// where credits come from.
const SUBSCRIPTION_PLANS: Record<string, string> = {
  'claude-oauth': 'Claude',
  'codex-oauth': 'ChatGPT',
  'grok-oauth': 'Grok',
};

/** A payer's badge text. `provider` is the model's, which names the plan a
 *  subscription draws on; a sign-in this list does not know keeps the
 *  generic word. */
export function payerLabel(
  t: (key: string, opts?: Record<string, unknown>) => string,
  payer: Payer,
  provider?: string,
): string {
  const plan = payer === 'subscription' && provider ? SUBSCRIPTION_PLANS[provider] : undefined;
  return plan ? t('payer.plan', { plan }) : t(PAYER_LABEL_KEYS[payer]);
}

/** What a payer reads off a model's manifest entry. */
export interface PayerModel {
  provider?: string;
  access_type?: string;
  tier?: number;
}

export interface PayerContext {
  /** The plan answer, already merged with the user's own connections; null
   *  when there is none (self-hosted, or the service did not answer). */
  platform: PlatformModelsResponse | null;
  configured: readonly ConfiguredProvider[];
  byokEnabled: boolean;
  keyCandidates: Record<string, KeyCandidates>;
}

/** The provider slugs holding a key of the user's, and the ones whose key was
 *  saved with a base URL, which serves whichever model it is found for. */
function ownKeys({ configured, byokEnabled }: PayerContext) {
  const own = byokEnabled
    ? configured.filter((p) => p.access_type !== 'oauth' && isOwnKey(p))
    : [];
  return {
    keyed: new Set(own.map((p) => p.provider)),
    pointed: new Set(own.filter((p) => p.base_url).map((p) => p.provider)),
  };
}

/**
 * Builds the payer of each model for one set of connections. A model with no
 * payer is one nothing serves (locked on the plan, a self-hosted model the
 * deployment holds no key for) or a local server, which nobody pays.
 *
 * `custom` names a model that only the user's own key runs: one they added,
 * whose provider is `provider` here.
 */
export function payerResolver(ctx: PayerContext) {
  const { keyed, pointed } = ownKeys(ctx);
  const served = new Set(
    ctx.configured.filter((p) => p.masked_key === SERVER_KEY).map((p) => p.provider),
  );
  const signIns = new Set(
    ctx.configured.filter((p) => p.access_type === 'oauth').map((p) => p.provider),
  );
  const ownKeyServes = (provider: string, anyKey: boolean) => {
    const { slugs, shared } = ctx.keyCandidates[provider] ?? { slugs: [provider], shared: [provider] };
    return (anyKey ? slugs : shared).some((s) => keyed.has(s)) || slugs.some((s) => pointed.has(s));
  };

  return (meta: PayerModel | undefined, provider: string, custom = false): Payer | undefined => {
    if (meta?.access_type === 'oauth') return 'subscription';
    if (meta?.access_type === 'local') return undefined;
    // A model the user added on a subscription runs on its sign-in.
    if (custom) return signIns.has(provider) ? 'subscription' : 'own_key';
    if (ownKeyServes(provider, false)) return 'own_key';
    if (isPlatformMode) {
      const { platform } = ctx;
      // No plan answer fails open, as the model filter does.
      if (!platform || (meta?.tier ?? 0) <= platform.model_tier) return 'credits';
      return undefined;
    }
    return served.has(provider) ? 'server_key' : undefined;
  };
}

/** The badge for a payer the server reported on the wire (`billing_type`). */
export function payerOfBilling(billing: unknown): Payer | undefined {
  if (billing === 'oauth') return 'subscription';
  if (billing === 'byok') return 'own_key';
  if (billing === 'platform') return isPlatformMode ? 'credits' : 'server_key';
  return undefined;
}
