import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  ChevronDown,
  Plus,
  Ruler,
  SquareDashedMousePointer,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ease, useSceneTime } from './clock';

/* The candlestick chart the market scenes and the file panel's chart tab
   share: MarketChart in miniature, as lightweight-charts paints it with the
   app's chart theme. Candles over a volume histogram in the bottom fifth of
   the price pane, MA20 and MA50, an RSI pane beneath, the price axis on the
   right with the last price on it, the time axis below. Over it go the
   user's selection (the teal region, its numbered pin, the note it takes)
   and the agent's annotations (price line, zone, vertical line, each
   labelled with the chip the app draws). Everything reads the scene clock. */
/* eslint-disable react-refresh/only-export-components -- shared chart: the
   chart, its overlays and toolbar parts, plus the series and its scale */

/** One daily bar. */
export interface Ohlc {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** A symbol's visible bars with what the chart derives from them. */
export interface Series {
  sym: string;
  bars: Ohlc[];
  /** MA20 then MA50, one value per visible bar, in the app's MA colors. */
  ma: { color: string; values: number[] }[];
  /** RSI (14), one value per visible bar. */
  rsi: number[];
}

/* ── the series ────────────────────────────────────────────────────────── */

/** A repeatable 0 to 1 jitter for bar `i`. */
function jitter(i: number, salt: number): number {
  const s = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Daily bars from closes: each opens near the last close and wicks a little
    past its body, and volume swells with the size of the move. `fixed` pins
    the bars the story turns on. */
function toBars(
  closes: number[],
  first: number,
  volume: number,
  salt: number,
  fixed: Record<number, Partial<Ohlc>>
): Ohlc[] {
  let prev = first;
  return closes.map((c, i) => {
    const o = prev + (jitter(i, salt) - 0.5) * 0.9;
    const reach = 0.45 + Math.abs(c - o) * 0.2;
    const bar = {
      o,
      c,
      h: Math.max(o, c) + 0.12 + jitter(i, salt + 1) * reach,
      l: Math.min(o, c) - 0.12 - jitter(i, salt + 2) * reach,
      v: volume * (0.7 + jitter(i, salt + 3) * 0.5) * (1 + (Math.abs(c - prev) / prev) * 18),
    };
    prev = c;
    return { ...bar, ...fixed[i] };
  });
}

/** The simple moving average of `closes`, from index `from` on. */
function sma(closes: number[], period: number, from: number): number[] {
  return closes.slice(from).map((_, k) => {
    const end = from + k + 1;
    const win = closes.slice(Math.max(0, end - period), end);
    return win.reduce((a, b) => a + b, 0) / win.length;
  });
}

/** Wilder's RSI of `closes`, from index `from` on. */
function rsiOf(closes: number[], period: number, from: number): number[] {
  let gain = 0;
  let loss = 0;
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    // the first `period` moves average plainly, then each folds in at 1/period
    const keep = i <= period ? 1 : (period - 1) / period;
    gain = gain * keep + Math.max(d, 0) / period;
    loss = loss * keep + Math.max(-d, 0) / period;
    if (i >= from) out.push(loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
  }
  return out;
}

/** A series from its history (for the averages and RSI) and its visible closes. */
function seriesOf(
  sym: string,
  prior: number[],
  closes: number[],
  volume: number,
  salt: number,
  fixed: Record<number, Partial<Ohlc>> = {}
): Series {
  const all = [...prior, ...closes];
  const from = prior.length;
  return {
    sym,
    bars: toBars(closes, prior[from - 1], volume, salt, fixed),
    ma: [
      { color: '#fbbf24', values: sma(all, 20, from) },
      { color: '#3b82f6', values: sma(all, 50, from) },
    ],
    rsi: rsiOf(all, 14, from),
  };
}

/** Sixty closes before the visible stretch, for the averages and RSI. */
function priorCloses(base: number, rise: number): number[] {
  return Array.from(
    { length: 60 },
    (_, k) => base + (rise * k) / 59 + 2.6 * Math.sin(k * 0.45) + 1.2 * Math.sin(k * 1.3)
  );
}

/** The visible stretch: 49 sessions, Aug 13 to Oct 21, 2026. */
export const SESSIONS = 49;

/** The time axis's marks, as lightweight-charts spaces them: a month where
    one starts, a day of the month between. */
export const TIME_MARKS = [
  { i: 2, label: '17' },
  { i: 13, label: 'Sep' },
  { i: 21, label: '14' },
  { i: 34, label: 'Oct' },
  { i: 42, label: '13' },
];

/** The session NVDA reported in (Aug 27), the gap the scenes talk about. */
export const EARNINGS_BAR = 10;

/** NVDA's prior close and today's last, as every scene quotes them. */
export const NVDA_PREV = 179.53;
export const NVDA_LAST = 182.42;

/**
 * NVDA, daily. It gapped up on earnings (Aug 27) into 186.90, faded through
 * the gap to a 170.60 low by mid-September, rallied back to 186.30 and
 * stalled again, dipped to 173.10, and is back at 182.42 today: 186 has
 * capped two rallies, and 170.60 to 173.40 has held two pullbacks.
 */
export const NVDA = seriesOf(
  'NVDA',
  priorCloses(160, 9),
  [
    170.2,
    171.4,
    170.8,
    172.1,
    173.5,
    172.9,
    174.2,
    175.0,
    174.4,
    176.1,
    184.5,
    185.3,
    183.6,
    181.2,
    179.4,
    177.6,
    178.3,
    176.0,
    174.1,
    172.4,
    171.3,
    172.6,
    171.8,
    173.9,
    175.2,
    176.8,
    178.5,
    177.9,
    180.2,
    182.6,
    184.1,
    182.9,
    180.7,
    179.0,
    177.2,
    175.8,
    174.6,
    174.0,
    175.4,
    176.9,
    176.2,
    177.8,
    179.1,
    178.4,
    180.3,
    181.0,
    180.2,
    NVDA_PREV,
    NVDA_LAST,
  ],
  180e6,
  1,
  {
    10: { o: 182.6, h: 186.8, l: 181.9, v: 412e6 },
    11: { h: 186.9 },
    20: { l: 170.6 },
    22: { l: 170.9 },
    30: { h: 186.3 },
    37: { l: 173.1 },
    48: { o: 180.4, h: 183.05, l: 180.15 },
  }
);

/** AAPL, daily: the chart on screen before the search switches to NVDA. */
export const AAPL = seriesOf(
  'AAPL',
  priorCloses(212, 8),
  Array.from({ length: SESSIONS }, (_, i) =>
    i === SESSIONS - 2
      ? 226.8
      : i === SESSIONS - 1
        ? 226.62
        : 220.5 + i * 0.12 + 3.4 * Math.sin(i * 0.23) + 1.8 * Math.sin(i * 0.71)
  ),
  52e6,
  4
);

/** Where the live feed has the last bar's close at `t`: it ticks every
    `every` ms from `from` and settles on the last value. */
export function liveTick(t: number, from: number, ticks: number[], every = 450): number {
  const k = Math.floor((t - from) / every);
  return ticks[Math.min(Math.max(k, 0), ticks.length - 1)];
}

/* ── the scale ─────────────────────────────────────────────────────────── */

const AXIS_W = 24;
const TIME_H = 10;
/** The empty room right of the last bar, where the next one will print. */
const RIGHT_GAP = 5;

/** Where things sit on a chart `width` × `height` px: the price pane and its
    volume, the RSI pane under it, the price axis right of both. */
export interface ChartScale {
  width: number;
  height: number;
  paneW: number;
  priceH: number;
  rsiTop: number;
  rsiH: number;
  step: number;
  /** A bar's center. */
  x: (i: number) => number;
  /** A price's height. */
  y: (p: number) => number;
  /** An RSI value's height. */
  ry: (v: number) => number;
  /** The price at a height. */
  priceAt: (y: number) => number;
  /** Labelled levels on the price axis. */
  ticks: number[];
}

/** Price steps an axis picks among, smallest first. */
const STEPS = [1, 2, 2.5, 5, 10, 20, 25, 50];

/** The chart's layout for `s` at `width` × `height`. The price scale fits the
    bars and the averages, inside the app's margins (10% top, 20% bottom, the
    volume's fifth), as the chart's autoscale does. */
export function chartScale(s: Series, width: number, height: number): ChartScale {
  const paneW = width - AXIS_W;
  const plotH = height - TIME_H;
  const priceH = Math.round(plotH * 0.8);
  const rsiTop = priceH + 1;
  const rsiH = plotH - rsiTop;
  const step = (paneW - RIGHT_GAP) / s.bars.length;
  const prices = [...s.bars.flatMap((b) => [b.h, b.l]), ...s.ma.flatMap((m) => m.values)];
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const top = priceH * 0.1;
  const span = priceH * 0.7;
  const y = (p: number) => top + ((hi - p) / (hi - lo)) * span;
  const rlo = Math.min(...s.rsi);
  const rhi = Math.max(...s.rsi);
  const tick = STEPS.find((d) => (hi - lo) / d <= 5) ?? 100;
  const ticks: number[] = [];
  for (let p = Math.ceil((lo - 4 * tick) / tick) * tick; p <= hi + 4 * tick; p += tick) {
    if (y(p) > 6 && y(p) < priceH - 5) ticks.push(p);
  }
  return {
    width,
    height,
    paneW,
    priceH,
    rsiTop,
    rsiH,
    step,
    x: (i) => (i + 0.5) * step,
    y,
    ry: (v) => rsiTop + rsiH * 0.18 + ((rhi - v) / (rhi - rlo)) * rsiH * 0.64,
    priceAt: (py) => hi - ((py - top) / span) * (hi - lo),
    ticks,
  };
}

/* ── the chart ─────────────────────────────────────────────────────────── */

/** An id usable inside `url(#…)`: React's ids carry colons. */
function svgId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '');
}

