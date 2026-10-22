import { useTranslation } from 'react-i18next';
import {
  CandlestickChart,
  ExternalLink,
  Menu,
  PanelRight,
  PenLine,
  TextSelect,
  X,
} from 'lucide-react';
import { useLocale } from '@/hooks/useLocale';
import { fixed2, signedFixed2 } from '@/lib/format';
import type { IntroVisualId } from '../../registry';
import { Camera, type Shot } from './camera';
import {
  Candles,
  CommentBox,
  EventBadge,
  FoldedIntervals,
  NVDA,
  NVDA_EVENTS,
  NVDA_LAST,
  NVDA_PREV,
  Pin,
  Selection,
  SelectionTools,
  ToolBtn,
  addButton,
  besideRegion,
  chartScale,
} from './candles';
import { StockPriceCard } from './charts';
import { useSceneTime } from './clock';
import { Appear, Loader, Typed, UserBubble, type Waypoint, pointAt } from './kit';
import { NVDA_QUOTE, SelectionCard, SelectionChip } from './marketParts';
import {
  HEADER_H,
  PAGE,
  PANEL_W,
  PanelTab,
  Prose,
  ThreadPage,
  ToolRow,
  framePage,
} from './threadParts';
import type { IntroScene } from './types';

/* The thread intro's chart step: a chart tab in the file panel
   (`MarketChartSurface` in its compact form, as `ChartTab` hosts it). The
   user takes a region of it, notes it and sends it from the thread's
   composer; the agent pins the news behind the move to the same chart and
   answers with the chart's card in the transcript. A camera follows the
   work across the page: the chart, the composer, the reply, then the chart
   again, where a badge opens on its story. */
/* eslint-disable react-refresh/only-export-components -- scene module:
   private scene components, one record export */

/* ── layout, in the page's px ──────────────────────────────────────────── */

/** The panel's left edge, past the chat column. */
const PANEL_X = PAGE.width - PANEL_W;
/** The chart card sits on the panel's ground, inset 4px top and 5px around. */
const CARD = {
  x: PANEL_X + 1 + 5,
  y: HEADER_H + 4,
  w: PANEL_W - 1 - 10,
  h: PAGE.height - HEADER_H - 4 - 5,
};
const TOOLBAR_H = 18;
const SUBROW_H = 19;
/** The chart inside the card, under its toolbar and the stats row. */
const CHART = {
  x: CARD.x + 1,
  y: CARD.y + 1 + TOOLBAR_H + SUBROW_H,
  w: CARD.w - 2,
  h: CARD.h - 2 - TOOLBAR_H - SUBROW_H,
};
const SCALE = chartScale(NVDA, CHART.w, CHART.h);
const toPage = (x: number, y: number) => ({ x: CHART.x + x, y: CHART.y + y });

/** The toolbar from its right end: the trail's two buttons, then the menu,
    Price level and Region. */
const REGION_BTN = {
  x: CARD.x + CARD.w - 1 - 5 - (11 + 2 + 11) - 4 - (11 + 2) - (11 + 2) - 5.5,
  y: CARD.y + 1 + TOOLBAR_H / 2,
};
/** The thread composer's send button. */
const SEND = { x: PANEL_X - 10 - 7 - 8, y: PAGE.height - 10 - 7 - 8 };

const { earnings: EARNINGS, exportRule: EXPORT_RULE } = NVDA_EVENTS;

/** The earnings gap and the slide that filled it: Aug 27 to Sep 11. */
const REGION = {
  x0: SCALE.x(EARNINGS.i) - SCALE.step / 2,
  y0: SCALE.y(187.6),
  x1: SCALE.x(20) + SCALE.step / 2,
  y1: SCALE.y(169.9),
};
const BOX_W = 88;
const BOX = besideRegion(SCALE, REGION.x0, REGION.x1, REGION.y0, BOX_W);
const PIN = besideRegion(SCALE, REGION.x0, REGION.x1, REGION.y0, 10);
const ADD = addButton(BOX, BOX_W);
/** The export rule's badge, centered over its anchor. */
const BADGE = toPage(SCALE.x(EXPORT_RULE.i), SCALE.y(EXPORT_RULE.price) - 10.5);

