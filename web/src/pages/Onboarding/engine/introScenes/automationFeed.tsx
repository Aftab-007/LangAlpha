import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, ArrowRight } from 'lucide-react';
import { ease, useSceneTime } from './clock';
import { Loader } from './kit';
import { Btn, Excerpt, Grow, INK, Kicker, LinkOut, PriceMeter, RunEntry } from './automationParts';
import { BRIEF_EXCERPT, FAILED, FIRED, NVDA, on, useBook } from './automationBook';

/* The feed's parts at scene scale (`FeedView`, `FeedRail`): the runs of the
   account in automationBook.ts, a day at a time, and the rail beside them. */

/** The run the $180 alert started: it lands at `land`, works, and at
    `done` finishes with what it found. */
export function FiredRun({ land = 0, done = 0 }: { land?: number; done?: number }) {
  const { t } = useTranslation();
  const B = useBook();
  const now = useSceneTime();
  const live = now < done;
  const place = t('agents.allWorkspaces');
  return (
    <Grow p={ease(now, land, 450)}>
      <RunEntry
        time={B.time(10, 12)}
        glyph={
          live ? (
            <Loader color="var(--color-accent-primary)" className="text-[0.5625rem]" />
          ) : undefined
        }
        name={FIRED.name}
        meta={
          live
            ? [
                t('automation.runRunning'),
                place,
                t('automation.startedAgo', { when: B.ago(on(21, 10, 13)) }),
              ].join(' · ')
            : [place, B.took(138_000)].join(' · ')
        }
        excerpt={
          !live && (
            <Grow p={ease(now, done, 450)}>
              <Excerpt>{FIRED.excerpt}</Excerpt>
            </Grow>
          )
        }
        actions={<LinkOut>{t(live ? 'automation.watchLive' : 'automation.openThread')}</LinkOut>}
      />
    </Grow>
  );
}

/** A run of the brief; `delivered` adds where it was sent, from `at`. */
export function BriefRun({
  excerpt = BRIEF_EXCERPT,
  delivered,
  at = 0,
}: {
  excerpt?: string;
  delivered?: string;
  at?: number;
}) {
  const { t } = useTranslation();
  const B = useBook();
  const shown = useSceneTime() >= at;
  return (
    <RunEntry
      time={B.time(8, 0)}
      name={B.brief}
      meta={
        <>
          {[t('agents.allWorkspaces'), B.took(252_000)].join(' · ')}
          {delivered && (
            <span style={{ opacity: shown ? 1 : 0, transition: 'opacity 300ms ease' }}>
              {' · '}
              <span style={{ color: INK.text2 }}>
                {t('automation.deliveredVia', { method: delivered })}
              </span>
            </span>
          )}
        </>
      }
      excerpt={<Excerpt>{excerpt}</Excerpt>}
      actions={<LinkOut>{t('automation.openThread')}</LinkOut>}
    />
  );
}

/** The earnings preview's failed run, with its error and a Retry. */
export function FailedRun() {
  const { t } = useTranslation();
  const B = useBook();
  return (
    <RunEntry
      time={B.time(6, 30)}
      glyph={
        <AlertCircle className="h-[6px] w-[6px]" style={{ color: 'var(--color-icon-danger)' }} />
      }
      name={FAILED.name}
      meta={[t('automation.runFailed'), FAILED.place, B.took(64_000)].join(' · ')}
      excerpt={
        <p
          className="mt-[4px] font-mono text-[0.375rem] leading-[1.5]"
          style={{ color: INK.text2 }}
        >
          {FAILED.error}
        </p>
      }
      actions={
        <>
          <Btn>{t('common.retry')}</Btn>
          <LinkOut>{t('automation.openThread')}</LinkOut>
        </>
      }
    />
  );
}

/** A section of the rail (`FeedRail`): its kicker over a hairline. */
function RailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <Kicker className="border-b pb-[4px]">{title}</Kicker>
      {children}
    </div>
  );
}

