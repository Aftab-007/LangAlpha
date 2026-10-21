import { useTranslation } from 'react-i18next';
import { Check, PenLine } from 'lucide-react';
import type { IntroVisualId } from '../../registry';
import {
  AAPL,
  Candles,
  CommentBox,
  EARNINGS_BAR,
  NVDA,
  NVDA_LAST,
  Pin,
  PriceLine,
  Selection,
  VLine,
  Zone,
  besideRegion,
  chartScale,
  liveTick,
} from './candles';
import { progress, useSceneTime } from './clock';
import { Appear, Cursor, Loader, Typed, UserBubble, type Waypoint, pointAt } from './kit';
import {
  AAPL_QUOTE,
  CHART_H,
  CHART_Y,
  FOLDED,
  MarketPage,
  NVDA_QUOTE,
  OPEN,
  ORIGIN,
  SEND,
  SelectionCard,
  SelectionChip,
  SymbolPopover,
  chartWidth,
  regionButton,
} from './marketParts';
import { Prose, ToolRow } from './threadParts';
import type { IntroScene } from './types';

/* The market intro, on MarketView itself. marketLive: the symbol search
   switches the page to NVDA, the chart draws in, the last candle ticks with
   the header and the watchlist, and the sidebar flips to the portfolio.
   marketAsk: the Region tool takes a stretch of candles, a note goes on it,
   the selection lands in the chat panel as a chip and is sent. marketDraw:
   the agent answers by drawing on the chart, a resistance line, a demand
   zone and the earnings session, while its reply streams beside it. */
/* eslint-disable react-refresh/only-export-components -- scene module:
   private scene components, one record export */

/** The live feed's last prints, settling on the quoted last. */
const TICKS = [182.31, 182.37, 182.29, 182.46, 182.51, 182.38, NVDA_LAST];

/** Where the pointer is, as chart px of a chart at the page's chart origin. */
const toChart = ({ x, y }: { x: number; y: number }) => ({ x: x - ORIGIN.x, y: y - CHART_Y });

/** A pointer over the scene, fading out from `away`. */
function Pointer({ path, clicks, away }: { path: Waypoint[]; clicks: number[]; away: number }) {
  const fade = progress(useSceneTime(), away, 400);
  if (fade >= 1) return null;
  return (
    <div className="pointer-events-none absolute inset-0" style={{ opacity: 1 - fade }}>
      <Cursor path={path} clicks={clicks} />
    </div>
  );
}

/* ── marketLive ────────────────────────────────────────────────────────── */

const LIVE = {
  /** The symbol switcher opens. */
  open: 700,
  type: 950,
  /** NVDA is picked: the page switches and the chart draws in. */
  pick: 1900,
  draw: 2000,
  tick: 3300,
  portfolio: 4700,
  away: 5600,
};

const LIVE_PATH: Waypoint[] = [
  { at: 150, x: 170, y: 160 },
  { at: 600, x: 50, y: 10 },
  { at: 1500, x: 50, y: 10 },
  { at: 1800, x: 58, y: 54 },
  { at: 2300, x: 58, y: 56 },
  { at: 3300, x: 160, y: 170 },
  { at: 4000, x: 165, y: 165 },
  { at: 4600, x: 279, y: 14 },
  { at: 5300, x: 292, y: 70 },
];

const LIVE_W = chartWidth(OPEN);
const AAPL_SCALE = chartScale(AAPL, LIVE_W, CHART_H);
const NVDA_LIVE_SCALE = chartScale(NVDA, LIVE_W, CHART_H);

function MarketLive() {
  const t = useSceneTime();
  const nvda = t >= LIVE.pick;
  const typed = 'NVDA'.slice(0, Math.min(Math.max(Math.floor(((t - LIVE.type) * 8) / 1000), 0), 4));
  const last = t < LIVE.tick ? NVDA_LAST : liveTick(t, LIVE.tick, TICKS);
  return (
    <div className="relative w-full max-w-[400px]">
      <MarketPage
        layout={OPEN}
        quote={nvda ? NVDA_QUOTE : AAPL_QUOTE}
        last={nvda ? last : 226.62}
        switching={t >= LIVE.open && !nvda}
        tab={t >= LIVE.portfolio ? 'portfolio' : 'watchlist'}
        chart={
          nvda ? (
            <Candles key="nvda" series={NVDA} scale={NVDA_LIVE_SCALE} at={LIVE.draw} last={last} />
          ) : (
            <Candles key="aapl" series={AAPL} scale={AAPL_SCALE} />
          )
        }
      />
      {t >= LIVE.open && !nvda && <SymbolPopover typed={typed} at={LIVE.type} />}
      <Pointer path={LIVE_PATH} clicks={[LIVE.open, LIVE.pick, LIVE.portfolio]} away={LIVE.away} />
    </div>
  );
}

