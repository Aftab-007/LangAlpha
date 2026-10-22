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
import { useSceneTime } from './clock';

/* The candlestick chart the market scenes and the file panel's chart tab
   share: MarketChart in miniature, as lightweight-charts paints it with the
   app's chart theme. Candles over a volume histogram in the bottom fifth of
   the price pane, MA20 and MA50, an RSI pane beneath, the price axis on the
   right with the last price on it, the time axis below. Over it go the
   user's selection (the teal region, its numbered pin, the note it takes)
   and the agent's event badges, each pinned to the bar its news hit. */
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

/** The time axis's marks, as lightweight-charts spaces them: a month where
    one starts, a day of the month between. The 49 sessions run Aug 13 to
    Oct 21, 2026. */
export const TIME_MARKS = [
  { i: 2, label: '17' },
  { i: 13, label: 'Sep' },
  { i: 21, label: '14' },
  { i: 34, label: 'Oct' },
  { i: 42, label: '13' },
];

/** NVDA's prior close and today's last, as every scene quotes them. */
export const NVDA_PREV = 179.53;
export const NVDA_LAST = 182.42;

/**
 * NVDA, daily, each move on news. It gapped up on earnings (Aug 27) into
 * 186.90 and faded, fell 3% in a day on a new export rule (Sep 8) and slid
 * to 170.60, turned on the Fed's cut (Sep 16) and rallied back to 186.30,
 * pulled back to 173.10, and turned again on an upgrade (Oct 7) to 182.42
 * today.
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
    184.0,
    182.6,
    181.9,
    180.6,
    180.2,
    174.8,
    173.4,
    171.9,
    171.3,
    172.0,
    171.6,
    175.1,
    176.3,
    177.9,
    179.4,
    178.8,
    181.2,
    183.0,
    184.6,
    183.2,
    181.1,
    179.3,
    177.6,
    176.0,
    174.9,
    174.0,
    178.1,
    178.6,
    177.9,
    179.2,
    180.1,
    179.4,
    180.7,
    181.2,
    180.4,
    NVDA_PREV,
    NVDA_LAST,
  ],
  180e6,
  1,
  {
    10: { o: 182.6, h: 186.8, l: 181.9, v: 412e6 },
    11: { h: 186.9 },
    17: { o: 179.6, h: 180.1, l: 174.3, v: 390e6 },
    20: { l: 170.6 },
    22: { l: 170.9 },
    23: { o: 171.9, h: 175.6, l: 171.4, v: 330e6 },
    30: { h: 186.3 },
    37: { l: 173.1 },
    38: { o: 174.3, h: 178.6, l: 173.9, v: 310e6 },
    48: { o: 180.4, h: 183.05, l: 180.15 },
  }
);

/** One `event` annotation: the bar it is pinned to, the price its badge
    anchors at, the headline on the badge and the story behind it. */
export interface ChartEvent {
  i: number;
  price: number;
  title: string;
  detail?: string;
}

/** The news the agent pins to NVDA's moves, each at the bar it hit. */
export const NVDA_EVENTS = {
  earnings: { i: 10, price: 184.5, title: 'Earnings beat' },
  exportRule: {
    i: 17,
    price: 180.1,
    title: 'New export rule',
    detail: 'Licenses tightened on AI chips sold abroad. NVDA fell 3% in a day.',
  },
  fedCut: { i: 23, price: 171.4, title: 'Fed cuts rates' },
  upgrade: { i: 38, price: 173.9, title: 'Analyst upgrade' },
} satisfies Record<string, ChartEvent>;

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

/** The chart: `s` laid out by `k`. `children` are overlays, positioned in
    the chart's px. */
