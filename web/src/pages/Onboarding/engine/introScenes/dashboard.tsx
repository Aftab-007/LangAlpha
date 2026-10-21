import type { CSSProperties, ReactNode } from 'react';
import { GripVertical, Paperclip, Plus } from 'lucide-react';
import type { IntroVisualId } from '../../registry';
import { ease, useSceneTime, useTween } from './clock';
import {
  Appear,
  Cursor,
  Frame,
  InputDock,
  Ln,
  Region,
  StreamBlock,
  StreamLn,
  Typed,
  pointAt,
  rv,
  type Waypoint,
} from './kit';
import type { IntroScene } from './types';

/* Scenes for the dashboard intro: the live page, customizing it, and
   clipping a row into the chat. */
/* eslint-disable react-refresh/only-export-components -- scene module:
   private scene components, one record export */

/* ── live quotes ───────────────────────────────────────────────────────── */

/** A quote's % change over the script: each value holds from its `at`. */
type Ticks = { at: number; v: number }[];

/** How long a fresh tick reads in its direction's color before settling. */
const TICK_MS = 700;

/** The last value only, for the pages that sit still. */
const settled = (ticks: Ticks): Ticks => [{ at: 0, v: ticks[ticks.length - 1].v }];

/** A % change as it ticks: the latest value, colored by its sign, and for a
    moment after each tick by the tick's direction instead (a dip on a green
    name reads red, then settles back). */
function Change({ ticks }: { ticks: Ticks }) {
  const t = useSceneTime();
  let i = 0;
  while (i + 1 < ticks.length && ticks[i + 1].at <= t) i++;
  const { at, v } = ticks[i];
  const fresh = i > 0 && t - at < TICK_MS;
  const up = fresh ? v > ticks[i - 1].v : v >= 0;
  const c = up ? 'var(--iv-teal)' : 'var(--iv-red)';
  return (
    <span
      className="font-mono text-[0.5rem] leading-none transition-colors duration-300"
      style={{ color: fresh ? c : `color-mix(in srgb, ${c} 80%, transparent)` }}
    >
      {v >= 0 ? '+' : '-'}
      {Math.abs(v).toFixed(2)}%
    </span>
  );
}

/** The index strip. Its ticks run on DashboardGrid's script; the final
    signs are the static design's (up, up, down, up, down). */
const INDICES: { sym: string; ticks: Ticks }[] = [
  { sym: 'SPX', ticks: [{ at: 0, v: 0.31 }, { at: 1400, v: 0.38 }, { at: 4800, v: 0.42 }] },
  { sym: 'NDX', ticks: [{ at: 0, v: 0.62 }, { at: 4400, v: 0.71 }] },
  { sym: 'DJI', ticks: [{ at: 0, v: 0.05 }, { at: 2300, v: -0.02 }] },
  { sym: 'RUT', ticks: [{ at: 0, v: -0.14 }, { at: 3200, v: 0.09 }] },
  { sym: 'VIX', ticks: [{ at: 0, v: -1.2 }, { at: 3600, v: -1.64 }] },
];

const WATCH: { sym: string; ticks: Ticks }[] = [
  { sym: 'NVDA', ticks: [{ at: 0, v: 1.42 }, { at: 1900, v: 1.61 }] },
  { sym: 'AAPL', ticks: [{ at: 0, v: 0.12 }, { at: 2800, v: -0.08 }] },
  { sym: 'TSLA', ticks: [{ at: 0, v: 2.31 }, { at: 4000, v: 2.05 }] },
];

/* ── dashboard base: ticker strip + widgets ────────────────────────────── */

/** `live` plays the ticks; otherwise every quote sits on its last value. */
function TickerStrip({ delay = 0.1, live = false }: { delay?: number; live?: boolean }) {
  return (
    <div className="intro-rv flex gap-1.5" style={rv(delay)}>
      {INDICES.map(({ sym, ticks }) => (
        <Region key={sym} className="flex flex-1 flex-col gap-1 p-1.5">
          <span className="font-mono text-[0.4375rem] leading-none" style={{ color: 'var(--iv-text-3)' }}>
            {sym}
          </span>
          <Change ticks={live ? ticks : settled(ticks)} />
        </Region>
      ))}
    </div>
  );
}