/** The rail: what needs attention, Up next, and what is watching. */
export function FeedRail({ attention = true, now }: { attention?: boolean; now?: number }) {
  const { t } = useTranslation();
  const B = useBook(now);
  const rowLine = { borderColor: INK.hair };
  return (
    <div className="flex min-w-0 flex-col gap-[12px]">
      {attention && (
        <RailSection title={t('automation.groupAttention')}>
          <div className="flex items-start gap-[5px] border-b py-[5px]" style={rowLine}>
            <AlertCircle
              className="mt-px h-[6px] w-[6px] shrink-0"
              style={{ color: 'var(--color-icon-danger)' }}
            />
            <div className="min-w-0">
              <div className="text-[0.4375rem] leading-[1.25]" style={{ color: INK.text }}>
                {FAILED.name}
              </div>
              <div className="mt-px text-[0.34375rem] leading-[1.3]" style={{ color: INK.text3 }}>
                {t('automation.lastRunFailedAgo', { when: B.ago(on(21, 6, 31)) })}
              </div>
              <div className="mt-[5px] flex flex-wrap items-center gap-[3px]">
                <Btn>{t('common.retry')}</Btn>
                <Btn>{t('automation.pause')}</Btn>
                <Btn variant="ghost">{t('automation.dismiss')}</Btn>
              </div>
              <div className="mt-[4px] flex">
                <LinkOut>{t('automation.openThread')}</LinkOut>
              </div>
            </div>
          </div>
        </RailSection>
      )}
      <RailSection title={t('automation.upNext')}>
        <div className="grid grid-cols-[max-content_minmax(0,1fr)]">
          {B.upNext.map(([when, name]) => (
            <div
              key={name}
              className="col-span-2 grid grid-cols-subgrid gap-x-[8px] border-b py-[5px]"
              style={rowLine}
            >
              <span
                className="whitespace-nowrap font-mono text-[0.375rem] leading-[1.4] tabular-nums"
                style={{ color: INK.text2 }}
              >
                {B.upcoming(when)}
              </span>
              <span className="text-[0.4375rem] leading-[1.25]" style={{ color: INK.text }}>
                {name}
              </span>
            </div>
          ))}
        </div>
      </RailSection>
      <RailSection title={t('automation.groupWatching')}>
        <div className="border-b py-[6px]" style={rowLine}>
          <div className="flex items-baseline justify-between gap-1">
            <span className="truncate text-[0.4375rem] leading-[1.25]" style={{ color: INK.text }}>
              {B.alert}
            </span>
            <span
              className="shrink-0 font-mono text-[0.34375rem] tabular-nums"
              style={{ color: INK.text3 }}
            >
              {B.away}
            </span>
          </div>
          <div className="mt-[5px]">
            <PriceMeter symbol="NVDA" current={NVDA.price} threshold={190} />
          </div>
        </div>
      </RailSection>
      <span
        className="inline-flex items-center gap-[3px] text-[0.375rem] leading-none"
        style={{ color: INK.text2 }}
      >
        {t('automation.manageAll', { count: attention ? 4 : 3 })}
        <ArrowRight className="h-[6px] w-[6px]" />
      </span>
    </div>
  );
}

/** One day of the feed: its heading over a hairline, then its runs. */
export function Day({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="[&+&]:mt-[10px]">
      <Kicker className="border-b pb-[4px]">{label}</Kicker>
      {children}
    </section>
  );
}

/** The feed view (`FeedView`): runs by day on the left, the rail on the
    right; the column clips at the window's edge, faded as a page runs on. */
export function FeedLayout({ runs, rail }: { runs: ReactNode; rail: ReactNode }) {
  return (
    <div className="mt-[10px] grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_124px] gap-[14px]">
      <div
        className="min-h-0 overflow-hidden"
        style={{
          WebkitMaskImage: 'linear-gradient(180deg, black 82%, transparent 100%)',
          maskImage: 'linear-gradient(180deg, black 82%, transparent 100%)',
        }}
      >
        {runs}
      </div>
      {rail}
    </div>
  );
}
