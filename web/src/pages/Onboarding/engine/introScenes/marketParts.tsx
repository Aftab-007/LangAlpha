import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowUp,
  BarChart3,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Info,
  Menu,
  MessageSquare,
  Mic,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  SquareDashedMousePointer,
  X,
} from 'lucide-react';
import { useLocale } from '@/hooks/useLocale';
import { fixed2, signedFixed2 } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  ClearButton,
  Intervals,
  NVDA_LAST,
  NVDA_PREV,
  Segmented,
  SelectionTools,
  ToolBtn,
} from './candles';
import { useSceneTime } from './clock';
import { Appear, Caret, Frame, Ln } from './kit';

/* The MarketView page the market intro's scenes play on, after
   pages/MarketView: the stock header and its metrics over the chart and its
   toolbar, the watchlist and portfolio sidebar, and the chat panel on the
   right with its empty state, selection chips and composer. Widths and
   heights are fixed so the scripted pointer lands where the parts are. */
/* eslint-disable react-refresh/only-export-components -- shared parts:
   page components plus layout constants and quotes */

/* ── layout ────────────────────────────────────────────────────────────── */

/** The page's top left in the 400px scene: past the frame's border, the
    rail and the topbar. Pointer paths are measured from the scene's corner. */
export const ORIGIN = { x: 29, y: 29 };
export const CONTENT_W = 370;
const CONTENT_H = 300;
const METRICS_H = 40;
const TOOLS_H = 20;
/** The chart's top and height, under the metrics and the toolbar. */
export const CHART_Y = ORIGIN.y + METRICS_H + TOOLS_H;
export const CHART_H = CONTENT_H - METRICS_H - TOOLS_H;

/** How wide the sidebar and the chat panel are (each with its left border);
    the chart takes the rest. */
export interface Layout {
  sidebar: number;
  chat: number;
}
/** The sidebar open, as the page first shows it. */
export const OPEN: Layout = { sidebar: 86, chat: 90 };
/** The sidebar folded to its strip, the chat panel given the room. */
export const FOLDED: Layout = { sidebar: 15, chat: 148 };
export const chartWidth = (l: Layout) => CONTENT_W - l.sidebar - l.chat;

/** The toolbar's right group, laid from the right: the mode switch, the menu,
    the tools, then Price level and Region. */
const MODE_W = 48;
const BTN = 11;
const GAP = 2;
const PAD_X = 5;
/** The Region button's center in the scene. */
export function regionButton(l: Layout): { x: number; y: number } {
  const right = ORIGIN.x + chartWidth(l) - PAD_X;
  return {
    x: right - MODE_W - 3 * (BTN + GAP) - GAP - BTN / 2,
    y: ORIGIN.y + METRICS_H + TOOLS_H / 2 - 0.5,
  };
}

/** The chat composer's send button in the scene. */
export const SEND = { x: ORIGIN.x + CONTENT_W - 21, y: ORIGIN.y + CONTENT_H - 21 };

/* ── quotes ────────────────────────────────────────────────────────────── */

/** What the stock header prints for a symbol. */
export interface Quote {
  sym: string;
  name: string;
  prev: number;
  open: number;
  low: number;
  high: number;
  hi52: number;
  lo52: number;
  avgVol: string;
  vol: string;
}

export const NVDA_QUOTE: Quote = {
  sym: 'NVDA',
  name: 'NVIDIA Corp',
  prev: NVDA_PREV,
  open: 180.4,
  low: 180.15,
  high: 183.05,
  hi52: 195.62,
  lo52: 86.62,
  avgVol: '181.52M',
  vol: '143.08M',
};

export const AAPL_QUOTE: Quote = {
  sym: 'AAPL',
  name: 'Apple Inc',
  prev: 226.8,
  open: 227.1,
  low: 225.88,
  high: 227.95,
  hi52: 237.49,
  lo52: 164.08,
  avgVol: '52.41M',
  vol: '38.77M',
};

