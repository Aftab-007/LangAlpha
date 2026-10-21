import type { ReactNode } from 'react';
import { Briefcase, Clock, Eye, Plus, Sparkles, TrendingUp, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ease, useSceneTime } from './clock';
import { Ln, Region, StreamBlock, StreamLn, rv } from './kit';
import { changeAt, upColor, signed, money, INDICES, WATCH, Spark } from './dashboardParts';
import { GRID } from './dashboard';

/* The classic dashboard page, drawn in miniature: index cards, the watchlist
   card and the news column. Shared by the scenes that show the page. Quotes,
   headlines and symbols are invented. */
/* eslint-disable react-refresh/only-export-components -- shared parts:
   scene components plus data and style helpers */

/* ── classic page ──────────────────────────────────────────────────────── */

/** One index card: name, price and change in mono, the day's line in the
    change's color. `reach`/`slid` drive the line on the live page. */
function IndexCard({
  index,
  live,
  reach,
  slid,
}: {
  index: (typeof INDICES)[number];
  live: boolean;
  reach?: number;
  slid?: number;
}) {
  const t = useSceneTime();
  const v = changeAt(index.ticks, t, live);
  return (
    <Region className="flex min-w-0 flex-col gap-[3px] p-1.5">
      <span
        className="truncate text-[0.4375rem] font-bold leading-none"
        style={{ color: 'var(--iv-text)' }}
      >
        {index.name}
      </span>
      <span
        className="font-mono text-[0.5rem] font-bold leading-none tabular-nums"
        style={{ color: 'var(--iv-text)' }}
      >
        {money(index.prev * (1 + v / 100))}
      </span>
      <span
        className={
          'font-mono text-[0.375rem] leading-none tabular-nums transition-colors duration-300'
        }
        style={{ color: upColor(v) }}
      >
        {signed(v)}%
      </span>
      <Spark
        series={index.spark}
        color={upColor(v)}
        reach={reach}
        slid={slid}
        stretch
        className="mt-[2px] h-3 w-full"
      />
    </Region>
  );
}

/** One watchlist row: symbol over its type, price over the day's move, and
    the % change in its tinted pill. */
export function WatchRow({ row, live = false }: { row: (typeof WATCH)[number]; live?: boolean }) {
  const { t: tr } = useTranslation();
  const t = useSceneTime();
  const v = changeAt(row.ticks, t, live);
  const c = upColor(v);
  return (
    <div className="flex items-center gap-1 px-1 py-[3px]">
      <span className="flex min-w-0 flex-col gap-[2px]">
        <span
          className="text-[0.4375rem] font-bold leading-none"
          style={{ color: 'var(--iv-text)' }}
        >
          {row.sym}
        </span>
        <span className="text-[0.3125rem] leading-none" style={{ color: 'var(--iv-text-2)' }}>
          {tr('dashboard.portfolioWatchlistCard.stock')}
        </span>
      </span>
      <span className="ml-auto flex flex-col items-end gap-[2px]">
        <span
          className="font-mono text-[0.4375rem] font-medium leading-none tabular-nums"
          style={{ color: 'var(--iv-text)' }}
        >
          {money(row.prev * (1 + v / 100))}
        </span>
        <span
          className={
            'font-mono text-[0.3125rem] font-medium leading-none tabular-nums transition-colors ' +
            'duration-300'
          }
          style={{ color: c }}
        >
          {signed((row.prev * v) / 100)}
        </span>
      </span>
      <span
        className={
          'min-w-[27px] rounded-[3px] px-[3px] py-[2px] text-center text-[0.375rem] font-bold ' +
          'leading-none tabular-nums transition-colors duration-300'
        }
        style={{
          background: v >= 0 ? 'var(--color-profit-soft)' : 'var(--color-loss-soft)',
          color: c,
        }}
      >
        {signed(v)}%
      </span>
    </div>
  );
}

/** The dashed button closing the watchlist. */
export function AddSymbol() {
  const { t } = useTranslation();
  return (
    <span
      className={
        'mt-1 flex items-center justify-center gap-[3px] rounded-[5px] border border-dashed ' +
        'py-[5px] text-[0.375rem] font-medium leading-none'
      }
      style={{ borderColor: 'var(--color-border-default)', color: 'var(--iv-text-2)' }}
    >
      <Plus className="h-[7px] w-[7px]" />
      {t('dashboard.portfolioWatchlistCard.addSymbol')}
    </span>
  );
}

