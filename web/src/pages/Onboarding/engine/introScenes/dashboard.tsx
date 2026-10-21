import {
  CandlestickChart,
  Eye,
  Grid2x2,
  Layers,
  Newspaper,
  Plus,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { IntroVisualId } from '../../registry';
import { ease, useSceneTime } from './clock';
import { Appear, Cursor, Frame, Ln, pointAt, type Waypoint } from './kit';
import type { IntroScene } from './types';
import {
  upColor,
  signed,
  money,
  WATCH,
  Spark,
  DashTopbar,
  PAGE,
  Floating,
  Composer,
  Widget,
} from './dashboardParts';
import { WatchRow, NEWS, NewsRow, ClassicBody } from './dashboardClassic';

/* Scenes for the dashboard intro: the live page, and customizing it. Each
   part is drawn after its real counterpart under pages/Dashboard, in
   miniature, with the app's own strings for its labels. */
/* eslint-disable react-refresh/only-export-components -- scene module:
   private scene components, one record export */

/** The page live: the brief writes itself, the index lines trace in and keep
    taking new points, quotes tick (their times are in INDICES and WATCH). */
export const GRID = {
  brief: 600,
  briefPer: 260,
  draw: 700,
  drawDur: 1100,
  shifts: [2400, 3400, 4400],
  shiftDur: 520,
  length: 5600,
};

export function DashboardGrid() {
  return (
    <Frame topbar={<DashTopbar />}>
      <div className={PAGE}>
        <ClassicBody live />
        <Floating>
          <Composer delay={0.46} />
        </Floating>
      </div>
    </Frame>
  );
}

/** The price chart's daily candles: open, close, high, low (y grows down). */
const CANDLES: [number, number, number, number][] = [
  [30, 27, 25, 32],
  [27, 28, 25, 30],
  [28, 24, 22, 29],
  [24, 22, 20, 26],
  [22, 25, 21, 27],
  [25, 21, 19, 26],
  [21, 18, 16, 23],
  [18, 19, 16, 21],
  [19, 15, 13, 20],
  [15, 12, 10, 17],
  [12, 13, 10, 15],
  [13, 9, 7, 14],
];

function PriceChartBody() {
  const nvda = WATCH[0];
  const v = nvda.ticks[nvda.ticks.length - 1].v;
  return (
    <>
      <span className="flex items-baseline gap-1">
        <span
          className="text-[0.4375rem] font-bold leading-none"
          style={{ color: 'var(--iv-text)' }}
        >
          {nvda.sym}
        </span>
        <span
          className="font-mono text-[0.4375rem] leading-none tabular-nums"
          style={{ color: 'var(--iv-text)' }}
        >
          {money(nvda.prev * (1 + v / 100))}
        </span>
        <span
          className="font-mono text-[0.375rem] leading-none tabular-nums"
          style={{ color: upColor(v) }}
        >
          {signed(v)}%
        </span>
      </span>
      <svg
        viewBox="0 0 100 36"
        preserveAspectRatio="none"
        className="min-h-0 w-full flex-1"
        aria-hidden
      >
        {CANDLES.map(([o, c, h, l], i) => {
          const x = 3 + i * 8;
          const col = c <= o ? 'var(--color-profit)' : 'var(--color-loss)';
          return (
            <g key={i}>
              <line
                x1={x + 2}
                x2={x + 2}
                y1={h}
                y2={l}
                stroke={col}
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              <rect
                x={x}
                y={Math.min(o, c)}
                width="4"
                height={Math.max(Math.abs(o - c), 0.8)}
                fill={col}
              />
            </g>
          );
        })}
      </svg>
    </>
  );
}

/** The Mini Chart Grid the + adds: a tile per symbol, its 30-day line. */
const MINI: { sym: string; v: number; series: number[] }[] = [
  { sym: 'AMZN', v: 0.84, series: [22, 20, 21, 16, 17, 12, 9] },
  { sym: 'GOOGL', v: -0.37, series: [12, 14, 11, 15, 17, 16, 20] },
  { sym: 'META', v: 1.12, series: [24, 19, 21, 17, 13, 14, 8] },
  { sym: 'AMD', v: -0.58, series: [10, 13, 12, 17, 15, 19, 21] },
];

function MiniChartBody() {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-1">
      {MINI.map(({ sym, v, series }, i) => (
        <Appear
          key={sym}
          at={CUSTOM.add + 200 + i * 60}
          reserve
          className="flex min-w-0 flex-col justify-between gap-[3px] rounded-[4px] border p-1"
          style={{ borderColor: 'var(--iv-border)' }}
        >
          <span className="flex items-center justify-between gap-0.5">
            <span
              className="text-[0.375rem] font-bold leading-none"
              style={{ color: 'var(--iv-text)' }}
            >
              {sym}
            </span>
            <span
              className="font-mono text-[0.3125rem] leading-none tabular-nums"
              style={{ color: upColor(v) }}
            >
              {signed(v)}%
            </span>
          </span>
          <Spark series={series} color={upColor(v)} className="h-3 w-10 self-end" />
        </Appear>
      ))}
    </div>
  );
}