const GRID = 'var(--color-border-default)';
const AXIS_TEXT = 'var(--color-text-secondary)';
const UP = 'var(--color-profit)';
const DOWN = 'var(--color-loss)';

/** A value on the price axis in a filled box, as the chart marks its last
    price and each price line. */
function AxisLabel({ x, y, fill, text }: { x: number; y: number; fill: string; text: string }) {
  return (
    <g>
      <rect x={x} y={y - 4} width={AXIS_W} height={8} rx={1} fill={fill} />
      <text x={x + 3} y={y + 1.8} fontSize={5} fill="#fff" className="tabular-nums">
        {text}
      </text>
    </g>
  );
}

/**
 * The chart: `s` laid out by `k`, revealed left to right over
 * `[at, at + dur]` (drawn whole with no `at`). `last` moves the last
 * bar's close as the live feed ticks. `children` are overlays, positioned in
 * the chart's px.
 */
export function Candles({
  series: s,
  scale: k,
  at = Number.NEGATIVE_INFINITY,
  dur = 1100,
  last,
  hide = [],
  children,
}: {
  series: Series;
  scale: ChartScale;
  at?: number;
  dur?: number;
  last?: number;
  /** Prices whose labels sit on the axis (a price line's), so the levels
      under them go unlabelled. */
  hide?: number[];
  children?: ReactNode;
}) {
  const id = svgId(useId());
  const p = ease(useSceneTime(), at, dur);
  const n = s.bars.length;
  const bars =
    last == null
      ? s.bars
      : s.bars.map((b, i) =>
          i === n - 1 ? { ...b, c: last, h: Math.max(b.h, last), l: Math.min(b.l, last) } : b
        );
  const end = bars[n - 1];
  const close = end.c;
  const vmax = Math.max(...bars.map((b) => b.v));
  const volTop = k.priceH * 0.8;
  const body = Math.max(k.step * 0.68, 1.2);
  const plotH = k.height - TIME_H;
  const line = (vals: number[], f: (v: number) => number) =>
    vals.map((v, i) => `${k.x(i).toFixed(2)},${f(v).toFixed(2)}`).join(' ');
  const rsiLine = line(s.rsi, k.ry);
  const rsiArea = `${rsiLine} ${k.x(n - 1)},${k.rsiTop + k.rsiH} ${k.x(0)},${k.rsiTop + k.rsiH}`;
  const rsiNow = s.rsi[n - 1];
  const done = p >= 1;
  return (
    <div
      className="relative shrink-0 overflow-hidden"
      style={{ width: k.width, height: k.height, background: 'var(--color-bg-card)' }}
    >
      <svg width={k.width} height={k.height} className="absolute inset-0 block" aria-hidden>
        <defs>
          <clipPath id={`${id}-reveal`}>
            <rect x={0} y={0} width={k.paneW * p} height={plotH} />
          </clipPath>
          <linearGradient id={`${id}-rsi`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent-primary)" stopOpacity={0.2} />
            <stop offset="100%" stopColor="var(--color-accent-primary)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {/* grid */}
        {k.ticks.map((tick) => (
          <line
            key={tick}
            x1={0}
            x2={k.paneW}
            y1={k.y(tick)}
            y2={k.y(tick)}
            stroke={GRID}
            strokeWidth={0.5}
          />
        ))}
        {TIME_MARKS.map(({ i }) => (
          <line key={i} x1={k.x(i)} x2={k.x(i)} y1={0} y2={plotH} stroke={GRID} strokeWidth={0.5} />
        ))}
        <g clipPath={`url(#${id}-reveal)`}>
          {/* volume, in the bottom fifth of the price pane */}
          {bars.map((b, i) => {
            const h = (b.v / vmax) * (k.priceH - volTop);
            return (
              <rect
                key={`v${i}`}
                x={k.x(i) - body / 2}
                y={k.priceH - h}
                width={body}
                height={h}
                fill={b.c >= b.o ? UP : DOWN}
                fillOpacity={0.3}
              />
            );
          })}
          {/* candles: no borders, wicks in the body's color */}
          {bars.map((b, i) => {
            const color = b.c >= b.o ? UP : DOWN;
            const top = k.y(Math.max(b.o, b.c));
            return (
              <g key={`c${i}`}>
                <line
                  x1={k.x(i)}
                  x2={k.x(i)}
                  y1={k.y(b.h)}
                  y2={k.y(b.l)}
                  stroke={color}
                  strokeWidth={0.7}
                />
                <rect
                  x={k.x(i) - body / 2}
                  y={top}
                  width={body}
                  height={Math.max(k.y(Math.min(b.o, b.c)) - top, 0.7)}
                  fill={color}
                />
              </g>
            );
          })}
          {s.ma.map((m) => (
            <polyline
              key={m.color}
              points={line(m.values, k.y)}
              fill="none"
              stroke={m.color}
              strokeWidth={0.9}
              strokeLinejoin="round"
            />
          ))}
          <polygon points={rsiArea} fill={`url(#${id}-rsi)`} />
          <polyline
            points={rsiLine}
            fill="none"
            stroke="var(--color-accent-primary)"
            strokeWidth={1}
            strokeLinejoin="round"
          />
        </g>
        {/* the last price's line, dotted in the last bar's color */}
        {done && (
          <line
            x1={0}
            x2={k.paneW}
            y1={k.y(close)}
            y2={k.y(close)}
            stroke={close >= end.o ? UP : DOWN}
            strokeWidth={0.6}
            strokeDasharray="1 1.5"
          />
        )}
        {/* pane separator, then the axes' borders */}
        <line x1={0} x2={k.width} y1={k.priceH + 0.5} y2={k.priceH + 0.5} stroke={GRID} />
        <line x1={k.paneW + 0.5} x2={k.paneW + 0.5} y1={0} y2={plotH} stroke={GRID} />
        <line x1={0} x2={k.width} y1={plotH + 0.5} y2={plotH + 0.5} stroke={GRID} />
        {k.ticks
          .filter((tick) =>
            [...hide, ...(done ? [close] : [])].every((p) => Math.abs(k.y(tick) - k.y(p)) > 8)
          )
          .map((tick) => (
            <text
              key={tick}
              x={k.paneW + 3}
              y={k.y(tick) + 1.8}
              fontSize={5}
              fill={AXIS_TEXT}
              className="tabular-nums"
            >
              {tick.toFixed(2)}
            </text>
          ))}
        {done && (
          <AxisLabel
            x={k.paneW}
            y={k.y(close)}
            fill={close >= end.o ? UP : DOWN}
            text={close.toFixed(2)}
          />
        )}
        {/* the RSI pane: its label top left, its value on its own axis */}
        <text x={3} y={k.rsiTop + 6.5} fontSize={5} fill={AXIS_TEXT}>
          RSI (14)
        </text>
        {done && (
          <AxisLabel
            x={k.paneW}
            y={k.ry(rsiNow)}
            fill="var(--color-accent-primary)"
            text={rsiNow.toFixed(0)}
          />
        )}
        {TIME_MARKS.map(({ i, label }) => (
          <text key={i} x={k.x(i)} y={plotH + 7} fontSize={5} fill={AXIS_TEXT} textAnchor="middle">
            {label}
          </text>
        ))}
      </svg>
      {children}
    </div>
  );
}

