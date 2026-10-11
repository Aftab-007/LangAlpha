/**
 * A dispatched run's status as the hand-off card and the composer's report-back
 * list both show it, so a run reads the same on each.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, AlertTriangle, Square } from 'lucide-react';
import { Loader } from '@/components/ui/loader';
import type { PTCDispatchStatus } from '../hooks/usePTCDispatchStatus';

const MONO = 'var(--font-mono)';

/**
 * How each status reads: text + a small glyph, never a filled pill or accent
 * bar. The design system keeps amber annotation-only, and the glyphs match the
 * sidebar's thread rows (ascii spinner = running, hollow ring = needs input) so
 * run state reads the same everywhere.
 */
const STATUS_LOOK: Record<
  PTCDispatchStatus,
  { labelKey: string; glyph: React.ReactNode; labelColor: string }
> = {
  starting: {
    labelKey: 'chat.ptcCard.statusStarting',
    glyph: <LiveSpinner />,
    labelColor: 'var(--color-text-tertiary)',
  },
  running: {
    labelKey: 'chat.ptcCard.statusWorking',
    glyph: <LiveSpinner />,
    labelColor: 'var(--color-text-tertiary)',
  },
  needs_input: {
    labelKey: 'chat.ptcCard.statusNeedsInput',
    glyph: (
      <span aria-hidden className="flex h-3 w-3 shrink-0 items-center justify-center">
        <span className="rounded-full" style={{ width: 7, height: 7, border: '1.5px solid var(--color-accent-primary)' }} />
      </span>
    ),
    labelColor: 'var(--color-accent-primary)',
  },
  completed: {
    labelKey: 'chat.ptcCard.statusCompleted',
    glyph: <Check aria-hidden className="h-3 w-3 shrink-0 stroke-[2.5]" style={{ color: 'var(--color-success)' }} />,
    labelColor: 'var(--color-text-tertiary)',
  },
  failed: {
    labelKey: 'chat.ptcCard.statusFailed',
    glyph: <AlertTriangle aria-hidden className="h-3 w-3 shrink-0" style={{ color: 'var(--color-loss)' }} />,
    labelColor: 'var(--color-loss)',
  },
  stopped: {
    labelKey: 'chat.ptcCard.statusStopped',
    glyph: <Square aria-hidden className="h-2.5 w-2.5 shrink-0" style={{ color: 'var(--color-icon-muted)' }} />,
    labelColor: 'var(--color-text-tertiary)',
  },
};

/** The sidebar's running-thread glyph (amber ascii spinner), reused so "amber
 *  spinner = agent working" reads identically on every surface. The Loader
 *  ships its own role="status"; the aria-hidden wrapper drops it from the a11y
 *  tree, since the text beside the glyph already says what it shows. */
export function LiveSpinner() {
  return (
    <span aria-hidden className="shrink-0">
      <Loader size={12} className="text-(--color-accent-primary)" />
    </span>
  );
}

function fmtElapsed(secs: number): string {
  const m = Math.floor(secs / 60);
  return `${m}:${String(secs % 60).padStart(2, '0')}`;
}

/** Seconds the run has been working: from its start once the server says when
 *  that was, from when this view first saw it running until then. */
function useElapsedSeconds(active: boolean, startedAt: number | undefined): number {
  const [secs, setSecs] = useState(0);
  const seenRef = useRef<number | null>(null);
  useEffect(() => {
    if (!active) {
      seenRef.current = null;
      setSecs(0);
      return;
    }
    if (seenRef.current === null) seenRef.current = Date.now();
    const from = startedAt ?? seenRef.current;
    const tick = () => setSecs(Math.max(0, Math.floor((Date.now() - from) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active, startedAt]);
  return secs;
}

/** A dispatched run's status word and glyph, with the time it has been working
 *  while it runs. */
export function DispatchStatusIndicator({ status, startedAt }: { status: PTCDispatchStatus; startedAt?: number }) {
  const { t } = useTranslation();
  const ui = STATUS_LOOK[status];
  const elapsedSecs = useElapsedSeconds(status === 'running', startedAt);
  const elapsed = status === 'running' ? fmtElapsed(elapsedSecs) : null;
  // One persistent role="status" live region; only the inner glyph/label swap
  // per state. Mounting a fresh live region per state can drop the
  // announcement, so transitions stay reliably announced this way.
  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[0.75rem] font-medium"
      style={{ color: ui.labelColor }}
    >
      {ui.glyph}
      {t(ui.labelKey)}
      {status === 'running' && elapsed && (
        <span aria-hidden className="text-[0.6875rem]" style={{ fontFamily: MONO, color: 'var(--color-text-quaternary)' }}>
          {elapsed}
        </span>
      )}
    </span>
  );
}