/* ── dashboard · step 2: customize (Custom mode + add/drag widgets) ────── */

/** Customize, played out: flip to Custom, turn on edit mode with the pencil,
    carry the price chart one slot right (the watchlist slides over to make
    room), then add a widget from the edit toolbar. Pointer positions are px
    in the 400px scene, read off the layout below; COL is one grid column
    plus its gap. */
const CUSTOM = {
  toggle: 1000,
  edit: 1450,
  grab: 2250,
  carry: 2350,
  drop: 3250,
  add: 4300,
  length: 5400,
};
const COL = 118.7;
const TOGGLE = { x: 324, y: 13 };
const PENCIL = { x: 364, y: 13 };
const GRAB = { x: 166, y: 46 };
const DROP = { x: GRAB.x + COL, y: GRAB.y + 5 };
const ADD = { x: 138, y: 306 };
/** Past halfway, the watchlist gives up its slot. */
const SWAP = (CUSTOM.carry + CUSTOM.drop) / 2;
const CUSTOM_PATH: Waypoint[] = [
  { at: 300, x: 300, y: 200 },
  { at: 900, ...TOGGLE },
  { at: 1150, ...TOGGLE },
  { at: 1380, ...PENCIL },
  { at: 1600, ...PENCIL },
  { at: 2100, ...GRAB },
  { at: CUSTOM.carry, ...GRAB },
  { at: CUSTOM.drop, ...DROP },
  { at: 3650, ...DROP },
  { at: 4200, ...ADD },
];

/** The toolbar edit mode floats at the foot of the page. */
function EditToolbar() {
  const { t } = useTranslation();
  const btn =
    'flex items-center gap-[3px] rounded-full px-1.5 py-[3px] text-[0.4375rem] leading-none';
  return (
    <Appear
      at={CUSTOM.edit}
      className="flex items-center gap-0.5 rounded-full border px-1 py-[3px]"
      style={{
        background: 'var(--color-bg-elevated)',
        borderColor: 'var(--color-border-elevated)',
        boxShadow: '0 4px 12px -4px rgba(0, 0, 0, 0.25)',
      }}
    >
      <span
        className={`${btn} font-medium`}
        style={{
          background: 'var(--color-btn-primary-bg)',
          color: 'var(--color-btn-primary-text)',
        }}
      >
        <Plus className="h-2 w-2" />
        {t('dashboard.widgets.shell.addWidget')}
      </span>
      <span className={`${btn} font-medium`} style={{ color: 'var(--iv-text)' }}>
        <Layers className="h-2 w-2" />
        {t('dashboard.widgets.shell.presets')}
      </span>
      <span className={btn} style={{ color: 'var(--iv-text-2)' }}>
        <RotateCcw className="h-2 w-2" />
        {t('dashboard.widgets.shell.reset')}
      </span>
      <span className="mx-0.5 h-2.5 w-px" style={{ background: 'var(--iv-border)' }} />
      <span className={`${btn} font-medium`} style={{ color: 'var(--iv-text-2)' }}>
        <X className="h-2 w-2" />
        {t('dashboard.widgets.shell.done')}
      </span>
    </Appear>
  );
}