/** A watchlist or portfolio row: the move is the day's change for the
    watchlist, the unrealized P/L for a holding. */
export interface Row {
  sym: string;
  price: number;
  pct: number;
}

/** The watchlist the dashboard scenes show, at the same prices. */
export const WATCHLIST: Row[] = [
  { sym: 'NVDA', price: NVDA_LAST, pct: 1.61 },
  { sym: 'AAPL', price: 226.62, pct: -0.08 },
  { sym: 'TSLA', price: 253.19, pct: 2.05 },
  { sym: 'MSFT', price: 432.67, pct: 0.34 },
  { sym: 'AMZN', price: 187.97, pct: 0.84 },
];

export const PORTFOLIO: Row[] = [
  { sym: 'NVDA', price: NVDA_LAST, pct: 64.2 },
  { sym: 'AVGO', price: 349.8, pct: 31.85 },
  { sym: 'MSFT', price: 432.67, pct: 12.4 },
  { sym: 'AMD', price: 158.21, pct: -4.65 },
];

const tone = (v: number) => (v >= 0 ? 'var(--color-profit)' : 'var(--color-loss)');

/* ── the topbar band: stock header, sidebar tabs, chat header ──────────── */

/** The stock header's top (`StockHeader`): the symbol switcher, the names,
    the exchange and the live dot over the Company Overview pill; the price
    and the day's change on the right. `open` holds the switcher pressed
    while its search is up. */
function StockTop({ quote: q, last, open }: { quote: Quote; last: number; open: boolean }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const change = last - q.prev;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 px-2">
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <div className="flex min-w-0 items-center gap-[5px] leading-none">
          <span
            className="flex shrink-0 items-center gap-[1px] rounded-[2px] px-[1px] text-[0.5625rem] font-semibold"
            style={{
              color: 'var(--iv-text)',
              background: open ? 'var(--color-bg-hover)' : undefined,
            }}
          >
            {q.sym}
            <ChevronDown className="h-[6px] w-[6px]" style={{ color: 'var(--color-icon-muted)' }} />
          </span>
          <span className="min-w-0 truncate text-[0.4375rem]" style={{ color: 'var(--iv-text-2)' }}>
            {q.name}
          </span>
          <span
            className="shrink-0 rounded-[2px] px-[3px] py-[1.5px] text-[0.3125rem]"
            style={{ background: 'var(--color-bg-tag)', color: 'var(--iv-text-2)' }}
          >
            NASDAQ
          </span>
          <span
            className="flex shrink-0 items-center gap-[2px] text-[0.3125rem]"
            style={{ color: 'var(--iv-text-2)' }}
          >
            <span
              className="h-[3px] w-[3px] rounded-full"
              style={{ background: 'var(--color-profit)' }}
            />
            {t('marketView.quote.live')}
          </span>
        </div>
        <span
          className="flex w-fit items-center gap-[2px] rounded-[3px] border px-[4px] py-[1.5px] text-[0.3125rem] leading-none"
          style={{ borderColor: 'var(--color-border-default)', color: 'var(--iv-text-2)' }}
        >
          <Info className="h-[5px] w-[5px]" />
          {t('marketView.companyOverview')}
        </span>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-[2px] leading-none tabular-nums">
        <span className="text-[0.6875rem] font-semibold" style={{ color: tone(change) }}>
          {fixed2(last, locale)}
          <span
            className="ml-[2px] text-[0.3125rem] font-normal"
            style={{ color: 'var(--iv-text-2)' }}
          >
            USD
          </span>
        </span>
        <span className="text-[0.375rem] font-medium" style={{ color: tone(change) }}>
          {signedFixed2(change, locale)} {signedFixed2((change / q.prev) * 100, locale)}%
        </span>
      </div>
    </div>
  );
}

/** The sidebar's tabs, Watchlist and Portfolio, the open one underlined in
    the accent, and the fold chevron. Folded, the strip has no tabs. */