const CH = {
  arm: 850,
  press: 1350,
  release: 2050,
  note: 2250,
  add: 3050,
  added: 3200,
  ask: 4200,
  send: 5300,
  think: 5500,
  draw: 5800,
  drawn: 6600,
  answer: 6800,
  open: 8900,
  length: 9900,
};

const NOTE = 'Earnings gap';
const ASK = 'Why did this fade?';

/** The chart card edge to edge, its left edge on the panel's divider, the
    composer as the chip lands and the ask is typed, the reply as it comes
    in, then the chart with its badges. */
const SHOTS: [Shot, ...Shot[]] = [
  { at: 0, ...framePage({ x: PANEL_X, y: HEADER_H + 1, w: PANEL_W, h: 174 }, 0) },
  { at: 4100, dur: 850, ...framePage({ x: 0, y: 175, w: PANEL_X, h: 155 }, 0) },
  { at: 6100, dur: 800, ...framePage({ x: 0, y: 166, w: PANEL_X, h: 155 }, 0) },
  { at: 8500, dur: 900, ...framePage({ x: CARD.x, y: CARD.y, w: CARD.w, h: 156 }, 4) },
];

const PATH: Waypoint[] = [
  { at: 150, x: 352, y: 168 },
  { at: 650, ...REGION_BTN },
  { at: 1000, ...REGION_BTN },
  { at: 1300, ...toPage(REGION.x0, REGION.y0) },
  { at: 1400, ...toPage(REGION.x0, REGION.y0) },
  { at: 2050, ...toPage(REGION.x1, REGION.y1) },
  { at: 2350, ...toPage(REGION.x1 + 4, REGION.y1 - 10) },
  { at: 2900, ...toPage(ADD.x, ADD.y) },
  { at: 3300, ...toPage(ADD.x, ADD.y) },
  { at: 5100, ...SEND },
  { at: 5600, ...SEND },
  { at: 8800, ...BADGE },
];

/* ── the chart tab ─────────────────────────────────────────────────────── */

/** The ticker legend that leads the compact toolbar (`LegendLead`): symbol,
    price and currency, the change, and the feed's status. Cut short with an
    ellipsis when the row runs out, as the lead is the one thing that gives. */
function LegendLead() {
  const { t } = useTranslation();
  const locale = useLocale();
  const change = NVDA_LAST - NVDA_PREV;
  const up = { color: 'var(--color-profit)' };
  return (
    <span
      className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[0.34375rem] leading-none tabular-nums"
      style={{ color: 'var(--iv-text-2)' }}
    >
      <span className="text-[0.375rem] font-semibold" style={{ color: 'var(--iv-text)' }}>
        NVDA
      </span>{' '}
      <span className="font-mono font-semibold" style={up}>
        {fixed2(NVDA_LAST, locale)}
      </span>{' '}
      <span className="text-[0.3rem]">USD</span>{' '}
      <span className="font-mono" style={up}>
        {signedFixed2(change, locale)} ({signedFixed2((change / NVDA_PREV) * 100, locale)}%)
      </span>{' '}
      <span
        className="inline-block h-[3px] w-[3px] rounded-full align-middle"
        style={{ background: 'var(--color-profit)' }}
      />{' '}
      <span className="text-[0.3125rem]">{t('marketView.quote.live')}</span>
    </span>
  );
}

/** The day's figures under the toolbar (`LegendStats`), key then value. */
function LegendStats() {
  const { t } = useTranslation();
  const locale = useLocale();
  const q = NVDA_QUOTE;
  const stats: [string, string, string?][] = [
    [t('marketView.quote.open'), fixed2(q.open, locale)],
    [t('marketView.quote.high'), fixed2(q.high, locale)],
    [t('marketView.quote.low'), fixed2(q.low, locale)],
    [t('marketView.quote.close'), fixed2(NVDA_LAST, locale)],
    [t('marketView.quote.volume'), q.vol],
    [t('marketView.quote.prevClose'), fixed2(q.prev, locale)],
    [t('marketView.quote.range52w'), `${fixed2(q.lo52, locale)}–${fixed2(q.hi52, locale)}`],
    [
      t('marketView.quote.change'),
      `${signedFixed2(((NVDA_LAST - q.prev) / q.prev) * 100, locale)}%`,
      'var(--color-profit)',
    ],
  ];
  return (
    <div
      className="flex shrink-0 flex-wrap content-center gap-x-[5px] gap-y-[2px] border-b px-[5px] font-mono text-[0.3125rem] leading-none tabular-nums"
      style={{ height: SUBROW_H, borderColor: 'var(--color-border-default)' }}
    >
      {stats.map(([key, value, color]) => (
        <span key={key} className="whitespace-nowrap">
          <span style={{ color: 'var(--iv-text-3)' }}>{key}</span>{' '}
          <span style={{ color: color ?? 'var(--iv-text)' }}>{value}</span>
        </span>
      ))}
    </div>
  );
}

