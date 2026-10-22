import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowUp,
  BarChart3,
  ChevronDown,
  ChevronLeft,
  Info,
  Menu,
  MessageSquare,
  Mic,
  Plus,
  RefreshCw,
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
import { Appear, Ln } from './kit';

/* MarketView as the market intro's camera sees it, after pages/MarketView:
   the stock header and its metrics over the chart and its toolbar, the
   folded sidebar's strip, and the chat panel with its empty state,
   selection chips and composer. The page is drawn whole at its own size and
   the scenes frame parts of it, so the scripted pointer lands where the
   parts are. */
/* eslint-disable react-refresh/only-export-components -- shared parts:
   page components plus layout constants and the quote */

/* ── layout, in the page's px ──────────────────────────────────────────── */

const HEAD_H = 28;
const METRICS_H = 40;
const TOOLS_H = 20;
const CHART_W = 260;
const STRIP_W = 15;
const CHAT_W = 170;
export const PAGE = { w: CHART_W + STRIP_W + CHAT_W, h: 318 };
/** The toolbar's top edge, under the header and the metrics. */
export const TOOLBAR_Y = HEAD_H + METRICS_H;
/** The chart, under the header, the metrics and the toolbar. */
export const CHART = {
  x: 0,
  y: HEAD_H + METRICS_H + TOOLS_H,
  w: CHART_W,
  h: PAGE.h - HEAD_H - METRICS_H - TOOLS_H,
};
/** The chat panel's left edge. */
export const CHAT_X = CHART_W + STRIP_W;

/** The toolbar's right group, laid from the right: the mode switch, the menu,
    the tools, then Price level and Region. */
const MODE_W = 48;
const BTN = 11;
const GAP = 2;
const PAD_X = 5;
/** The Region button's center. */
export const REGION_BTN = {
  x: CHART_W - PAD_X - MODE_W - 3 * (BTN + GAP) - GAP - BTN / 2,
  y: HEAD_H + METRICS_H + TOOLS_H / 2 - 0.5,
};

/** The chat composer's send button. */
export const SEND = { x: PAGE.w - 21, y: PAGE.h - 21 };

/* ── the quote ─────────────────────────────────────────────────────────── */

/** What the stock header prints for NVDA. */
export const NVDA_QUOTE = {
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

const tone = (v: number) => (v >= 0 ? 'var(--color-profit)' : 'var(--color-loss)');

/* ── the header band: stock header, the strip, chat header ──────────── */

/** The stock header's top (`StockHeader`): the symbol switcher, the names,
    the exchange and the live dot over the Company Overview pill; the price
    and the day's change on the right. */
function StockTop() {
  const { t } = useTranslation();
  const locale = useLocale();
  const q = NVDA_QUOTE;
  const change = NVDA_LAST - q.prev;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 px-2">
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <div className="flex min-w-0 items-center gap-[5px] leading-none">
          <span
            className="flex shrink-0 items-center gap-[1px] rounded-[2px] px-[1px] text-[0.5625rem] font-semibold"
            style={{ color: 'var(--iv-text)' }}
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
          {fixed2(NVDA_LAST, locale)}
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
function Metrics() {
  const { t } = useTranslation();
  const locale = useLocale();
  const q = NVDA_QUOTE;
  const last = NVDA_LAST;
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

/* ── the sidebar, folded ──────────────────────────────────────────────── */

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

/* ── the page ──────────────────────────────────────────────────────────── */

/**
 * MarketView with the sidebar folded, drawn at `PAGE` size: the header band
 * over the chart column (metrics, toolbar, then `chart`, `CHART` sized), the
 * sidebar's strip, and the chat panel. `title` names the thread once there
 * is one.
 */
export function MarketPage({
  armed,
  clear,
  chart,
  title,
  transcript,
  chip,
  composer = {},
}: {
  armed?: boolean;
  clear?: boolean;
  chart: ReactNode;
  title?: string;
  transcript?: ReactNode;
  chip?: ReactNode;
  composer?: ComposerState;
}) {
  const card = { borderColor: 'var(--iv-border)', background: 'var(--color-bg-card)' };
  return (
    <div className="flex flex-col" style={{ width: PAGE.w, height: PAGE.h }}>
      <div
        className="flex shrink-0 border-b"
        style={{ height: HEAD_H, borderColor: 'var(--iv-border)' }}
      >
        <div className="flex min-w-0" style={{ width: CHART_W, ...card }}>
          <StockTop />
        </div>
        <div className="shrink-0 border-l" style={{ width: STRIP_W, ...card }} />
        <ChatHeader width={CHAT_W} title={title} />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-col" style={{ width: CHART_W }}>
          <Metrics />
          <ChartTools armed={armed} clear={clear} />
          <div className="relative flex-1" style={{ background: 'var(--color-bg-card)' }}>
            {chart}
          </div>
        </div>
        <FoldedSidebar width={STRIP_W} />
        <ChatPanel
          width={CHAT_W}
          sym="NVDA"
          transcript={transcript}
          chip={chip}
          composer={composer}
        />
      </div>
    </div>
  );
}
