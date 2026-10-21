import type { CSSProperties, ReactNode } from 'react';
import { ArrowUp, MousePointer2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { progress, useSceneTime } from './clock';
import '../pageIntro.css';

/*
 * The parts every scene is drawn with: zoomed-out wireframes of the WHOLE
 * page (app rail + topbar + skeleton regions), landing-page blueprint style,
 * plus the pieces that move on the scene clock (typing, streaming lines,
 * running steps, a scripted pointer). All data is invented placeholder.
 */
/* eslint-disable react-refresh/only-export-components -- scene kit: small
   components plus the `rv` style helper */

export const rv = (s: number): CSSProperties => ({ '--rv': `${s}s` } as CSSProperties);

/** Grey skeleton bar standing in for text. */
export function Ln({ w, h = 3, c }: { w: string; h?: number; c?: string }) {
  return (
    <span
      className="block rounded-full"
      style={{ width: w, height: h, background: c ?? 'var(--iv-line)' }}
    />
  );
}

export function Tag({ children, color = 'var(--iv-accent)' }: { children: ReactNode; color?: string }) {
  return (
    <span
      className="w-fit shrink-0 rounded px-1 py-0.5 font-mono text-[0.5rem] leading-none"
      style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}
    >
      {children}
    </span>
  );
}

/** One region of the page wireframe; `hot` = what this step is about. */
export function Region({
  hot = false,
  dashed = false,
  delay,
  className = '',
  style,
  children,
}: {
  hot?: boolean;
  dashed?: boolean;
  delay?: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <div
      className={`intro-region ${hot ? 'intro-region--hot' : ''} ${
        dashed ? 'intro-region--dashed' : ''
      } ${delay != null ? 'intro-rv' : ''} ${className}`}
      style={{ ...(delay != null ? rv(delay) : null), ...style }}
    >
      {children}
    </div>
  );
}