/* ── the agent's annotations ───────────────────────────────────────────── */

/** The app's default annotation color: technical marks in slate blue. */
export const ANNOTATION_BLUE = '#4F8AD6';

/** The label an annotation carries (`agentAnnotationsPrimitive`): the
    annotation's color as a dot, then ink on a card chip, set left of `x` or
    centered on it. */
export function AnnotationChip({
  x,
  y,
  color,
  center = false,
  children,
}: {
  x: number;
  y: number;
  color: string;
  center?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className="absolute"
      style={{ left: x, top: y, transform: center ? 'translateX(-50%)' : undefined }}
    >
      <span
        className={cn(
          'intro-pop flex h-[9px] items-center gap-[3px] whitespace-nowrap rounded-[2px] border',
          'px-[3.5px] text-[0.3125rem] font-semibold leading-none'
        )}
        style={{
          background: 'var(--color-bg-card)',
          borderColor: 'var(--color-border-default)',
          color: 'var(--iv-text)',
        }}
      >
        <span className="h-[3px] w-[3px] shrink-0 rounded-full" style={{ background: color }} />
        {children}
      </span>
    </span>
  );
}

/** A price line (`createPriceLine`): dashed across the pane, drawn left to
    right from `at`, its title on the pane's edge and its price on the axis,
    both on the line's color. */