function SidebarTabs({ width, tab }: { width: number; tab: 'watchlist' | 'portfolio' | null }) {
  const { t } = useTranslation();
  const tabs = [
    { id: 'watchlist', label: t('marketView.header.watchlist') },
    { id: 'portfolio', label: t('marketView.sidebar.portfolio') },
  ] as const;
  return (
    <div
      className="flex shrink-0 items-stretch border-l"
      style={{ width, borderColor: 'var(--iv-border)', background: 'var(--color-bg-card)' }}
    >
      {tab &&
        tabs.map(({ id, label }) => (
          <span
            key={id}
            className="relative flex flex-1 items-center justify-center text-[0.4375rem] font-medium leading-none"
            style={{ color: id === tab ? 'var(--iv-text)' : 'var(--iv-text-2)' }}
          >
            {label}
            {id === tab && (
              <span
                className="absolute inset-x-0 bottom-0 h-[1.5px]"
                style={{ background: 'var(--color-accent-primary)' }}
              />
            )}
          </span>
        ))}
      {tab && (
        <span
          className="flex w-3 items-center justify-center"
          style={{ color: 'var(--iv-text-2)' }}
        >
          <ChevronRight className="h-[6px] w-[6px]" />
        </span>
      )}
    </div>
  );
}

/** The chat panel's header: the thread's title (the first message, or New
    chat) with its dot and chevron, and Open in Chat once there is a thread. */
function ChatHeader({ width, title }: { width: number; title?: string }) {
  const { t } = useTranslation();
  return (
    <div
      className="flex shrink-0 items-center gap-1 border-l px-1.5"
      style={{ width, borderColor: 'var(--color-border-muted)' }}
    >
      <span className="flex min-w-0 items-center gap-[3px] leading-none">
        <span
          className="h-[3px] w-[3px] shrink-0 rounded-full"
          style={{
            background: title ? 'var(--color-accent-primary)' : 'var(--color-text-tertiary)',
            opacity: title ? 1 : 0.35,
          }}
        />
        <span className="truncate text-[0.4375rem] font-medium" style={{ color: 'var(--iv-text)' }}>
          {title ?? t('marketView.chatHistory.newChat')}
        </span>
        <ChevronDown className="h-[6px] w-[6px] shrink-0" style={{ color: 'var(--iv-text-3)' }} />
      </span>
      {title && (
        <span
          className={cn(
            'intro-pop ml-auto flex shrink-0 items-center gap-[2px] rounded-[3px] border',
            'px-[4px] py-[2px] text-[0.375rem] font-medium leading-none'
          )}
          style={{ borderColor: 'var(--color-border-default)', color: 'var(--iv-text-2)' }}
        >
          <MessageSquare className="h-[6px] w-[6px]" />
          {t('marketView.chatPanel.openInChat')}
        </span>
      )}
    </div>
  );
}

/* ── the stock header's metrics and the chart toolbar ──────────────────── */