function Watchlist({
  hot = false,
  live = false,
  delay = 0,
  className = '',
}: {
  hot?: boolean;
  live?: boolean;
  delay?: number;
  className?: string;
}) {
  return (
    <Region hot={hot} delay={delay} className={`flex flex-col gap-1.5 p-1.5 ${className}`}>
      <Ln w="46%" h={4} c="var(--iv-line-2)" />
      {WATCH.map(({ sym, ticks }) => (
        <div key={sym} className="flex items-center justify-between gap-2">
          <span className="font-mono text-[0.5rem] leading-none" style={{ color: 'var(--iv-text-2)' }}>
            {sym}
          </span>
          <Change ticks={live ? ticks : settled(ticks)} />
        </div>
      ))}
    </Region>
  );
}

/** The portfolio line. The series runs three points past the seven on
    screen, so each point that arrives slides the window a step left; the
    last seven are the finished frame. */
const SPARK = [26, 22, 25, 24, 20, 25, 13, 17, 8, 4];
const SPARK_STEPS = 6;

/** The line slid `slid` steps left and traced out to x = `reach` (of 100),
    clipped to the chart, plus where it ends. */
function sparkLine(slid: number, reach: number) {
  const step = 100 / SPARK_STEPS;
  const pts = SPARK.map((y, i) => ({ x: (i - slid) * step, y }));
  const out: string[] = [];
  let end = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (b.x <= 0 || a.x >= reach) continue;
    const yAt = (x: number) => a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
    const x0 = Math.max(a.x, 0);
    const x1 = Math.min(b.x, reach);
    if (out.length === 0) out.push(`${x0},${yAt(x0)}`);
    out.push(`${x1},${yAt(x1)}`);
    end = { x: x1, y: yAt(x1) };
  }
  return { points: out.join(' '), end };
}

function Spark({
  slid = SPARK.length - 1 - SPARK_STEPS,
  reach = 100,
  className = 'h-8',
}: {
  slid?: number;
  reach?: number;
  className?: string;
}) {
  const { points, end } = sparkLine(slid, reach);
  return (
    <svg viewBox="0 0 100 30" className={`w-full ${className}`} aria-hidden>
      {points && (
        <>
          <polyline
            points={points}
            fill="none"
            stroke="var(--iv-teal)"
            strokeWidth="1.6"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle cx={end.x} cy={end.y} r="1.7" fill="var(--iv-teal)" />
        </>
      )}
    </svg>
  );
}

const BRIEF = ['92%', '84%', '88%', '58%', '76%', '90%', '68%', '82%', '40%'];

/* ── dashboard · step 1: the whole page ────────────────────────────────── */

/** The page live: the brief writes itself, the portfolio line traces in
    and keeps taking new points, quotes tick (their times are in INDICES and
    WATCH). */
const GRID = {
  brief: 600,
  briefPer: 260,
  draw: 700,
  drawDur: 1100,
  shifts: [2400, 3400, 4400],
  shiftDur: 520,
  length: 5600,
};

function DashboardGrid() {
  const t = useSceneTime();
  const reach = 100 * ease(t, GRID.draw, GRID.drawDur);
  const slid = GRID.shifts.reduce((s, at) => s + ease(t, at, GRID.shiftDur), 0);
  return (
    <Frame topbar={<Ln w="30%" />}>
      <div className="flex flex-1 flex-col gap-1.5">
        <TickerStrip live />
        <div className="flex flex-1 gap-1.5">
          {/* brief / news canvas, written in */}
          <Region delay={0.22} className="flex flex-[1.5] flex-col gap-1.5 p-2">
            <StreamLn w="36%" h={4} c="var(--iv-line-2)" at={GRID.brief} dur={240} />
            <StreamBlock widths={BRIEF} at={GRID.brief + 300} per={GRID.briefPer} />
          </Region>
          <div className="flex flex-1 flex-col gap-1.5">
            <Watchlist live delay={0.32} />
            <Region delay={0.42} className="flex flex-1 flex-col justify-center p-1.5">
              <Spark slid={slid} reach={reach} />
            </Region>
          </div>
        </div>
      </div>
    </Frame>
  );
}

/* ── dashboard · step 2: customize (Custom mode + add/drag widgets) ────── */

/** Customize, played out: flip to Custom, carry the chart widget one slot
    right (the watchlist slides over to make room), then add a widget from
    the + tile. Pointer positions are px in the 400px scene, read off the
    layout below; COL is one grid column plus its gap. */