export function PriceLine({
  scale: k,
  price,
  title,
  at,
  color = ANNOTATION_BLUE,
}: {
  scale: ChartScale;
  price: number;
  title: string;
  at: number;
  color?: string;
}) {
  const t = useSceneTime();
  if (t < at) return null;
  const p = ease(t, at, 520);
  const y = k.y(price);
  return (
    <>
      <span
        className="absolute left-0 border-t border-dashed"
        style={{ top: y - 0.5, width: k.paneW * p, borderColor: color }}
      />
      {p > 0.7 && (
        <>
          <span
            className="intro-pop absolute flex h-2 items-center rounded-[1px] px-[3px] text-[0.3125rem] leading-none text-white"
            style={{ right: k.width - k.paneW + 1, top: y - 4, background: color }}
          >
            {title}
          </span>
          <span
            className="absolute flex h-2 items-center rounded-[1px] pl-[3px] text-[0.3125rem] leading-none text-white tabular-nums"
            style={{ left: k.paneW, top: y - 4, width: k.width - k.paneW, background: color }}
          >
            {price.toFixed(2)}
          </span>
        </>
      )}
    </>
  );
}

/** A rectangle the agent draws over bars `from` to `to` between two prices:
    a light fill of its color under a fine edge, growing in from the left,
    its chip in the top left corner. */