/** The compact chart in the panel: the legend and the folded interval
    picker, Clear (icon only at this width) while the agent's drawing is up,
    the selection tools and the menu, then the tab's own actions, add to
    context and open in MarketView. */
function PanelChart({ armed, clear }: { armed: boolean; clear: boolean }) {
  const t = useSceneTime();
  const sent = t >= CH.send;
  const drawing = t >= CH.press && !sent;
  const box =
    t >= CH.release
      ? REGION
      : (() => {
          const p = pointAt(PATH, Math.max(t, CH.press));
          return { ...REGION, x1: p.x - CHART.x, y1: p.y - CHART.y };
        })();
  return (
    <div
      className="flex flex-1 flex-col px-[5px] pb-[5px] pt-1"
      style={{ background: 'var(--color-bg-canvas)' }}
    >
      <div
        className="flex flex-1 flex-col overflow-hidden rounded-[4px] border"
        style={{ borderColor: 'var(--color-border-default)', background: 'var(--color-bg-card)' }}
      >
        <div
          className="flex shrink-0 items-center gap-1 border-b px-[5px]"
          style={{ height: TOOLBAR_H, borderColor: 'var(--color-border-default)' }}
        >
          <LegendLead />
          <FoldedIntervals />
          <span className="flex items-center gap-[2px]">
            {clear && (
              <span className="intro-pop">
                <ToolBtn icon={X} />
              </span>
            )}
            <SelectionTools armed={armed} />
            <ToolBtn icon={Menu} />
          </span>
          <span className="flex items-center gap-[2px]">
            <ToolBtn icon={TextSelect} />
            <ToolBtn icon={ExternalLink} />
          </span>
        </div>
        <LegendStats />
        <Candles series={NVDA} scale={SCALE}>
          {drawing && t < CH.added && <Selection {...box} />}
          {drawing && t >= CH.added && <Selection {...REGION} active={false} />}
          {t >= CH.release && t < CH.added && (
            <CommentBox
              left={BOX.left}
              top={BOX.top}
              width={BOX_W}
              pressed={t >= CH.add}
              text={t >= CH.note ? <Typed text={NOTE} at={CH.note} cps={18} /> : undefined}
            />
          )}
          {t >= CH.added && !sent && <Pin n={1} left={PIN.left} top={PIN.top} />}
          <EventBadge scale={SCALE} ev={EARNINGS} at={CH.drawn} />
          <EventBadge
            scale={SCALE}
            ev={EXPORT_RULE}
            at={CH.drawn + 150}
            hover={t >= CH.open - 100}
            open={t >= CH.open}
          />
        </Candles>
      </div>
    </div>
  );
}

/* ── the transcript ────────────────────────────────────────────────────── */

/** The chart's card in a thread (`InlineChartAnnotationCard` with no live
    chart beside it): the candle glyph over the interval, the chart's name,
    how many annotations and which, and Open. */