/** The whole-app chrome: icon rail + topbar + content. */
export function Frame({ children, topbar }: { children: ReactNode; topbar?: ReactNode }) {
  return (
    <div className="intro-mk intro-rv w-full max-w-[400px] overflow-hidden" style={rv(0)}>
      <div className="flex">
        {/* icon rail */}
        <div
          className="flex w-7 shrink-0 flex-col items-center gap-2 border-r py-2.5"
          style={{ borderColor: 'var(--iv-border)' }}
        >
          <span className="h-2.5 w-2.5 rounded" style={{ background: 'var(--iv-accent)' }} />
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-2.5 w-2.5 rounded" style={{ background: 'var(--iv-fill)' }} />
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="flex h-7 items-center gap-2 border-b px-2.5"
            style={{ borderColor: 'var(--iv-border)' }}
          >
            {topbar ?? <Ln w="34%" />}
          </div>
          <div className="flex min-h-[300px] flex-col p-2.5">{children}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * The chat input dock: composer line + plus / plan / model / send row.
 * `text` replaces the composer's placeholder line (a `Typed` while the user
 * writes); the send button presses at each time in `sendAt`.
 */
export function InputDock({
  hot = false,
  delay,
  chip,
  text,
  sendAt,
}: {
  hot?: boolean;
  delay?: number;
  chip?: ReactNode;
  text?: ReactNode;
  sendAt?: number[];
}) {
  const t = useSceneTime();
  const pressed = sendAt?.some((at) => t >= at && t < at + 260) ?? false;
  return (
    <Region hot={hot} delay={delay} className="mt-auto flex flex-col gap-1.5 p-1.5">
      {chip}
      <div className="flex h-2 items-center">
        {text == null ? (
          <Ln w="46%" c="var(--iv-line-3)" />
        ) : (
          <span
            className="truncate font-mono text-[0.5rem] leading-none"
            style={{ color: 'var(--iv-text)' }}
          >
            {text}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <Plus className="h-2.5 w-2.5 shrink-0" style={{ color: 'var(--iv-text-3)' }} />
        <span className="font-mono text-[0.5rem]" style={{ color: 'var(--iv-text-3)' }}>
          plan
        </span>
        <span className="ml-auto">
          <Ln w="30px" h={3} c="var(--iv-line-3)" />
        </span>
        <span
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-transform duration-150"
          style={{ background: 'var(--iv-accent-deep)', transform: pressed ? 'scale(0.8)' : undefined }}
        >
          <ArrowUp className="h-2 w-2 text-white" />
        </span>
      </div>
    </Region>
  );
}

/* ── moving parts, all driven by the scene clock ───────────────────────── */

/**
 * Mounts its children once the script reaches `at` ms; they enter with the
 * reveal, or scale in with `pop`. `reserve` holds their space until then, for
 * layouts that should not shift.
 */
export function Appear({
  at,
  pop = false,
  reserve = false,
  className,
  style,
  children,
}: {
  at: number;
  pop?: boolean;
  reserve?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const shown = useSceneTime() >= at;
  if (!shown && !reserve) return null;
  return (
    <div
      className={cn(shown && (pop ? 'intro-pop' : 'intro-rv'), className)}
      style={{ ...rv(0), ...style, ...(shown ? null : { visibility: 'hidden' }) }}
    >
      {children}
    </div>
  );
}

/** A blinking text caret. */
export function Caret() {
  return <span className="intro-caret" aria-hidden />;
}

/** `text` typed out from `at`, `cps` characters a second, caret at the end while it types. */
export function Typed({ text, at, cps = 32 }: { text: string; at: number; cps?: number }) {
  const t = useSceneTime();
  const n = Math.min(Math.max(Math.floor(((t - at) * cps) / 1000), 0), text.length);
  return (
    <>
      {text.slice(0, n)}
      {t >= at && n < text.length && <Caret />}
    </>
  );
}

/** A skeleton line written out over `[at, at + dur]`, the way a reply streams in. */
export function StreamLn({
  w,
  at,
  dur = 420,
  h = 3,
  c,
}: {
  w: string;
  at: number;
  dur?: number;
  h?: number;
  c?: string;
}) {
  const p = progress(useSceneTime(), at, dur);
  if (p === 0) return null;
  return (
    <span
      className="intro-stream block rounded-full"
      style={{ width: `calc(${w} * ${p})`, height: h, background: c ?? 'var(--iv-line)' }}
    />
  );
}

/** Lines streamed one after another from `at`, `per` ms each: a reply being written. */
export function StreamBlock({
  widths,
  at,
  per = 320,
  c,
}: {
  widths: string[];
  at: number;
  per?: number;
  c?: string;
}) {
  return (
    <>
      {widths.map((w, i) => (
        <StreamLn key={i} w={w} at={at + i * per} dur={per} c={c} />
      ))}
    </>
  );
}

/** A step's status: nothing before `at`, a spinner while it runs, a check from `done`. */
export function Working({ at, done }: { at: number; done: number }) {
  const t = useSceneTime();
  if (t < at) return null;
  if (t < done) return <span className="intro-spin" aria-hidden />;
  return (
    <span
      className="intro-pop font-mono text-[0.4375rem] leading-none"
      style={{ ...rv(0), color: 'var(--iv-teal)' }}
    >
      ✓
    </span>
  );
}

/** The user's message, right-aligned in the chat column. */
export function UserBubble({
  at,
  className,
  children,
}: {
  at: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Appear at={at} className={cn('flex justify-end', className)}>
      <div
        className="rounded-md rounded-br-sm px-1.5 py-1"
        style={{ background: 'hsl(var(--primary) / 0.22)' }}
      >
        <span
          className="block font-mono text-[0.5rem] leading-none"
          style={{ color: 'var(--iv-text)' }}
        >
          {children}
        </span>
      </div>
    </Appear>
  );
}

/** One waypoint of a scripted pointer: where it is (px in the 400px scene) at `at` ms. */
export interface Waypoint {
  at: number;
  x: number;
  y: number;
}

/** Where a pointer on `path` is at `t`, so whatever it carries rides along. */
export function pointAt(path: Waypoint[], t: number): { x: number; y: number } {
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (t < b.at) {
      const p = progress(t, a.at, b.at - a.at);
      const e = p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2;
      return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e };
    }
  }
  const { x, y } = path[path.length - 1];
  return { x, y };
}

/**
 * A pointer gliding between waypoints, with a ripple at each click. Place it
 * inside a `relative` box whose origin the waypoints are measured from.
 */
export function Cursor({ path, clicks = [] }: { path: Waypoint[]; clicks?: number[] }) {
  const t = useSceneTime();
  if (path.length === 0 || t < path[0].at) return null;
  const { x, y } = pointAt(path, t);
  const pressed = clicks.some((c) => t >= c && t < c + 160);
  return (
    <div className="pointer-events-none absolute z-10" style={{ left: x, top: y }}>
      {clicks
        .filter((c) => t >= c && t < c + 600)
        .map((c) => (
          <span key={c} className="intro-click absolute -left-3 -top-3 h-6 w-6" style={rv(0)} />
        ))}
      <span
        className="block transition-transform duration-100"
        style={{ transform: pressed ? 'scale(0.82)' : undefined, transformOrigin: 'top left' }}
      >
        <MousePointer2
          className="intro-rv h-3 w-3"
          style={{ ...rv(0), color: 'var(--iv-text)', fill: 'currentColor' }}
        />
      </span>
    </div>
  );
}