function CustomGrid({ edit }: { edit: boolean }) {
  const { t: tr } = useTranslation();
  const newsHeader = tr('dashboard.widgets.newsFeed.header', {
    label: tr('dashboard.widgets.newsFeed.tab_market'),
  });
  const t = useSceneTime();
  const held = t >= CUSTOM.grab;
  const dropped = t >= CUSTOM.drop;
  const swapped = t >= SWAP;
  const added = t >= CUSTOM.add + 120;
  // the price chart rides with the pointer while held, then settles into its
  // new slot from wherever the pointer let go
  const lift = ease(t, CUSTOM.grab, 160) * (1 - ease(t, CUSTOM.drop, 260));
  const settle = 1 - ease(t, CUSTOM.drop, 260);
  const p = pointAt(CUSTOM_PATH, t);
  const dx = dropped ? (DROP.x - GRAB.x - COL) * settle : held ? p.x - GRAB.x : 0;
  const dy = dropped ? (DROP.y - GRAB.y) * settle : held ? p.y - GRAB.y : 0;
  return (
    <Appear at={CUSTOM.toggle + 80} className="grid min-h-0 flex-1 grid-cols-3 grid-rows-2 gap-1.5">
      <div style={{ gridColumn: 1, gridRow: 1 }}>
        <Widget icon={Sparkles} title={tr('dashboard.widgets.insightBrief.title')} edit={edit}>
          <Ln w="88%" h={4} c="var(--iv-line-2)" />
          <Ln w="56%" h={4} c="var(--iv-line-2)" />
          <span className="h-0.5" />
          <Ln w="94%" />
          <Ln w="80%" />
          <Ln w="86%" />
          <Ln w="48%" />
        </Widget>
      </div>
      {/* where the held widget will land, as the grid marks it */}
      {held && t < CUSTOM.drop + 260 && (
        <div
          className="rounded-lg"
          style={{
            gridColumn: swapped ? 3 : 2,
            gridRow: 1,
            background: 'var(--color-accent-soft)',
          }}
        />
      )}
      {/* watchlist: slides one slot left once the chart passes halfway */}
      <div
        style={{
          gridColumn: swapped ? 2 : 3,
          gridRow: 1,
          transform: swapped ? `translateX(${COL * (1 - ease(t, SWAP, 300))}px)` : undefined,
        }}
      >
        <Widget
          icon={Eye}
          title={tr('dashboard.widgets.watchlist.title')}
          header={tr('dashboard.widgets.watchlist.header')}
          count="3"
          edit={edit}
        >
          {WATCH.slice(0, 3).map((row) => (
            <WatchRow key={row.sym} row={row} />
          ))}
        </Widget>
      </div>
      {/* the price chart, carried */}
      <div
        className="relative"
        style={{
          gridColumn: dropped ? 3 : 2,
          gridRow: 1,
          zIndex: held ? 2 : undefined,
          transform: `translate(${dx}px, ${dy}px) scale(${1 + 0.015 * lift})`,
        }}
      >
        <Widget
          icon={CandlestickChart}
          title={tr('dashboard.widgets.chart.title')}
          edit={edit}
          style={
            lift > 0
              ? {
                  boxShadow: `0 10px 20px -8px rgba(0, 0, 0, ${(0.28 * lift).toFixed(3)}), 0 0 0 ${
                    lift > 0.5 ? 1 : 0
                  }px var(--color-accent-primary)`,
                }
              : undefined
          }
        >
          <PriceChartBody />
        </Widget>
      </div>
      <div style={{ gridColumn: 1, gridRow: 2 }}>
        <Widget
          icon={Newspaper}
          title={tr('dashboard.widgets.newsFeed.title')}
          header={newsHeader}
          count="24"
          edit={edit}
        >
          {NEWS.slice(0, 2).map((item) => (
            <NewsRow key={item.title} item={item} />
          ))}
        </Widget>
      </div>
      {/* the widget the toolbar adds, dropped at the next open slot */}
      {added && (
        <Appear at={CUSTOM.add + 120} pop className="flex" style={{ gridColumn: 2, gridRow: 2 }}>
          <Widget
            icon={Grid2x2}
            title={tr('dashboard.widgets.miniChartGrid.title')}
            header={tr('dashboard.widgets.miniChartGrid.header')}
            edit={edit}
            className="flex-1"
          >
            <MiniChartBody />
          </Widget>
        </Appear>
      )}
    </Appear>
  );
}

function DashboardCustomize() {
  const t = useSceneTime();
  const custom = t >= CUSTOM.toggle;
  const edit = t >= CUSTOM.edit;
  return (
    <div className="relative w-full max-w-[400px]">
      <Frame topbar={<DashTopbar custom={custom} pencil edit={edit} />}>
        <div className={PAGE}>
          {t < CUSTOM.toggle + 80 ? (
            <ClassicBody />
          ) : (
            /* the grid stops short of the floating chat, as its rows do */
            <div className="flex min-h-0 flex-1 flex-col pb-[50px]">
              <CustomGrid edit={edit} />
            </div>
          )}
          {/* the floating chat, which edit mode swaps for its toolbar */}
          <Floating>{edit ? <EditToolbar /> : <Composer delay={0.46} />}</Floating>
        </div>
      </Frame>
      <Cursor path={CUSTOM_PATH} clicks={[CUSTOM.toggle, CUSTOM.edit, CUSTOM.add]} />
    </div>
  );
}

export const dashboardScenes = {
  dashboardGrid: { Scene: DashboardGrid, length: GRID.length, anchor: 'left' },
  dashboardCustomize: { Scene: DashboardCustomize, length: CUSTOM.length, anchor: 'right' },
} satisfies Partial<Record<IntroVisualId, IntroScene>>;