function ChartFileCard() {
  const { t } = useTranslation();
  const labels = [EARNINGS.title, EXPORT_RULE.title];
  const muted = { borderColor: 'var(--color-border-muted)' };
  return (
    <Appear at={CH.drawn} pop>
      <div
        className="flex h-6 items-center gap-1.5 rounded-lg border px-1.5"
        style={{ ...muted, background: 'var(--color-bg-card)' }}
      >
        <span className="relative h-[15px] w-3 shrink-0">
          <span
            className="absolute inset-0 rounded-sm border"
            style={{
              background: 'var(--color-bg-elevated)',
              borderColor: 'var(--color-border-muted)',
              transform: 'translate(-1px, 1px) rotate(-5deg)',
            }}
          />
          <span
            className="absolute inset-0 flex flex-col items-center justify-center gap-[1px] rounded-sm border"
            style={{
              background: 'var(--color-bg-page)',
              borderColor: 'var(--color-border-elevated)',
            }}
          >
            <CandlestickChart
              className="h-1.5 w-1.5"
              style={{ color: 'var(--color-accent-primary)' }}
            />
            <span
              className="font-mono text-[0.1875rem] leading-none"
              style={{ color: 'var(--iv-text-3)' }}
            >
              1D
            </span>
          </span>
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[0.5rem] leading-none" style={{ color: 'var(--iv-text)' }}>
            {t('chat.chartAnnotationCard.name', { symbol: 'NVDA', interval: '1D' })}
          </span>
          <span
            className="truncate text-[0.375rem] leading-none"
            style={{ color: 'var(--iv-text-3)' }}
          >
            {t('chat.chartAnnotationCard.metaCount', { count: labels.length })} ·{' '}
            {labels.join(t('chat.chartAnnotationCard.labelSeparator'))}
          </span>
        </span>
        <span
          className="ml-auto flex shrink-0 items-center gap-0.5 rounded border px-1 py-0.5 text-[0.375rem] leading-none"
          style={{ ...muted, color: 'var(--iv-text-3)' }}
        >
          <PanelRight className="h-1.5 w-1.5" />
          {t('chat.turnFiles.open')}
        </span>
      </div>
    </Appear>
  );
}

function Transcript() {
  const t = useSceneTime();
  const { t: tr } = useTranslation();
  return (
    <>
      {/* a thread with history, scrolled to its newest lines, the oldest
          running off the top as the turn comes in */}
      <div className="flex min-h-0 grow basis-0 flex-col justify-end overflow-hidden">
        <div className="flex flex-col gap-1.5">
          <UserBubble at={0}>Chart NVDA since earnings</UserBubble>
          <StockPriceCard
            sym="NVDA"
            price="$182.42"
            change={7.18}
            period="2026-08-13, 2026-10-21"
            series={NVDA.bars.map((b) => b.c)}
            high="$186.90"
            low="$170.60"
            vol="181.5M"
            at={-1}
          />
          <Prose text="It gapped to **186.90** on Aug 27, then gave most of it back by mid-September." />
          <UserBubble at={CH.send}>{ASK}</UserBubble>
          <SelectionCard at={CH.send + 60} note={NOTE} />
          {t >= CH.think && t < CH.draw && (
            <Loader color="var(--color-icon-muted)" className="text-[0.625rem]" />
          )}
          {t < CH.drawn ? (
            <ToolRow
              icon={PenLine}
              at={CH.draw}
              done={CH.drawn}
              running={{ label: tr('toolArtifact.inProgress.annotatingChart') }}
              settled={{ label: tr('toolArtifact.tool.annotateChart'), pill: 'NVDA · 1D' }}
            />
          ) : (
            <ChartFileCard />
          )}
          <Prose
            text="It faded on news: a **new export rule** on Sep 8 took 3% off in a day, and the slide ran through the gap to **170.60**. Both events are on the chart."
            at={CH.answer}
            cps={110}
          />
        </div>
      </div>
      {t >= CH.added && t < CH.send && (
        <Appear at={CH.added} pop className="flex min-w-0">
          <SelectionChip note={NOTE} />
        </Appear>
      )}
    </>
  );
}

function ChartPanel() {
  const t = useSceneTime();
  return (
    <Camera shots={SHOTS} cursor={PATH} clicks={[CH.arm, CH.add, CH.send, CH.open - 60]}>
      <ThreadPage
        title="NVDA earnings reaction"
        tabs={<PanelTab icon={CandlestickChart} label="NVDA" active />}
        actions={null}
        chat={<Transcript />}
        panel={<PanelChart armed={t >= CH.arm && t < CH.release} clear={t >= CH.drawn} />}
        composer={
          t >= CH.ask && t < CH.send ? <Typed text={ASK} at={CH.ask} cps={22} /> : undefined
        }
        sendAt={[CH.send]}
      />
    </Camera>
  );
}

export const threadChartScenes = {
  chartPanel: { Scene: ChartPanel, length: CH.length, anchor: 'right' },
} satisfies Partial<Record<IntroVisualId, IntroScene>>;