/** The header's metrics grid: two rows of five, label over value. */
function Metrics({ quote: q, last }: { quote: Quote; last: number }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const pct = ((last - q.prev) / q.prev) * 100;
  const cells: [string, string, string?][] = [
    [t('marketView.header.prevClose'), fixed2(q.prev, locale)],
    [t('marketView.header.open'), fixed2(q.open, locale)],
    [t('marketView.header.low'), fixed2(Math.min(q.low, last), locale)],
    [t('marketView.header.high'), fixed2(Math.max(q.high, last), locale)],
    [t('marketView.header.high52w'), fixed2(q.hi52, locale)],
    [t('marketView.header.low52w'), fixed2(q.lo52, locale)],
    [t('marketView.header.avgVolume3m'), q.avgVol],
    [t('marketView.header.volume'), q.vol],
    [
      t('marketView.header.dayRange'),
      `${fixed2(Math.min(q.low, last), locale)} – ${fixed2(Math.max(q.high, last), locale)}`,
    ],
    [t('marketView.header.changePct'), `${signedFixed2(pct, locale)}%`, tone(pct)],
  ];
  return (
    <div
      // columns take their widest value, so the day's range never runs into
      // its neighbour in a column this narrow
      className="grid shrink-0 grid-cols-[repeat(5,auto)] content-center justify-between gap-x-[3px] gap-y-[4px] border-b px-2"
      style={{
        height: METRICS_H,
        borderColor: 'var(--color-border-default)',
        background: 'var(--color-bg-card)',
      }}
    >
      {cells.map(([label, value, color]) => (
        <span key={label} className="flex min-w-0 flex-col gap-[2px] leading-none">
          <span
            className="whitespace-nowrap text-[0.28125rem] uppercase"
            style={{ color: 'var(--iv-text-2)' }}
          >
            {label}
          </span>
          <span
            className="whitespace-nowrap text-[0.34375rem] font-medium tabular-nums"
            style={{ color: color ?? 'var(--iv-text)' }}
          >
            {value}
          </span>
        </span>
      ))}
    </div>
  );
}

/** The chart's toolbar (`.chart-tools`) as a page-width chart lays it out:
    intervals and indicators on the left; Clear while the agent's drawing is
    up, the selection tools, the tools, the menu (the view buttons fold into
    it at this width) and the Light / Advanced switch on the right. */
function ChartTools({ armed = false, clear = false }: { armed?: boolean; clear?: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      className="flex shrink-0 items-center gap-1 border-b"
      style={{
        height: TOOLS_H,
        paddingInline: PAD_X,
        borderColor: 'var(--color-border-default)',
        background: 'var(--color-bg-card)',
      }}
    >
      <Intervals />
      <ToolBtn icon={SlidersHorizontal} />
      <span className="ml-auto flex items-center" style={{ gap: GAP }}>
        {clear && (
          <span className="intro-pop">
            <ClearButton />
          </span>
        )}
        <SelectionTools armed={armed} />
        <ToolBtn icon={Settings2} />
        <ToolBtn icon={Menu} />
        <Segmented
          active={0}
          className="w-[48px]"
          items={[t('marketView.chart.light'), t('marketView.chart.advanced')]}
        />
      </span>
    </div>
  );
}

/* ── the sidebar ───────────────────────────────────────────────────────── */

/** The open sidebar (`MarketSidebarPanel`): the section's title with its live
    dot and add button, the rows (the symbol on the chart marked on its left
    edge), and View all. */