export function Candles({
  series: s,
  scale: k,
  children,
}: {
  series: Series;
  scale: ChartScale;
  children?: ReactNode;
}) {
  const id = svgId(useId());
  const { bars } = s;
  const n = bars.length;
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
  return (
    // overlays may run past the chart, as a badge's detail does over the toolbar
    <div
      className="relative shrink-0"
      style={{ width: k.width, height: k.height, background: 'var(--color-bg-card)' }}
    >
      <svg width={k.width} height={k.height} className="absolute inset-0 block" aria-hidden>
        <defs>
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
        <g>
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
        <line
          x1={0}
          x2={k.paneW}
          y1={k.y(close)}
          y2={k.y(close)}
          stroke={close >= end.o ? UP : DOWN}
          strokeWidth={0.6}
          strokeDasharray="1 1.5"
        />
        {/* pane separator, then the axes' borders */}
        <line x1={0} x2={k.width} y1={k.priceH + 0.5} y2={k.priceH + 0.5} stroke={GRID} />
        <line x1={k.paneW + 0.5} x2={k.paneW + 0.5} y1={0} y2={plotH} stroke={GRID} />
        <line x1={0} x2={k.width} y1={plotH + 0.5} y2={plotH + 0.5} stroke={GRID} />
        {k.ticks
          .filter((tick) => Math.abs(k.y(tick) - k.y(close)) > 8)
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
        <AxisLabel
          x={k.paneW}
          y={k.y(close)}
          fill={close >= end.o ? UP : DOWN}
          text={close.toFixed(2)}
        />
        {/* the RSI pane: its label top left, its value on its own axis */}
        <text x={3} y={k.rsiTop + 6.5} fontSize={5} fill={AXIS_TEXT}>
          RSI (14)
        </text>
        <AxisLabel
          x={k.paneW}
          y={k.ry(rsiNow)}
          fill="var(--color-accent-primary)"
          text={rsiNow.toFixed(0)}
        />
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

/* ── the agent's event badges ──────────────────────────────────────────── */

/** An event's color when the agent names none (`DEFAULT_EVENT_COLOR`): the
    annotation amber, apart from the slate blue of technical marks. */
const EVENT_COLOR = '#E9954A';
/** A badge's center keeps this far from the pane's edges (`EDGE_X`). */
const EDGE_X = 15;
/** An anchor higher than this hangs its badge under it (`FLIP_Y`). */
const FLIP_Y = 22;

/**
 * An event annotation as `AgentEventOverlay` draws it, at half the app's
 * size: a dot ringed in the card color on the bar and price, and the
 * headline on an elevated badge whose caret points down at the dot (or up,
 * hung under a dot near the pane's top). Pops in at `at`. `hover` gives it
 * the accent edge; `open` shows the detail in a popover beside it.
 */
export function EventBadge({
  scale: k,
  ev,
  at = Number.NEGATIVE_INFINITY,
  hover = false,
  open = false,
}: {
  scale: ChartScale;
  ev: ChartEvent;
  at?: number;
  hover?: boolean;
  open?: boolean;
}) {
  if (useSceneTime() < at) return null;
  const x = Math.max(EDGE_X, Math.min(k.x(ev.i), k.paneW - EDGE_X));
  const y = k.y(ev.price);
  const below = y < FLIP_Y;
  const edge = hover || open ? 'var(--color-accent-primary)' : 'var(--color-border-muted)';
  return (
    <span className="absolute" style={{ left: x, top: y, zIndex: open ? 1 : undefined }}>
      <span
        className="intro-pop absolute block h-[3.5px] w-[3.5px] rounded-full"
        style={{
          left: -1.75,
          top: -1.75,
          background: EVENT_COLOR,
          boxShadow: '0 0 0 1px var(--color-bg-card)',
        }}
      />
      {/* centered on the anchor; the pop animates the badge's own transform */}
      <span
        className="absolute left-0 -translate-x-1/2"
        style={below ? { top: 4.5 } : { bottom: 4.5 }}
      >
        <span
          className="intro-pop relative flex items-center gap-[3px] whitespace-nowrap rounded-[3px] border px-[4.5px] py-[1.5px] text-[0.34375rem] font-semibold leading-[1.3]"
          style={{
            background: 'var(--color-bg-elevated)',
            borderColor: edge,
            color: 'var(--color-text-primary)',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.18)',
          }}
        >
          <span
            className="h-[3.5px] w-[3.5px] shrink-0 rounded-full"
            style={{ background: EVENT_COLOR }}
          />
          {ev.title}
          <span
            className="absolute left-1/2 h-[3.5px] w-[3.5px] -translate-x-1/2 rotate-45"
            style={{
              ...(below ? { top: -2 } : { bottom: -2 }),
              background: 'var(--color-bg-elevated)',
              borderColor: edge,
              borderStyle: 'solid',
              borderWidth: below ? '1px 0 0 1px' : '0 1px 1px 0',
            }}
          />
        </span>
        {open && ev.detail && (
          <EventDetail
            ev={ev}
            below={below}
            // kept inside the chart, as the popover's collision padding keeps it on screen
            shift={Math.max(DETAIL_W / 2 + 2, Math.min(x, k.width - DETAIL_W / 2 - 2)) - x}
          />
        )}
      </span>
    </span>
  );
}

const DETAIL_W = 140;

/** The badge's detail (`agent-event-pop`, a popover on its far side from the
    dot): the dot and headline, then the story in a few sentences. `shift`
    moves it off center. */
function EventDetail({ ev, below, shift }: { ev: ChartEvent; below: boolean; shift: number }) {
  return (
    <span
      className="intro-pop absolute left-1/2 z-10 flex flex-col gap-[3.5px] whitespace-normal rounded-[3px] border px-[7px] py-[6px]"
      style={{
        ...(below ? { top: 'calc(100% + 5px)' } : { bottom: 'calc(100% + 5px)' }),
        width: DETAIL_W,
        marginLeft: shift - DETAIL_W / 2,
        background: 'var(--color-bg-popover)',
        borderColor: 'var(--color-border-default)',
        boxShadow: '0 2px 6px rgba(0, 0, 0, 0.12)',
      }}
    >
      <span className="flex items-center gap-[3.5px]">
        <span className="h-1 w-1 shrink-0 rounded-full" style={{ background: EVENT_COLOR }} />
        <span
          className="text-[0.40625rem] font-bold leading-none"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {ev.title}
        </span>
      </span>
      <span
        className="text-[0.390625rem] font-normal leading-[1.55]"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        {ev.detail}
      </span>
    </span>
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