const BRIEF = ['92%', '84%', '88%', '58%', '76%', '90%', '68%', '82%', '40%'];

export const NEWS = [
  { title: 'Chipmakers rally after earnings beat', age: '2h', hot: true },
  { title: 'Treasury yields slip ahead of jobs data', age: '4h', hot: false },
  { title: 'Oil steadies as supply worries ease', age: '5h', hot: false },
  { title: 'Small caps lag as rate bets shift', age: '6h', hot: false },
  { title: 'Dollar firms ahead of central bank minutes', age: '8h', hot: false },
];

/** A news row: thumbnail, sentiment dot, source and age, headline. */
export function NewsRow({
  item,
  hovered = false,
  children,
}: {
  item: (typeof NEWS)[number];
  hovered?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className="relative flex items-start gap-1.5 rounded px-1 py-1 transition-colors duration-150"
      style={{ background: hovered ? 'var(--color-bg-card-hover)' : 'transparent' }}
    >
      <span
        className="h-[18px] w-6 shrink-0 rounded-[3px]"
        style={{ background: 'var(--color-bg-tag)' }}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="flex items-center gap-[3px]">
          <span
            className="h-[3px] w-[3px] shrink-0 rounded-full"
            style={{ background: item.hot ? 'var(--color-profit)' : 'var(--iv-text-2)' }}
          />
          <Ln w="20px" h={2} />
          <span
            className="flex items-center gap-[2px] text-[0.3125rem] leading-none"
            style={{ color: 'var(--iv-text-3)' }}
          >
            <Clock className="h-[5px] w-[5px]" />
            {item.age}
          </span>
        </span>
        <span
          className="line-clamp-2 text-[0.4375rem] font-medium leading-[1.3]"
          style={{ color: 'var(--iv-text)' }}
        >
          {item.title}
        </span>
      </span>
      {children}
    </div>
  );
}

const NEWS_TABS: { icon: LucideIcon; label: string }[] = [
  { icon: TrendingUp, label: 'dashboard.newsFeedCard.tabMarket' },
  { icon: Briefcase, label: 'dashboard.newsFeedCard.tabPortfolio' },
  { icon: Eye, label: 'dashboard.newsFeedCard.tabWatchlist' },
];

/**
 * The Classic page under the header: title, index cards, then the brief and
 * news on the left and the watchlist and earnings on the right. `live` plays
 * the script (the brief writes itself, the index lines trace in and keep
 * taking points, quotes tick); otherwise it sits on the finished frame.
 */