function Sidebar({
  width,
  tab,
  active,
  rows,
}: {
  width: number;
  tab: 'watchlist' | 'portfolio';
  active: string;
  rows: Row[];
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  return (
    <div
      className="flex shrink-0 flex-col border-l"
      style={{ width, borderColor: 'var(--iv-border)', background: 'var(--color-bg-card)' }}
    >
      <div className="flex items-center gap-[3px] px-[7px] pb-[3px] pt-[6px]">
        <span
          className="text-[0.34375rem] font-semibold leading-none"
          style={{ color: 'var(--iv-text-2)' }}
        >
          {tab === 'watchlist'
            ? t('marketView.header.watchlist')
            : t('marketView.sidebar.portfolio')}
        </span>
        <span
          className="h-[3px] w-[3px] rounded-full"
          style={{ background: 'var(--color-profit)' }}
        />
        <Plus className="ml-auto h-[7px] w-[7px]" style={{ color: 'var(--iv-text-2)' }} />
      </div>
      <div className="flex flex-col px-[3px]">
        {rows.map((row, i) => {
          const on = row.sym === active;
          return (
            <span
              key={row.sym}
              className={cn(
                'flex items-center gap-[2px] border-l-[1.5px] px-[3px] py-[5px] leading-none tabular-nums',
                i < rows.length - 1 && 'border-b'
              )}
              style={{
                borderLeftColor: on ? 'var(--color-accent-primary)' : 'transparent',
                borderBottomColor: 'var(--color-border-subtle)',
                background: on ? 'var(--color-bg-hover)' : undefined,
              }}
            >
              <span
                className="w-[22px] shrink-0 text-[0.375rem] font-semibold"
                style={{ color: 'var(--iv-text)' }}
              >
                {row.sym}
              </span>
              <span
                className="flex-1 text-right text-[0.375rem]"
                style={{ color: 'var(--iv-text)' }}
              >
                {fixed2(row.price, locale)}
              </span>
              <span
                className="w-[25px] shrink-0 text-right text-[0.375rem] font-medium"
                style={{ color: tone(row.pct) }}
              >
                {signedFixed2(row.pct, locale)}%
              </span>
            </span>
          );
        })}
      </div>
      <span
        className="px-[7px] pb-[6px] pt-[4px] text-right text-[0.34375rem] font-medium leading-none"
        style={{ color: 'var(--iv-text-2)' }}
      >
        {t('marketView.sidebar.viewAll')}
      </span>
    </div>
  );
}

/** The folded sidebar: a strip with the chart glyph and the unfold chevron. */
function FoldedSidebar({ width }: { width: number }) {
  return (
    <div
      className="flex shrink-0 flex-col items-center gap-[3px] border-l pt-[7px]"
      style={{
        width,
        borderColor: 'var(--iv-border)',
        background: 'var(--color-bg-card)',
        color: 'var(--iv-text-2)',
      }}
    >
      <BarChart3 className="h-[7px] w-[7px]" />
      <ChevronLeft className="h-[6px] w-[6px]" />
    </div>
  );
}

/* ── the chat panel ────────────────────────────────────────────────────── */

/** The app's mark, as the empty chat draws it (`LogoLoading`), at rest. */
function Mark() {
  return (
    <svg viewBox="0 0 60 60" className="h-5 w-5" fill="none" aria-hidden>
      {[
        'M40.03 29.6L49.99 25.41C50.53 25.18 50.76 24.53 50.48 24.01L45.64 15.05C45.35 14.52 44.66 14.36 44.17 14.72L34.65 21.61M40.03 29.6L33.93 32.17C31.79 33.08 31.45 35.98 33.32 37.36L44.17 45.32C44.66 45.68 45.35 45.52 45.64 44.99L50.51 35.98C50.78 35.48 50.58 34.86 50.07 34.61L40.03 29.6ZM34.65 21.61L30.59 24.56C28.75 25.89 26.16 24.78 25.85 22.54L24.16 10.14C24.07 9.53 24.54 9 25.15 9H34.72C35.3 9 35.77 9.51 35.71 10.09L34.65 21.61Z',
        'M35.28 47L35.66 50.02C35.73 50.62 35.26 51.15 34.66 51.14L25.17 51.03C24.58 51.03 24.13 50.52 24.19 49.93L25.14 40.67C25.23 39.81 24.27 39.25 23.57 39.75L15.85 45.23C15.36 45.58 14.67 45.41 14.39 44.88L9.69 35.91C9.42 35.39 9.65 34.75 10.2 34.52L18.11 31.28C18.9 30.95 18.95 29.85 18.19 29.46L10.21 25.36C9.71 25.1 9.52 24.48 9.79 23.99L14.72 15.07C15.02 14.54 15.71 14.39 16.2 14.76L18.5 16.5',
      ].map((d) => (
        <path
          key={d.length}
          d={d}
          stroke="var(--color-accent-overlay)"
          strokeWidth={3}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

/** A fresh chat: the mark and the prompt to start, then two suggestions
    for the symbol on the chart and the shuffle. */
function EmptyChat({ sym }: { sym: string }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-1 text-center">
        <Mark />
        <span className="text-[0.375rem] leading-[1.4]" style={{ color: 'var(--iv-text-2)' }}>
          {t('marketView.chatPanel.startConversation')}
        </span>
      </div>
      <div className="flex flex-col gap-1 pb-1">
        {(['q2', 'q3'] as const).map((q) => (
          <span
            key={q}
            className="rounded-[5px] border px-[5px] py-[4px] text-[0.375rem] leading-[1.4]"
            style={{
              background: 'var(--color-bg-card)',
              borderColor: 'var(--color-border-default)',
              color: 'var(--iv-text)',
            }}
          >
            {t(`marketView.quickQuery.${q}`, { symbol: sym })}
          </span>
        ))}
        <span
          className="flex h-[13px] w-[13px] items-center justify-center self-center rounded-full border"
          style={{ borderColor: 'var(--color-border-default)', color: 'var(--iv-text-2)' }}
        >
          <RefreshCw className="h-[6px] w-[6px]" />
        </span>
      </div>
    </>
  );
}

/** A chart selection waiting above the composer (`SelectionChips`): what
    it is, the symbol and timeframe, the note, and its X. */
export function SelectionChip({ note }: { note: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'flex w-fit max-w-full items-center gap-[3px] rounded-[3px] border py-[2.5px] pl-[5px] pr-[3px]',
        'text-[0.375rem] leading-none'
      )}
      style={{
        backgroundColor: 'var(--color-bg-page)',
        backgroundImage: 'linear-gradient(var(--color-bg-surface), var(--color-bg-surface))',
        borderColor: 'var(--color-border-muted)',
        color: 'var(--iv-text-2)',
      }}
    >
      <span className="min-w-0 truncate">
        {t('marketView.selection.chipRegion', { symbol: 'NVDA', timeframe: '1day' })} · "{note}"
      </span>
      <X className="h-[6px] w-[6px] shrink-0" style={{ color: 'var(--iv-text-3)' }} />
    </span>
  );
}

/** A sent selection under the user's message (`InlineSelectionCards`): the
    region glyph on its tile, what was selected on which chart, the note. */
export function SelectionCard({ at, note }: { at: number; note: string }) {
  const { t } = useTranslation();
  return (
    <Appear at={at} className="flex justify-end">
      <span
        className="flex w-[128px] max-w-full items-center gap-[5px] rounded-[5px] border px-[5px] py-[4px]"
        style={{ background: 'var(--color-bg-elevated)', borderColor: 'var(--color-border-muted)' }}
      >
        <span
          className="flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[3px]"
          style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent-light)' }}
        >
          <SquareDashedMousePointer className="h-[7px] w-[7px]" />
        </span>
        <span className="flex min-w-0 flex-col gap-[3px] leading-none">
          <span
            className="truncate text-[0.375rem] font-semibold"
            style={{ color: 'var(--iv-text)' }}
          >
            {t('marketView.selection.cardRegionTitle')}
            <span className="font-normal" style={{ color: 'var(--iv-text-3)' }}>
              {' · '}NVDA 1day
            </span>
          </span>
          <span className="truncate text-[0.375rem]" style={{ color: 'var(--iv-text-2)' }}>
            “{note}”
          </span>
        </span>
      </span>
    </Appear>
  );
}

/** The panel's composer (`ChatInput`), as the kit's dock draws the thread's,
    under the market placeholder. `ready` fills send for a chip with no text. */
function Composer({
  text,
  ready = false,
  focused = false,
  sendAt,
  narrow = false,
}: ComposerState & { narrow?: boolean }) {
  const { t: tr } = useTranslation();
  const t = useSceneTime();
  const pressed = sendAt?.some((at) => t >= at && t < at + 260) ?? false;
  const filled = text != null || ready;
  return (
    <div
      className="flex flex-col gap-1.5 rounded-[11px] border p-1.5"
      style={{
        background: 'var(--color-bg-card)',
        borderColor: focused ? 'var(--color-accent-primary)' : 'var(--color-border-input)',
      }}
    >
      <div className="flex h-2 items-center px-0.5">
        <span
          className="truncate text-[0.5rem] leading-none"
          style={{ color: text == null ? 'var(--iv-text-3)' : 'var(--iv-text)' }}
        >
          {text ?? tr('marketView.chatPanel.defaultPlaceholder')}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <Plus className="h-2.5 w-2.5 shrink-0" style={{ color: 'var(--color-icon-muted)' }} />
        {/* the model picker drops out of a panel this narrow */}
        <span className="ml-auto">{!narrow && <Ln w="30px" h={3} c="var(--iv-line-2)" />}</span>
        <Mic className="h-2.5 w-2.5 shrink-0" style={{ color: 'var(--color-icon-muted)' }} />
        <span
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-md transition-transform duration-150"
          style={{
            background: filled ? 'var(--color-btn-primary-bg)' : 'var(--color-bg-elevated)',
            transform: pressed ? 'scale(0.85)' : undefined,
          }}
        >
          <ArrowUp
            className="h-2 w-2"
            style={{ color: filled ? 'var(--color-btn-primary-text)' : 'var(--color-icon-muted)' }}
          />
        </span>
      </div>
    </div>
  );
}

/** The chat panel (`MarketChatPanel`): the transcript, or the empty state
    until there is one, then any selection chip, then the composer. */
function ChatPanel({
  width,
  sym,
  transcript,
  chip,
  composer,
}: {
  width: number;
  sym: string;
  transcript?: ReactNode;
  chip?: ReactNode;
  composer: ComposerState;
}) {
  return (
    <div
      className="flex shrink-0 flex-col border-l px-[6px] pb-[6px]"
      style={{ width, borderColor: 'var(--color-border-muted)', background: 'var(--iv-mk-bg)' }}
    >
      {transcript ? (
        // holds its top while it fits and its newest lines once it overflows:
        // the auto margin takes free space, and with none the flex end wins
        <div className="flex min-h-0 grow basis-0 flex-col justify-end overflow-hidden px-[2px] pt-2">
          <div className="mb-auto flex flex-col gap-1.5">{transcript}</div>
        </div>
      ) : (
        <EmptyChat sym={sym} />
      )}
      {chip && <div className="flex px-[2px] pb-[4px]">{chip}</div>}
      <Composer {...composer} narrow={width < 120} />
    </div>
  );
}

/** What the composer shows: its text, whether send is live, focus, presses. */
export interface ComposerState {
  text?: ReactNode;
  ready?: boolean;
  focused?: boolean;
  sendAt?: number[];
}

/* ── the symbol search ─────────────────────────────────────────────────── */

/** What the search lists as the ticker is typed. */
const HITS: Record<string, [string, string][]> = {
  NV: [
    ['NVDA', 'NVIDIA Corp'],
    ['NVO', 'Novo Nordisk A/S'],
    ['NVS', 'Novartis AG'],
  ],
  NVD: [
    ['NVDA', 'NVIDIA Corp'],
    ['NVDL', 'GraniteShares 2x Long NVDA'],
    ['NVDU', 'Direxion Daily NVDA Bull 2X'],
  ],
};

/** The symbol switcher's search (`SymbolSearch` in its popover): the field,
    then the hits for what is typed, the first one highlighted. */
export function SymbolPopover({ typed, at }: { typed: string; at: number }) {
  const { t } = useTranslation();
  const hits = HITS[typed.slice(0, 3)] ?? (typed ? HITS.NV : []);
  const typing = useSceneTime() >= at;
  return (
    <div
      className="intro-pop absolute z-10 flex w-[118px] flex-col gap-[3px] rounded-md border p-[4px]"
      style={{
        left: ORIGIN.x + 6,
        top: 26,
        background: 'var(--color-bg-elevated)',
        borderColor: 'var(--color-border-default)',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)',
      }}
    >
      <span
        className="flex h-[14px] items-center gap-[4px] rounded-[4px] border px-[5px]"
        style={{ background: 'var(--color-bg-input)', borderColor: 'var(--color-border-default)' }}
      >
        <Search className="h-[6px] w-[6px] shrink-0" style={{ color: 'var(--iv-text-3)' }} />
        <span
          className="truncate text-[0.40625rem] leading-none"
          style={{ color: typed ? 'var(--iv-text)' : 'var(--color-text-tertiary)' }}
        >
          {typed || t('marketView.symbolSearch.placeholder')}
          {typing && typed.length < 4 && <Caret />}
        </span>
      </span>
      {hits.map(([sym, name], i) => (
        <span
          key={sym}
          className="flex items-baseline gap-[4px] rounded-[3px] px-[4px] py-[3px] text-[0.40625rem] leading-none"
          style={{ background: i === 0 ? 'var(--color-bg-hover)' : undefined }}
        >
          <span className="shrink-0 font-mono font-semibold" style={{ color: 'var(--iv-text)' }}>
            {sym}
          </span>
          <span className="truncate" style={{ color: 'var(--iv-text-3)' }}>
            {name}
          </span>
        </span>
      ))}
    </div>
  );
}

/* ── the page ──────────────────────────────────────────────────────────── */

/**
 * MarketView: the stock header over the chart column, the sidebar (open on
 * `tab`, or folded when `tab` is null), and the chat panel. `chart` is the
 * chart itself, `chartW` px wide and `CHART_H` tall.
 */
export function MarketPage({
  layout,
  quote,
  last,
  switching = false,
  tab,
  activeRow,
  armed,
  clear,
  chart,
  title,
  transcript,
  chip,
  composer = {},
}: {
  layout: Layout;
  quote: Quote;
  last: number;
  /** The symbol switcher held open. */
  switching?: boolean;
  tab: 'watchlist' | 'portfolio' | null;
  activeRow?: string;
  armed?: boolean;
  clear?: boolean;
  chart: ReactNode;
  title?: string;
  transcript?: ReactNode;
  chip?: ReactNode;
  composer?: ComposerState;
}) {
  const chartW = chartWidth(layout);
  return (
    <Frame
      topbar={
        <div className="-mx-2.5 flex h-full min-w-0 flex-1 items-stretch">
          <div
            className="flex min-w-0"
            style={{ width: chartW, background: 'var(--color-bg-card)' }}
          >
            <StockTop quote={quote} last={last} open={switching} />
          </div>
          <SidebarTabs width={layout.sidebar} tab={tab} />
          <ChatHeader width={layout.chat} title={title} />
        </div>
      }
    >
      <div className="-m-2.5 flex flex-1">
        <div className="flex min-w-0 flex-col" style={{ width: chartW }}>
          <Metrics quote={quote} last={last} />
          <ChartTools armed={armed} clear={clear} />
          <div className="relative flex-1" style={{ background: 'var(--color-bg-card)' }}>
            {chart}
          </div>
        </div>
        {tab ? (
          <Sidebar
            width={layout.sidebar}
            tab={tab}
            active={activeRow ?? quote.sym}
            rows={
              // the NVDA row ticks with the header while NVDA is on the chart
              quote.sym !== 'NVDA'
                ? tab === 'watchlist'
                  ? WATCHLIST
                  : PORTFOLIO
                : tab === 'watchlist'
                  ? WATCHLIST.map((r) =>
                      r.sym === 'NVDA'
                        ? { ...r, price: last, pct: ((last - NVDA_PREV) / NVDA_PREV) * 100 }
                        : r
                    )
                  : PORTFOLIO.map((r) => (r.sym === 'NVDA' ? { ...r, price: last } : r))
            }
          />
        ) : (
          <FoldedSidebar width={layout.sidebar} />
        )}
        <ChatPanel
          width={layout.chat}
          sym={quote.sym}
          transcript={transcript}
          chip={chip}
          composer={composer}
        />
      </div>
    </Frame>
  );
}