export function Zone({
  scale: k,
  from,
  to,
  low,
  high,
  label,
  at,
  color = ANNOTATION_BLUE,
}: {
  scale: ChartScale;
  from: number;
  to: number;
  low: number;
  high: number;
  label: string;
  at: number;
  color?: string;
}) {
  const t = useSceneTime();
  if (t < at) return null;
  const p = ease(t, at, 600);
  const left = k.x(from) - k.step / 2;
  const top = k.y(high);
  return (
    <>
      <span
        className="absolute border"
        style={{
          left,
          top,
          width: (k.x(to) + k.step / 2 - left) * p,
          height: k.y(low) - top,
          background: `${color}1A`,
          borderColor: `${color}B3`,
        }}
      />
      {p > 0.5 && (
        <AnnotationChip x={left + 2} y={top + 2} color={color}>
          {label}
        </AnnotationChip>
      )}
    </>
  );
}

/** A vertical line at bar `i`, dashed the height of the price pane, drawn
    down from `at`, its chip centered at the top. */
export function VLine({
  scale: k,
  i,
  label,
  at,
  color = ANNOTATION_BLUE,
}: {
  scale: ChartScale;
  i: number;
  label: string;
  at: number;
  color?: string;
}) {
  const t = useSceneTime();
  if (t < at) return null;
  const p = ease(t, at, 520);
  return (
    <>
      <span
        className="absolute top-0 border-l border-dashed"
        style={{ left: k.x(i) - 0.5, height: k.priceH * p, borderColor: `${color}CC` }}
      />
      {p > 0.4 && (
        <AnnotationChip x={k.x(i)} y={2} color={color} center>
          {label}
        </AnnotationChip>
      )}
    </>
  );
}

