import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, Mic, MousePointer2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { progress, useSceneTime } from './clock';
import '../pageIntro.css';

/*
 * The parts every scene is drawn with: the page's cards and composer in the
 * app's own surfaces and type, plus the pieces that move on the scene clock
 * (typing, running steps, a scripted pointer). A scene draws its page at its
 * own size and a `Camera` shows the part a step is about. All data is
 * invented placeholder.
 */
/* eslint-disable react-refresh/only-export-components -- scene kit: small
   components plus the `rv` style helper */

export const rv = (s: number): CSSProperties => ({ '--rv': `${s}s` }) as CSSProperties;

/** Grey skeleton bar standing in for text. */
export function Ln({ w, h = 3, c }: { w: string; h?: number; c?: string }) {
  return (
    <span
      className="block rounded-full"
      style={{ width: w, height: h, background: c ?? 'var(--iv-line)' }}
    />
  );
}

/** A small label chip, as the app draws tags: a solid chip, colored text. */
export function Tag({
  children,
  color = 'var(--iv-text-2)',
}: {
  children: ReactNode;
  color?: string;
}) {
  return (
    <span
      className="w-fit shrink-0 rounded px-1 py-0.5 text-[0.5rem] font-medium leading-none"
      style={{ background: 'var(--color-bg-tag)', color }}
    >
      {children}
    </span>
  );
}

/** A card on the page; `active` = in use (held, say). */
export function Region({
  active = false,
  dashed = false,
  delay,
  className = '',
  style,
  children,
}: {
  active?: boolean;
  dashed?: boolean;
  delay?: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <div
      className={`intro-region ${active ? 'intro-region--active' : ''} ${
        dashed ? 'intro-region--dashed' : ''
      } ${delay != null ? 'intro-rv' : ''} ${className}`}
      style={{ ...(delay != null ? rv(delay) : null), ...style }}
    >
      {children}
    </div>
  );
}

/**
 * The chat composer, as the app draws it: a rounded card with the text on
 * top and attach / model / mic / send below. `text` replaces the placeholder
 * (a `Typed` while the user writes); `focused` gives it the accent edge
 * the real one takes on focus; the send button fills once there is text and
 * presses at each time in `sendAt`.
 */
export function InputDock({
  focused = false,
  delay,
  chip,
  text,
  sendAt,
}: {
  focused?: boolean;
  delay?: number;
  chip?: ReactNode;
  text?: ReactNode;
  sendAt?: number[];
}) {
  const { t: tr } = useTranslation();
  const t = useSceneTime();
  const pressed = sendAt?.some((at) => t >= at && t < at + 260) ?? false;
  const filled = text != null;
  return (
    <div
      className={cn(
        'mt-auto flex flex-col gap-1.5 rounded-[11px] border p-1.5',
        delay != null && 'intro-rv'
      )}
      style={{
        ...(delay != null ? rv(delay) : null),
        background: 'var(--color-bg-card)',
        borderColor: focused ? 'var(--color-accent-primary)' : 'var(--color-border-input)',
      }}
    >
      {chip}
      <div className="flex h-2 items-center px-0.5">
        {text == null ? (
          <span
            className="truncate text-[0.5rem] leading-none"
            style={{ color: 'var(--iv-text-3)' }}
          >
            {tr('chat.placeholderDefault')}
          </span>
        ) : (
          <span className="truncate text-[0.5rem] leading-none" style={{ color: 'var(--iv-text)' }}>
            {text}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <Plus className="h-2.5 w-2.5 shrink-0" style={{ color: 'var(--color-icon-muted)' }} />
        <span className="ml-auto">
          <Ln w="30px" h={3} c="var(--iv-line-2)" />
        </span>
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

const LOADER_FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';

/** The app's `Loader`: a braille glyph stepping every 80ms on the scene
    clock, at the surrounding text size. */
export function Loader({
  color = 'currentColor',
  className,
}: {
  color?: string;
  className?: string;
}) {
  const t = useSceneTime();
  const frame = Number.isFinite(t) ? Math.floor(t / 80) % LOADER_FRAMES.length : 0;
  return (
    <span
      className={cn('shrink-0 font-mono leading-none', className)}
      style={{ color }}
      aria-hidden
    >
      {LOADER_FRAMES[frame]}
    </span>
  );
}

/** The user's message, right-aligned in the chat column. A message nobody
    typed here carries its `caption` above it, naming who sent it. */
export function UserBubble({
  at,
  caption,
  className,
  children,
}: {
  at: number;
  caption?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Appear at={at} className={cn('flex flex-col items-end gap-1', className)}>
      {caption}
      <div className="rounded-md px-1.5 py-1" style={{ background: 'var(--color-bg-elevated)' }}>
        <span className="block text-[0.5rem] leading-none" style={{ color: 'var(--iv-text)' }}>
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
 * A pointer gliding between waypoints, pressing at each click. Outlined in
 * the page color, as a system pointer is, so it stays visible over a button
 * of its own color. Place it inside a `relative` box whose origin the
 * waypoints are measured from.
 */
export function Cursor({
  path,
  clicks = [],
  project,
}: {
  path: Waypoint[];
  clicks?: number[];
  /** Maps a waypoint to where it shows, for a pointer over a moving camera. */
  project?: (p: { x: number; y: number }) => { x: number; y: number };
}) {
  const t = useSceneTime();
  if (path.length === 0 || t < path[0].at) return null;
  const at = pointAt(path, t);
  const { x, y } = project ? project(at) : at;
  const pressed = clicks.some((c) => t >= c && t < c + 160);
  return (
    <div className="pointer-events-none absolute z-10" style={{ left: x, top: y }}>
      <span
        className="block transition-transform duration-100"
        style={{ transform: pressed ? 'scale(0.82)' : undefined, transformOrigin: 'top left' }}
      >
        <MousePointer2
          className="intro-rv h-3 w-3"
          strokeWidth={1.5}
          style={{ ...rv(0), color: 'var(--color-bg-page)', fill: 'var(--iv-text)' }}
        />
      </span>
    </div>
  );
}