const CUSTOM = {
  toggle: 1000,
  grab: 2250,
  carry: 2350,
  drop: 3250,
  add: 4300,
  length: 5400,
};
const COL = 118.7;
const TOGGLE = { x: 362, y: 15 };
const GRAB = { x: 258, y: 89 };
const DROP = { x: GRAB.x + COL, y: GRAB.y + 5 };
const PLUS = { x: 212, y: 258 };
/** The mockup surface is translucent; three layers of it hide whatever a
    held widget passes over. */
const SURFACE = 'linear-gradient(var(--iv-mk-bg), var(--iv-mk-bg))';
const HELD_BG = `${SURFACE}, ${SURFACE}, var(--iv-mk-bg)`;
/** Past halfway, the watchlist gives up its slot. */
const SWAP = (CUSTOM.carry + CUSTOM.drop) / 2;
const CUSTOM_PATH: Waypoint[] = [
  { at: 300, x: 300, y: 200 },
  { at: 900, ...TOGGLE },
  { at: 1500, ...TOGGLE },
  { at: 2100, ...GRAB },
  { at: CUSTOM.carry, ...GRAB },
  { at: CUSTOM.drop, ...DROP },
  { at: 3650, ...DROP },
  { at: 4200, ...PLUS },
];

/** The Classic / Custom switch; its pill slides over at `at`. */
function ModeToggle({ at }: { at: number }) {
  const k = useTween(at, 220);
  return (
    <span
      className="relative ml-auto flex items-center gap-0.5 rounded p-0.5"
      style={{ background: 'var(--iv-line-3)' }}
    >
      <span
        className="absolute bottom-0.5 left-0.5 top-0.5 w-11 rounded"
        style={{ background: 'var(--iv-accent-deep)', transform: `translateX(${k * 46}px)` }}
      />
      {['Classic', 'Custom'].map((label, i) => (
        <span
          key={label}
          className="relative w-11 py-0.5 text-center font-mono text-[0.5rem]"
          style={{ color: (i === 1) === k >= 0.5 ? '#fff' : 'var(--iv-text-3)' }}
        >
          {label}
        </span>
      ))}
    </span>
  );
}

/** A widget in the Custom grid: title, drag grip, body. */
function Widget({ hot = false, children }: { hot?: boolean; children?: ReactNode }) {
  return (
    <Region hot={hot} className="flex h-full flex-col gap-1.5 p-1.5">
      <div className="flex items-center justify-between">
        <Ln w="44%" h={4} c="var(--iv-line-2)" />
        <GripVertical className="h-2.5 w-2.5" style={{ color: 'var(--iv-text-3)' }} />
      </div>
      {children}
    </Region>
  );
}

/** The Classic page, as step 1 left it. */
function ClassicBody() {
  return (
    <div className="flex flex-1 gap-1.5">
      <Region delay={0.22} className="flex flex-[1.5] flex-col gap-1.5 p-2">
        <Ln w="36%" h={4} c="var(--iv-line-2)" />
        {BRIEF.map((w, i) => (
          <Ln key={i} w={w} />
        ))}
      </Region>
      <div className="flex flex-1 flex-col gap-1.5">
        <Watchlist delay={0.32} />
        <Region delay={0.42} className="flex flex-1 flex-col justify-center p-1.5">
          <Spark />
        </Region>
      </div>
    </div>
  );
}

