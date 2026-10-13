/**
 * Where a connect's answer is said once it lands.
 *
 * A sign-in slower than its flow's state lives comes back to the bare Plugins
 * page, since the server's record of where to return went with the state.
 * The connect's own record kept it, so the failure is said where the connect
 * started rather than dropping the user out of what they were doing.
 */
import { beforeEach, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { TFunction } from 'i18next';

vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));

const { markConnectLeft, rememberConnect } = await import('../connectReturn');
const { landConnectReturn } = await import('../connectLanding');
const { useSheetLanding } = await import('../hooks/useConnectLanding');

const t = ((key: string) => key) as unknown as TFunction;
const SHEET = '/dashboard?onboarding=connect';

beforeEach(() => {
  sessionStorage.clear();
});

it('says an expired sign-in on the onboarding sheet it started from', () => {
  window.history.replaceState({}, '', SHEET);
  rememberConnect({
    server: 'ibkr',
    label: 'Interactive Brokers',
    retry: { kind: 'other' },
    desktopOnly: false,
    returnTo: SHEET,
  });
  markConnectLeft('ibkr');

  window.history.replaceState({}, '', '/plugins?mcp_error=invalid_state');
  const navigate = vi.fn();
  landConnectReturn({ t, navigate });

  expect(navigate).toHaveBeenCalledWith(SHEET, { replace: true });
  const { result } = renderHook(() => useSheetLanding());
  expect(result.current).toMatchObject({
    owner: 'sheet',
    server: 'ibkr',
    outcome: 'failed',
    reasonKey: 'plugins.oauth.callbackError.invalid_state',
  });
});

it('forgets a landing and the connects this tab sent out when the account changes', async () => {
  const { runAuthResets } = await import('@/lib/authResets');
  const { setConnectLanding } = await import('../hooks/useConnectLanding');
  rememberConnect({
    server: 'acme',
    label: 'Acme',
    retry: { kind: 'other' },
    desktopOnly: false,
    returnTo: null,
  });
  setConnectLanding({ owner: 'sheet', server: 'acme', outcome: 'failed', reasonKey: null });
  const { result, rerender } = renderHook(() => useSheetLanding());
  expect(result.current).not.toBeNull();

  runAuthResets();
  rerender();

  expect(result.current).toBeNull();
  expect(sessionStorage.getItem('mcp:connect-started')).toBeNull();
});