/* ── the user's selection ──────────────────────────────────────────────── */

/** A region being drawn or held (`SelectionPrimitive`): a teal box, dashed,
    bolder while it is the one being edited. Corners in chart px. */
export function Selection({
  x0,
  y0,
  x1,
  y1,
  active = true,
}: {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  active?: boolean;
}) {
  return (
    <span
      className="absolute border-dashed"
      style={{
        left: Math.min(x0, x1),
        top: Math.min(y0, y1),
        width: Math.abs(x1 - x0),
        height: Math.abs(y1 - y0),
        borderWidth: active ? 1.25 : 1,
        borderColor: `rgba(31, 184, 201, ${active ? 0.98 : 0.6})`,
        background: 'rgba(31, 184, 201, 0.12)',
      }}
    />
  );
}

/** The numbered marker a confirmed selection keeps (`.selection-pin`): amber,
    its bottom left corner sharp, a comment's tail. */
export function Pin({ n, left, top }: { n: number; left?: number; top?: number }) {
  return (
    <span
      className={cn(
        'flex h-2.5 min-w-2.5 shrink-0 items-center justify-center px-[3px]',
        'text-[0.375rem] font-bold leading-none',
        left != null && 'intro-pop absolute'
      )}
      style={{
        left,
        top,
        borderRadius: '5px 5px 5px 1.5px',
        background: 'var(--color-accent-primary)',
        color: 'var(--color-text-on-accent)',
      }}
    >
      {n}
    </span>
  );
}

/** The comment box beside a fresh selection (`SelectionCommentOverlay`): its
    pin, the note's pill with Add (Plus) while it is new, and the discard X.
    Its width, for placing it. */
export const COMMENT_W = 100;

export function CommentBox({
  left,
  top,
  width = COMMENT_W,
  text,
  pressed = false,
}: {
  left: number;
  top: number;
  width?: number;
  /** What has been typed; the placeholder until then. */
  text?: ReactNode;
  pressed?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <span className="intro-pop absolute flex items-center gap-[3px]" style={{ left, top, width }}>
      <Pin n={1} />
      <span
        className="flex h-4 min-w-0 flex-1 items-center gap-[2px] rounded-full border pl-[5px] pr-[2px]"
        style={{ background: 'var(--color-bg-elevated)', borderColor: 'var(--color-border-muted)' }}
      >
        <span
          className="min-w-0 flex-1 truncate text-[0.375rem] leading-none"
          style={{ color: text == null ? 'var(--color-text-tertiary)' : 'var(--iv-text)' }}
        >
          {text ?? t('marketView.selection.commentPlaceholder')}
        </span>
        <span
          className="flex h-3 w-3 shrink-0 items-center justify-center rounded-full transition-transform duration-150"
          style={{
            background: 'var(--color-btn-primary-bg)',
            color: 'var(--color-btn-primary-text)',
            transform: pressed ? 'scale(0.85)' : undefined,
          }}
        >
          {pressed ? <Check className="h-[6px] w-[6px]" /> : <Plus className="h-[7px] w-[7px]" />}
        </span>
      </span>
      <span
        className="flex h-[11px] w-[11px] shrink-0 items-center justify-center rounded-full border"
        style={{
          background: 'var(--color-bg-elevated)',
          borderColor: 'var(--color-border-muted)',
          color: 'var(--iv-text-2)',
        }}
      >
        <X className="h-[6px] w-[6px]" />
      </span>
    </span>
  );
}