export function ClassicBody({ live = false }: { live?: boolean }) {
  const { t: tr } = useTranslation();
  const now = useSceneTime();
  const t = live ? now : Number.POSITIVE_INFINITY;
  const slid = GRID.shifts.reduce((s, at) => s + ease(t, at, GRID.shiftDur), 0);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <span
        className="intro-rv mb-1.5 text-[0.6875rem] font-bold leading-none"
        style={{ ...rv(0.05), color: 'var(--iv-text)' }}
      >
        {tr('dashboard.classic.marketOverview')}
      </span>
      <div className="intro-rv grid grid-cols-5 gap-1.5" style={rv(0.1)}>
        {INDICES.map((index, i) => (
          <IndexCard
            key={index.name}
            index={index}
            live={live}
            reach={100 * ease(t, GRID.draw + i * 90, GRID.drawDur)}
            slid={slid}
          />
        ))}
      </div>
      {/* brief and watchlist side by side, then news and earnings under them */}
      <div className="mt-1.5 grid min-h-0 grid-cols-[3fr_2fr] content-start gap-1.5">
        {/* the AI brief, written in */}
        <Region delay={0.22} className="flex min-w-0 flex-col gap-[5px] p-2">
          <span
            className={
              'flex w-fit items-center gap-[3px] rounded-full border px-1 py-[2px] ' +
              'text-[0.3125rem] font-semibold uppercase leading-none tracking-wider'
            }
            style={{
              background: 'var(--color-accent-soft)',
              borderColor: 'var(--color-accent-overlay)',
              color: 'var(--color-accent-light)',
            }}
          >
            <Sparkles className="h-[6px] w-[6px]" />
            {tr('dashboard.brief.eyebrow')}
          </span>
          {/* written in on the live page; elsewhere already there */}
          <div className="flex h-[17px] flex-col gap-[5px]">
            {live ? (
              <>
                <StreamLn w="86%" h={5} c="var(--iv-line-2)" at={GRID.brief} dur={240} />
                <StreamLn w="54%" h={5} c="var(--iv-line-2)" at={GRID.brief + 120} dur={240} />
              </>
            ) : (
              <>
                <Ln w="86%" h={5} c="var(--iv-line-2)" />
                <Ln w="54%" h={5} c="var(--iv-line-2)" />
              </>
            )}
          </div>
          <div className="flex h-[51px] flex-col gap-[3px]">
            {live ? (
              <StreamBlock widths={BRIEF} at={GRID.brief + 300} per={GRID.briefPer} />
            ) : (
              BRIEF.map((w, i) => <Ln key={i} w={w} />)
            )}
          </div>
          <span
            className={
              'mt-auto flex w-fit items-center rounded-[4px] px-1.5 py-[3px] text-[0.375rem] ' +
              'font-semibold leading-none'
            }
            style={{
              background: 'var(--color-btn-primary-bg)',
              color: 'var(--color-btn-primary-text)',
            }}
          >
            {tr('dashboard.brief.readFullBrief')}
          </span>
        </Region>
        <Region delay={0.32} className="flex min-w-0 flex-col p-2">
          <div className="mb-1 flex items-center justify-between gap-1">
            <span
              className="text-[0.5rem] font-bold leading-none"
              style={{ color: 'var(--iv-text)' }}
            >
              {tr('dashboard.portfolioWatchlistCard.headerWatchlist')}
            </span>
            <span className="flex rounded p-[1.5px]" style={{ background: 'var(--color-bg-tag)' }}>
              {['tabWatch', 'tabHoldings'].map((label, i) => (
                <span
                  key={label}
                  className="rounded-[3px] px-1 py-[2px] text-[0.3125rem] font-medium leading-none"
                  style={{
                    background: i === 0 ? 'var(--color-bg-elevated)' : 'transparent',
                    color: i === 0 ? 'var(--iv-text)' : 'var(--iv-text-2)',
                  }}
                >
                  {tr(`dashboard.portfolioWatchlistCard.${label}`)}
                </span>
              ))}
            </span>
          </div>
          {WATCH.map((row) => (
            <WatchRow key={row.sym} row={row} live={live} />
          ))}
          <AddSymbol />
        </Region>
        {/* news and earnings, running on under the floating chat */}
        <Region delay={0.3} className="flex min-w-0 flex-col gap-1 p-2">
          <div className="flex border-b pb-1.5" style={{ borderColor: 'var(--iv-border)' }}>
            <span
              className="flex gap-[2px] rounded p-[2px]"
              style={{ background: 'var(--color-bg-tag)' }}
            >
              {NEWS_TABS.map(({ icon: Icon, label }, i) => (
                <span
                  key={label}
                  className={
                    'flex items-center gap-[2px] rounded-[3px] px-1 py-[2px] text-[0.3125rem] ' +
                    'font-medium leading-none'
                  }
                  style={{
                    background: i === 0 ? 'var(--color-bg-elevated)' : 'transparent',
                    color: i === 0 ? 'var(--iv-text)' : 'var(--iv-text-2)',
                  }}
                >
                  <Icon className="h-[6px] w-[6px]" />
                  {tr(label)}
                </span>
              ))}
            </span>
          </div>
          <NewsRow item={NEWS[0]} />
        </Region>
        <Region delay={0.4} className="flex min-w-0 flex-col gap-1.5 p-2">
          <span
            className="text-[0.5rem] font-bold leading-none"
            style={{ color: 'var(--iv-text)' }}
          >
            {tr('dashboard.widgets.earningsCalendar.title')}
          </span>
          <Ln w="80%" />
          <Ln w="64%" />
        </Region>
      </div>
    </div>
  );
}
