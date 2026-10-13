import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { AnimatePresence } from '@/lib/framer';
import { ModalShell } from '@/components/ui/ModalShell';
import { Loader } from '@/components/ui/loader';
import { toast } from '@/components/ui/use-toast';
import {
  ListSkeleton,
  ServerNameLine,
  ServerRowShell,
} from '@/components/mcp/McpPrimitives';
import {
  useBrokerages,
  useMcpCatalog,
  waitForServerTools,
} from '@/hooks/useMcpServers';
import { FLASH_ROUTE_STATE, flashWorkspaceQuery } from '@/hooks/useFlashWorkspace';
import { useLocale } from '@/hooks/useLocale';
import { brokerageArt } from '@/lib/brandArt';
import { formatList } from '@/lib/format';
import { BrandMark } from '@/pages/ChatAgent/components/mcp/BrandMark';
import { McpOauthPill } from '@/pages/ChatAgent/components/mcp/McpStatusPill';
import { warmWorkspace } from '@/pages/ChatAgent/utils/warmWorkspace';
import { connectBlock, resolveBrokerages, type ResolvedBroker } from '@/pages/Plugins/brokerages';
import { LoadFailed } from '@/pages/Plugins/components/LoadFailed';
import { ConnectButton, VendorNotes } from '@/pages/Plugins/components/OauthRowParts';
import { RowNote } from '@/pages/Plugins/components/RowNote';
import { CALLBACK_PARAMS } from '@/pages/Plugins/connectOutcome';
import { useBrokerageConnect } from '@/pages/Plugins/hooks/useBrokerageConnect';
import { spendConnectLanding, useSheetLanding } from '@/pages/Plugins/hooks/useConnectLanding';
import { isPluginSuppressed } from '@/pages/Plugins/utils/provenance';
import { ONBOARDING_CONNECT, ONBOARDING_PARAM } from './useStartOnboarding';

/** How long a connected brokerage may take to show its tools before the
 *  interview starts without them. */
const TOOLS_WAIT_MS = 20_000;

interface Chosen {
  name: string;
  label: string;
}

/**
 * The lazy root the shell mounts. Kept mounted across a close so the sheet can
 * animate out, which needs `AnimatePresence`, which lives off the entry chunk.
 */
export default function OnboardingConnectLayer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return <AnimatePresence>{open && <OnboardingConnectSheet onClose={onClose} />}</AnimatePresence>;
}

/**
 * Step one of onboarding: connect a brokerage, or say there is none, and then
 * open Home with the turn that starts the Chief of Staff's interview.
 *
 * Connecting leaves the app for the vendor and comes back to this same URL,
 * so the sheet is also where the round trip lands: a connect that worked goes
 * straight on to the chat, one that failed or was backed out of says so here.
 */
function OnboardingConnectSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const titleId = useId();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const {
    data: brokerages,
    isLoading: loadingOffers,
    error: offersError,
    refetch: refetchOffers,
  } = useBrokerages();
  const {
    data: catalog,
    isLoading: loadingCatalog,
    error: catalogError,
    refetch: refetchCatalog,
  } = useMcpCatalog();

  // What came of a connect this sheet sent out, as the shell read it off the
  // landing. A failure with no reason is one backed out of at the vendor.
  const landed = useSheetLanding();
  const [failure, setFailure] = useState<{ server: string; reasonKey: string | null } | null>(
    null,
  );
  // The brokerages whose tools the chat is waiting on, or null while the user
  // is still choosing.
  const [waitingFor, setWaitingFor] = useState<string[] | null>(null);
  const waitRef = useRef<AbortController | null>(null);

  // Back to this page with the sheet open, which is what makes the vendor's
  // round trip land where it started.
  const returnParams = new URLSearchParams(location.search);
  for (const key of CALLBACK_PARAMS) returnParams.delete(key);
  returnParams.set(ONBOARDING_PARAM, ONBOARDING_CONNECT);
  const [turningOn, setTurningOn] = useState<string | null>(null);
  const { oauth, requestConnect, toggle } = useBrokerageConnect({
    returnTo: `${location.pathname}?${returnParams}`,
    // The desktop app signs in from the system browser, and its callback
    // brings this page back with the sheet open on the answer.
    onHandedOff: () => close(),
  });

  // The interview runs on Home's computer, and starting one can take a minute.
  useEffect(() => {
    let live = true;
    void queryClient.ensureQueryData(flashWorkspaceQuery(queryClient)).then(
      (home) => (live ? warmWorkspace(home.workspace_id, queryClient, { home: true }) : undefined),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [queryClient]);

  // Closing mid-wait abandons it rather than opening the chat behind the user.
  // At the close itself, since the sheet stays mounted while it animates out
  // and a wait that ends then would still navigate; unmount covers the rest.
  const closedRef = useRef(false);
  function close() {
    closedRef.current = true;
    waitRef.current?.abort();
    onClose();
  }
  useEffect(() => () => waitRef.current?.abort(), []);

  const shipped = brokerages ?? [];
  const resolved = resolveBrokerages(shipped, catalog?.servers ?? []);
  // Left out rather than explained: a broker this app cannot connect here
  // (Robinhood outside the desktop app), or a row whose plugin is switched off
  // and so stays out of the agent's tools whatever this sheet does, is a detour
  // from onboarding, and the Brokerages tab is where its reason is spelled out.
  const rows = [...resolved.values()].filter(
    ({ row, vendor, connected }) =>
      connected ||
      (connectBlock(vendor) === null &&
        (!row || (row.transport === 'http' && !isPluginSuppressed(row)))),
  );
  const connected: Chosen[] = rows
    .filter((r) => r.connected)
    .map(({ b, label }) => ({ name: b.name, label }));
  const listError = offersError ?? catalogError;
  const loading = loadingOffers || loadingCatalog;
  const busy = waitingFor !== null || oauth.connectingName !== null || turningOn !== null;
  const labelFor = (name: string) => resolved.get(name)?.label ?? name;
  const failedLabel = failure ? labelFor(failure.server) : null;

  async function proceed(chosen: Chosen[]) {
    // An aborted wait does not hold the slot: a remount (StrictMode's probe
    // included) starts the continue afresh.
    if (closedRef.current || (waitRef.current && !waitRef.current.signal.aborted)) return;
    const controller = new AbortController();
    waitRef.current = controller;
    setWaitingFor(chosen.map((c) => c.label));
    const home = queryClient.ensureQueryData(flashWorkspaceQuery(queryClient)).catch(() => null);
    // A thread's tools are fixed when it starts, so a turn sent before a fresh
    // connect's discovery lands would run without the brokerage. One already
    // showing its tools has nothing to wait for.
    const pending = chosen.filter((c) => !((resolved.get(c.name)?.row?.tool_count ?? 0) > 0));
    await Promise.all(
      pending.map((c) =>
        waitForServerTools(queryClient, c.name, {
          timeoutMs: TOOLS_WAIT_MS,
          signal: controller.signal,
        }),
      ),
    );
    const workspace = await home;
    if (controller.signal.aborted) return;
    if (!workspace) {
      waitRef.current = null;
      setWaitingFor(null);
      toast({
        variant: 'destructive',
        title: t('common.error'),
        description: t('dashboard.failedOnboarding'),
      });
      return;
    }
    // Replacing the sheet's entry, so Back from the chat returns to the page
    // the user started from rather than to the sheet.
    navigate('/chat/t/__default__', {
      replace: true,
      state: {
        workspaceId: workspace.workspace_id,
        isOnboarding: true,
        onboardingBrokerages: chosen.map((c) => c.label),
        ...FLASH_ROUTE_STATE,
      },
    });
  }

  // A connect that just came back connected goes straight on: connecting was
  // the user's answer to this sheet. Every connected brokerage is named, the
  // new one first, and the new one even before the catalog shows it.
  const take = useEffectEvent((taken: NonNullable<typeof landed>) => {
    if (taken.outcome === 'failed') {
      setFailure({ server: taken.server, reasonKey: taken.reasonKey });
      return;
    }
    const fresh = shipped.find((b) => b.name === taken.server);
    const chosen = fresh
      ? [{ name: fresh.name, label: labelFor(fresh.name) }, ...connected.filter((c) => c.name !== fresh.name)]
      : connected;
    void proceed(chosen);
  });
  const ready = brokerages !== undefined && catalog !== undefined;
  useEffect(() => {
    // A connect waits for the lists, which name what the chat is told about.
    if (!landed || (landed.outcome === 'connected' && !ready)) return;
    if (spendConnectLanding(landed.id)) take(landed);
  }, [landed, ready]);

  // The footnote promises a consent screen, which turning a row back on skips.
  const anyConnectable = rows.some((r) => !r.connected && !r.switchedOff);

  // Picking a broker that was switched off is the ask to use it, and its
  // tokens are intact, so it comes back on without a second consent.
  async function handleTurnOn({ b, row, label }: ResolvedBroker) {
    setFailure(null);
    setTurningOn(b.name);
    const on = await toggle(b, row, true);
    setTurningOn(null);
    if (on) void proceed([{ name: b.name, label }, ...connected.filter((c) => c.name !== b.name)]);
  }

  const footer = (
    <div className="flex items-center justify-end gap-2">
      {connected.length > 0 ? (
        <button
          type="button"
          onClick={() => void proceed(connected)}
          disabled={busy || loading}
          className="px-3 py-1.5 text-xs rounded-md transition-opacity enabled:hover:opacity-90 disabled:opacity-50"
          style={{
            color: 'var(--color-btn-primary-text)',
            backgroundColor: 'var(--color-btn-primary-bg)',
          }}
          data-testid="onboarding-connect-continue"
        >
          {t('onboarding.connect.continue')}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void proceed([])}
          disabled={busy}
          className="px-3 py-1.5 text-xs rounded-md transition-colors enabled:hover:bg-foreground/10 disabled:opacity-50"
          style={{ color: 'var(--color-text-secondary)' }}
          data-testid="onboarding-connect-skip"
        >
          {t('onboarding.connect.skip')}
        </button>
      )}
    </div>
  );

  return (
    <>
      <ModalShell
        labelId={titleId}
        title={t('onboarding.connect.title')}
        subtitle={t('onboarding.connect.description')}
        onClose={close}
        // The page is about to leave for the vendor; closing now would strand
        // a connect this sheet can no longer stop.
        dismissable={oauth.connectingName === null}
        width="narrow"
        footer={footer}
      >
        <div className="flex flex-col gap-3">
          {listError ? (
            <LoadFailed
              what={t(offersError ? 'plugins.loadFailed.brokerages' : 'plugins.loadFailed.mcp')}
              error={listError}
              onRetry={() => {
                if (offersError) void refetchOffers();
                if (catalogError) void refetchCatalog();
              }}
            />
          ) : loading ? (
            <ListSkeleton rows={3} />
          ) : (
            <div className="flex flex-col">
              <AnimatePresence initial={false}>
                {rows.map((broker) => {
                  const { b, row, vendor, connected: isConnected, label, switchedOff } = broker;
                  const rowKey = `onboarding-brokerage-${b.name}`;
                  return (
                    <ServerRowShell
                      key={b.name}
                      testid={rowKey}
                      tile={<BrandMark name={b.name} kind="server" art={brokerageArt(vendor)} />}
                      main={
                        <>
                          <ServerNameLine name={label} />
                          <VendorNotes vendor={vendor} unconnected={!isConnected} rowKey={rowKey} />
                        </>
                      }
                      actions={
                        isConnected ? (
                          <McpOauthPill status="connected" />
                        ) : (
                          <ConnectButton
                            status={row?.oauth_status ?? null}
                            connecting={oauth.connectingName === b.name || turningOn === b.name}
                            // A second connect mid-wait would leave for the
                            // vendor while this one opens the chat.
                            disabled={busy}
                            vendor={vendor}
                            rowKey={rowKey}
                            emphasis={connected.length > 0 ? 'quiet' : 'loud'}
                            testid={`onboarding-connect-${b.name}`}
                            label={switchedOff ? t('onboarding.connect.turnOn') : undefined}
                            onClick={() => {
                              if (switchedOff) {
                                void handleTurnOn(broker);
                                return;
                              }
                              setFailure(null);
                              requestConnect(b, row);
                            }}
                          />
                        )
                      }
                    />
                  );
                })}
              </AnimatePresence>
            </div>
          )}

          {failedLabel && !waitingFor && (
            <div className="flex flex-col gap-0.5" role="alert">
              <RowNote icon={AlertTriangle} tone="warning">
                {t('onboarding.connect.failed', { brokerage: failedLabel })}
              </RowNote>
              {failure?.reasonKey && (
                <p className="text-[0.6875rem] pl-4" style={{ color: 'var(--color-text-tertiary)' }}>
                  {t(failure.reasonKey)}
                </p>
              )}
            </div>
          )}

          {waitingFor && waitingFor.length > 0 ? (
            <p
              className="flex items-center gap-1.5 text-[0.6875rem]"
              style={{ color: 'var(--color-text-secondary)' }}
              aria-live="polite"
            >
              <Loader size={12} className="text-current" label={t('common.loading')} />
              {t('onboarding.connect.waiting', { brokerage: formatList(waitingFor, locale) })}
            </p>
          ) : (
            !loading &&
            !listError &&
            anyConnectable && (
              <p className="text-[0.6875rem]" style={{ color: 'var(--color-text-tertiary)' }}>
                {t('onboarding.connect.footnote')}
              </p>
            )
          )}
        </div>
      </ModalShell>
    </>
  );
}