/** The comment box's Add button, from the box's top left. */
export const addButton = (box: { left: number; top: number }, w = COMMENT_W) => ({
  x: box.left + w - 23,
  y: box.top + 8,
});

/** Where the comment box sits for a region spanning chart x `left` to
    `right` with its top at `top`: past the right edge, or flipped left of the
    region when the pane runs out, as the overlay places it. Same for a pin
    `w` wide. */
export function besideRegion(
  k: ChartScale,
  left: number,
  right: number,
  top: number,
  w = COMMENT_W
): { left: number; top: number } {
  const gap = 3;
  const x = right + gap + w + 2 > k.paneW ? left - gap - w : right + gap;
  return { left: Math.max(x, 2), top };
}

/* ── the toolbar ───────────────────────────────────────────────────────── */

/** A toolbar button (`.chart-tool-btn`): `on` is the tool that is armed. */
export function ToolBtn({
  icon: Icon,
  on = false,
  children,
}: {
  icon: LucideIcon;
  on?: boolean;
  children?: ReactNode;
}) {
  return (
    <span
      className={cn(
        'flex h-[11px] shrink-0 items-center justify-center gap-[2px] rounded-[2px] border',
        'text-[0.3125rem] leading-none',
        children ? 'px-[2px]' : 'w-[11px]'
      )}
      style={{
        background: on ? 'var(--color-bg-hover)' : 'var(--color-bg-surface)',
        borderColor: on ? 'var(--color-accent-primary)' : 'var(--color-border-elevated)',
        color: on ? 'var(--iv-text)' : 'var(--iv-text-2)',
      }}
    >
      <Icon className="h-[6px] w-[6px] shrink-0" />
      {children}
    </span>
  );
}

/** Region, then Price level: the hand-off to the agent, never in a menu. */
export function SelectionTools({ armed = false }: { armed?: boolean }) {
  return (
    <span className="flex gap-[2px]">
      <ToolBtn icon={SquareDashedMousePointer} on={armed} />
      <ToolBtn icon={Ruler} />
    </span>
  );
}

/** Clear, shown while the agent's drawing is on the chart. */
export function ClearButton() {
  const { t } = useTranslation();
  return <ToolBtn icon={X}>{t('marketView.chart.clearAnnotations')}</ToolBtn>;
}

/** A segmented control (`.interval-selector`), the picked one raised. */
export function Segmented({
  items,
  active,
  mono = false,
  className,
}: {
  items: ReactNode[];
  active: number;
  mono?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn('flex shrink-0 gap-[1px] rounded-[3px] p-[1px]', className)}
      style={{ background: 'var(--color-bg-surface)' }}
    >
      {items.map((item, i) => (
        <span
          key={i}
          className={cn(
            'flex flex-auto items-center justify-center gap-[1px] whitespace-nowrap rounded-[2px]',
            'px-[2.5px] py-[2px] text-[0.3125rem] leading-none',
            mono && 'font-mono',
            i === active ? 'font-semibold' : 'font-medium'
          )}
          style={
            i === active
              ? { background: 'var(--color-bg-card)', color: 'var(--iv-text)' }
              : { color: 'var(--iv-text-2)' }
          }
        >
          {item}
        </span>
      ))}
    </span>
  );
}

/** The interval picker: 1m, 1D (picked), More. */
export function Intervals() {
  const { t } = useTranslation();
  return (
    <Segmented
      mono
      active={1}
      items={[
        '1m',
        '1D',
        <span key="more" className="flex items-center gap-[1px] font-sans">
          {t('marketView.chart.more')}
          <ChevronDown className="h-[5px] w-[5px]" />
        </span>,
      ]}
    />
  );
}

/** Beside a ticker legend the intervals are text (`chart--with-lead`), set
    off by a divider; with the legend taking most of a narrow row the primary
    intervals fold into their dropdown, so the picker is the one button. */
export function FoldedIntervals() {
  return (
    <span
      className="flex shrink-0 items-center gap-[1px] border-l pl-[4px] font-mono text-[0.34375rem] font-semibold leading-none"
      style={{ borderColor: 'var(--color-border-default)', color: 'var(--iv-text)' }}
    >
      1D
      <ChevronDown className="h-[5px] w-[5px]" style={{ color: 'var(--iv-text-2)' }} />
    </span>
  );
}