/* ── marketAsk ─────────────────────────────────────────────────────────── */

const ASK = {
  arm: 1000,
  press: 1550,
  release: 2300,
  type: 2500,
  add: 3550,
  /** The comment box closes on Add, leaving the pin and the chip. */
  added: 3700,
  send: 4500,
  think: 4700,
  lead: 5300,
  row: 6100,
  away: 4900,
};

const NOTE = 'Can this clear 186?';

const ASK_W = chartWidth(FOLDED);
const SCALE = chartScale(NVDA, ASK_W, CHART_H);

/** The stretch the user takes: the last thirteen sessions, from above their
    high to under their low. */
const REGION = {
  x0: SCALE.x(36) - SCALE.step / 2,
  y0: SCALE.y(183.6),
  x1: SCALE.x(48) + SCALE.step / 2,
  y1: SCALE.y(172.8),
};
const BOX = besideRegion(SCALE, REGION.x0, REGION.x1, REGION.y0);
const PIN = besideRegion(SCALE, REGION.x0, REGION.x1, REGION.y0, 10);
const scene = (x: number, y: number) => ({ x: ORIGIN.x + x, y: CHART_Y + y });

const ASK_PATH: Waypoint[] = [
  { at: 300, x: 170, y: 210 },
  { at: 900, ...regionButton(FOLDED) },
  { at: 1150, ...regionButton(FOLDED) },
  { at: 1500, ...scene(REGION.x0, REGION.y0) },
  { at: 1600, ...scene(REGION.x0, REGION.y0) },
  { at: 2300, ...scene(REGION.x1, REGION.y1) },
  { at: 2600, ...scene(REGION.x1 - 6, REGION.y1 + 6) },
  { at: 3400, ...scene(BOX.left + 77, BOX.top + 8) },
  { at: 3800, ...scene(BOX.left + 77, BOX.top + 8) },
  { at: 4400, ...SEND },
];

/** The drag in progress: the anchor corner to wherever the pointer is. */
function dragged(t: number) {
  if (t >= ASK.release) return REGION;
  const p = toChart(pointAt(ASK_PATH, Math.max(t, 1600)));
  return { x0: REGION.x0, y0: REGION.y0, x1: p.x, y1: p.y };
}

/** The user's message with its selection, as sent from the panel. */
function Sent({ at }: { at: number }) {
  return (
    <>
      <UserBubble at={at}>{NOTE}</UserBubble>
      <SelectionCard at={at + 60} note={NOTE} />
    </>
  );
}

function MarketAsk() {
  const t = useSceneTime();
  const sent = t >= ASK.send;
  const drawing = t >= ASK.press && !sent;
  const box = dragged(t);
  return (
    <div className="relative w-full max-w-[400px]">
      <MarketPage
        layout={FOLDED}
        quote={NVDA_QUOTE}
        last={NVDA_LAST}
        tab={null}
        armed={t >= ASK.arm && t < ASK.release}
        chart={
          <Candles series={NVDA} scale={SCALE}>
            {drawing && t < ASK.added && <Selection {...box} />}
            {drawing && t >= ASK.added && <Selection {...REGION} active={false} />}
            {t >= ASK.release && t < ASK.added && (
              <CommentBox
                left={BOX.left}
                top={BOX.top}
                pressed={t >= ASK.add}
                text={t >= ASK.type ? <Typed text={NOTE} at={ASK.type} cps={22} /> : undefined}
              />
            )}
            {t >= ASK.added && !sent && <Pin n={1} left={PIN.left} top={PIN.top} />}
          </Candles>
        }
        title={sent ? NOTE : undefined}
        chip={
          t >= ASK.added && !sent ? (
            <Appear at={ASK.added} pop className="flex min-w-0">
              <SelectionChip note={NOTE} />
            </Appear>
          ) : undefined
        }
        transcript={
          sent ? (
            <>
              <Sent at={ASK.send} />
              {t >= ASK.think && t < ASK.lead && (
                <Loader color="var(--color-icon-muted)" className="text-[0.625rem]" />
              )}
              <Prose text={LEAD} at={ASK.lead} cps={70} />
              <AnnotateRow at={ASK.row} done={Infinity} />
            </>
          ) : undefined
        }
        composer={{ ready: t >= ASK.added && !sent, sendAt: [ASK.send] }}
      />
      <Pointer path={ASK_PATH} clicks={[ASK.arm, ASK.add, ASK.send]} away={ASK.away} />
    </div>
  );
}