function CustomGrid() {
  const t = useSceneTime();
  const held = t >= CUSTOM.grab;
  const dropped = t >= CUSTOM.drop;
  const swapped = t >= SWAP;
  const added = t >= CUSTOM.add + 120;
  // the chart widget rides with the pointer while held, then settles into
  // its new slot from wherever the pointer let go
  const lift = ease(t, CUSTOM.grab, 160) * (1 - ease(t, CUSTOM.drop, 260));
  const settle = 1 - ease(t, CUSTOM.drop, 260);
  const p = pointAt(CUSTOM_PATH, t);
  const dx = dropped ? (DROP.x - GRAB.x - COL) * settle : held ? p.x - GRAB.x : 0;
  const dy = dropped ? (DROP.y - GRAB.y) * settle : held ? p.y - GRAB.y : 0;
  return (
    <Appear at={CUSTOM.toggle + 80} className="grid flex-1 grid-cols-3 grid-rows-2 gap-1.5">
      <div style={{ gridColumn: 1, gridRow: 1 }}>
        <Widget>
          <Ln w="84%" />
          <Ln w="62%" />
          <Ln w="74%" />
        </Widget>
      </div>
      {/* the slot the held widget will land in */}
      {held && t < CUSTOM.drop + 260 && (
        <Region dashed style={{ gridColumn: swapped ? 3 : 2, gridRow: 1 }} />
      )}
      {/* watchlist: slides one slot left once the chart passes halfway */}
      <div
        style={{
          gridColumn: swapped ? 2 : 3,
          gridRow: 1,
          transform: swapped ? `translateX(${COL * (1 - ease(t, SWAP, 300))}px)` : undefined,
        }}
      >
        <Widget>
          {['var(--iv-teal)', 'var(--iv-red)', 'var(--iv-teal)'].map((c, i) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <Ln w="38%" />
              <Ln w="22%" c={`color-mix(in srgb, ${c} 65%, transparent)`} />
            </div>
          ))}
        </Widget>
      </div>
      {/* the chart widget, carried */}
      <div
        className="relative rounded-lg"
        style={{
          gridColumn: dropped ? 3 : 2,
          gridRow: 1,
          zIndex: held ? 2 : undefined,
          background: held ? HELD_BG : undefined,
          transform: `translate(${dx}px, ${dy}px) rotate(${-2.5 * lift}deg) scale(${1 + 0.03 * lift})`,
        }}
      >
        <Widget hot={held}>
          <Spark className="mt-auto h-6" />
        </Widget>
      </div>
      <div style={{ gridColumn: 1, gridRow: 2 }}>
        <Widget>
          <Ln w="70%" />
          <Ln w="52%" />
        </Widget>
      </div>
      {/* the + tile, and the widget it adds */}
      {added ? (
        <Appear at={CUSTOM.add + 120} pop className="flex" style={{ gridColumn: 2, gridRow: 2 }}>
          <div className="flex-1">
            <Widget>
              <div className="mt-auto flex h-8 items-end gap-1">
                {[44, 70, 52, 86, 64].map((h, i) => (
                  <span
                    key={i}
                    className="intro-bar flex-1 rounded-t-sm"
                    style={{ ...rv(0.15 + i * 0.05), height: `${h}%`, background: 'hsl(var(--primary) / 0.7)' }}
                  />
                ))}
              </div>
            </Widget>
          </div>
        </Appear>
      ) : (
        <AddTile style={{ gridColumn: 2, gridRow: 2 }} />
      )}
      {added && (
        <Appear at={CUSTOM.add + 260} className="flex" style={{ gridColumn: 3, gridRow: 2 }}>
          <AddTile style={{ flex: 1 }} />
        </Appear>
      )}
    </Appear>
  );
}

function AddTile({ style }: { style?: CSSProperties }) {
  return (
    <Region dashed className="flex items-center justify-center gap-1 p-1.5" style={style}>
      <Plus className="h-3 w-3" style={{ color: 'var(--iv-text-3)' }} />
      <Ln w="36%" />
    </Region>
  );
}

function DashboardCustomize() {
  const t = useSceneTime();
  return (
    <div className="relative w-full max-w-[400px]">
      <Frame
        topbar={
          <>
            <Ln w="22%" />
            <ModeToggle at={CUSTOM.toggle} />
          </>
        }
      >
        <div className="flex flex-1 flex-col gap-1.5">
          <TickerStrip />
          {t < CUSTOM.toggle + 80 ? <ClassicBody /> : <CustomGrid />}
        </div>
      </Frame>
      <Cursor path={CUSTOM_PATH} clicks={[CUSTOM.toggle, CUSTOM.add]} />
    </div>
  );
}

/* ── dashboard · step 3: clip a row into chat context ──────────────────── */

/** Clipping a row, played out: the pointer finds the news row's paperclip
    (it shows on hover), clicks, the chip lands in the composer, then a
    question about it is typed and the pointer waits on send. */