/* ── marketDraw ────────────────────────────────────────────────────────── */

const LEAD = 'Marking the levels on your chart.';

/** One `draw_chart_annotation` call: annotating while it runs, then the
    settled row with the chart it drew on. */
function AnnotateRow({ at, done }: { at: number; done: number }) {
  const { t } = useTranslation();
  return (
    <ToolRow
      icon={PenLine}
      at={at}
      done={done}
      running={{ label: t('toolArtifact.inProgress.annotatingChart') }}
      settled={{ label: t('toolArtifact.tool.annotateChart'), pill: 'NVDA · 1D' }}
    />
  );
}

/** The chart's chip in the panel (`InlineChartAnnotationCard` beside a live
    chart): the first draw's place in the transcript, counting what is on the
    chart as later draws add to it. */
function ChartChip({ count }: { count: number }) {
  const { t } = useTranslation();
  return (
    <span
      className="intro-pop flex w-fit items-center gap-[4px] rounded-full border px-[5px] py-[3px] text-[0.40625rem] leading-none"
      style={{
        background: 'var(--color-bg-tool-card)',
        borderColor: 'var(--color-border-muted)',
        color: 'var(--iv-text-3)',
      }}
    >
      <Check className="h-[7px] w-[7px] shrink-0" style={{ color: 'var(--color-profit)' }} />
      <span className="whitespace-nowrap">
        <span className="font-semibold" style={{ color: 'var(--iv-text)' }}>
          NVDA
        </span>
        {' · 1D · '}
        {t('chat.chartAnnotationCard.chipShownCount', { count })}
      </span>
    </span>
  );
}

/** Three draws: each runs, then lands on the chart. The first becomes the
    chip; the later ones settle as rows under it while the chip counts up. */
const DRAW = {
  runs: [300, 2100, 2900],
  dones: [1000, 2700, 3500],
  first: 1150,
  last: 3800,
};

const FIRST =
  '**186** capped the post-earnings high and the September rally, so it is the level to beat.';
const LAST =
  '**170.60 to 173.40** has held both pullbacks since the earnings gap. A close above 186 on volume is the breakout.';

function MarketDraw() {
  const t = useSceneTime();
  const [, second, third] = DRAW.dones;
  const count = t >= third ? 3 : t >= second ? 2 : 1;
  return (
    <div className="relative w-full max-w-[400px]">
      <MarketPage
        layout={FOLDED}
        quote={NVDA_QUOTE}
        last={NVDA_LAST}
        tab={null}
        clear={t >= DRAW.dones[0]}
        title={NOTE}
        chart={
          <Candles series={NVDA} scale={SCALE} hide={t >= DRAW.dones[0] ? [186] : []}>
            <PriceLine scale={SCALE} price={186} title="Resistance" at={DRAW.dones[0]} />
            <Zone
              scale={SCALE}
              from={19}
              to={48}
              low={170.6}
              high={173.4}
              label="Demand zone"
              at={second}
            />
            <VLine scale={SCALE} i={EARNINGS_BAR} label="Earnings" at={third} />
          </Candles>
        }
        transcript={
          <>
            <Sent at={-1} />
            <Prose text={LEAD} />
            {t < DRAW.dones[0] ? (
              <AnnotateRow at={DRAW.runs[0]} done={DRAW.dones[0]} />
            ) : (
              <ChartChip key={count} count={count} />
            )}
            <Prose text={FIRST} at={DRAW.first} cps={80} />
            <div className="flex flex-col">
              <AnnotateRow at={DRAW.runs[1]} done={second} />
              <AnnotateRow at={DRAW.runs[2]} done={third} />
            </div>
            <Prose text={LAST} at={DRAW.last} cps={70} />
          </>
        }
      />
    </div>
  );
}

export const marketScenes = {
  marketLive: { Scene: MarketLive, length: 6600, anchor: 'center' },
  marketAsk: { Scene: MarketAsk, length: 7200, anchor: 'center' },
  marketDraw: { Scene: MarketDraw, length: 6400, anchor: 'center' },
} satisfies Partial<Record<IntroVisualId, IntroScene>>;