const ATTACH = {
  hover: 850,
  click: 1200,
  leave: 1900,
  fly: 1280,
  flyDur: 520,
  focus: 2450,
  type: 2600,
  ask: 'Is this already priced in?',
  length: 5000,
};
const CLIP = { x: 226, y: 70 };
const COMPOSER = { x: 150, y: 287 };
const SEND = { x: 373, y: 303 };
/** The flying chip's top-left: centered on the paperclip, then the composer's chip slot. */
const CHIP_FROM = { x: 194, y: 62 };
const CHIP_TO = { x: 319.5, y: 260 };
const ATTACH_PATH: Waypoint[] = [
  { at: 300, x: 320, y: 200 },
  { at: 1000, ...CLIP },
  { at: ATTACH.leave, ...CLIP },
  { at: 2400, ...COMPOSER },
  { at: 3700, ...COMPOSER },
  { at: 4300, ...SEND },
];

/** The chip that says a row rides along with the next message. */
function AttachedChip() {
  return (
    <span
      className="flex w-fit items-center gap-1 rounded px-1.5 py-0.5"
      style={{ background: 'hsl(var(--primary) / 0.2)' }}
    >
      <Paperclip className="h-2 w-2" style={{ color: 'var(--iv-accent)' }} />
      <span className="font-mono text-[0.5rem]" style={{ color: 'var(--iv-accent)' }}>
        attached
      </span>
    </span>
  );
}

function DashboardAttach() {
  const t = useSceneTime();
  const hovered = t >= ATTACH.hover && t < ATTACH.leave + 150;
  const clipped = t >= ATTACH.click;
  const landed = t >= ATTACH.fly + ATTACH.flyDur;
  const fly = ease(t, ATTACH.fly, ATTACH.flyDur);
  return (
    <div className="relative w-full max-w-[400px]">
      <Frame topbar={<Ln w="30%" />}>
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex flex-1 gap-1.5">
            {/* news widget: the paperclip shows on the hovered row */}
            <Region hot delay={0.12} className="flex flex-[1.5] flex-col gap-1.5 p-2">
              <Ln w="34%" h={4} c="var(--iv-line-2)" />
              <div
                className="-mx-1 flex items-center gap-2 rounded px-1 py-0.5 transition-colors duration-150"
                style={{ background: hovered ? 'var(--iv-line-3)' : 'transparent' }}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Ln w="92%" />
                  <Ln w="64%" />
                </div>
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-[opacity,background-color] duration-150"
                  style={{
                    opacity: hovered || clipped ? 1 : 0,
                    background: clipped ? 'var(--iv-accent-deep)' : 'hsl(var(--primary) / 0.25)',
                  }}
                >
                  <Paperclip
                    className="h-2.5 w-2.5"
                    style={{ color: clipped ? '#fff' : 'var(--iv-accent)' }}
                  />
                </span>
              </div>
              <Ln w="84%" />
              <Ln w="70%" />
            </Region>
            <Watchlist delay={0.24} className="flex-1" />
          </div>
          {/* chat dock: takes the clipped row, then the question */}
          <InputDock
            hot={t >= ATTACH.focus}
            delay={0.36}
            chip={
              /* right-aligned: this scene bleeds off the left edge */
              <span className="ml-auto" style={{ visibility: landed ? 'visible' : 'hidden' }}>
                <AttachedChip />
              </span>
            }
            text={t >= ATTACH.type ? <Typed text={ATTACH.ask} at={ATTACH.type} /> : undefined}
          />
        </div>
      </Frame>
      {/* the chip on its way from the row to the composer */}
      {t >= ATTACH.fly && !landed && (
        <div
          className="pointer-events-none absolute"
          style={{
            left: CHIP_FROM.x + (CHIP_TO.x - CHIP_FROM.x) * fly,
            top: CHIP_FROM.y + (CHIP_TO.y - CHIP_FROM.y) * fly,
            opacity: Math.min(fly * 4, 1),
          }}
        >
          <AttachedChip />
        </div>
      )}
      <Cursor path={ATTACH_PATH} clicks={[ATTACH.click, ATTACH.focus]} />
    </div>
  );
}

export const dashboardScenes = {
  dashboardGrid: { Scene: DashboardGrid, length: GRID.length, anchor: 'left' },
  dashboardCustomize: { Scene: DashboardCustomize, length: CUSTOM.length, anchor: 'right' },
  dashboardAttach: { Scene: DashboardAttach, length: ATTACH.length, anchor: 'right' },
} satisfies Partial<Record<IntroVisualId, IntroScene>>;
