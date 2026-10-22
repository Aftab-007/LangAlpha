import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { progress, useSceneTime } from './clock';
import { Cursor, rv, type Waypoint } from './kit';

/*
 * A camera over a scene's page. The page is drawn once, at its own size, and
 * the scene shows only the part that matters: the camera frames a crop of it
 * and moves between crops on the scene clock, panning and zooming in to the
 * detail a step is about. Text stays sharp at any zoom because the page is
 * DOM, scaled, not a picture of it.
 */
/* eslint-disable react-refresh/only-export-components -- the camera's
   geometry helpers travel with it */

/** The scene's design size; the stage scales it to fit the panel. */
export const VIEW = { width: 400, height: 330 };

/**
 * Where the camera looks once it arrives at `at` ms: the page point (px) at
 * the center of the view, and the zoom. The move into a shot takes `dur` ms
 * and ends at `at`; before it starts, the camera holds the previous shot.
 */
export interface Shot {
  at: number;
  x: number;
  y: number;
  zoom: number;
  dur?: number;
}

/** A rect of the page, in page px. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type View = Pick<Shot, 'x' | 'y' | 'zoom'>;

/** The shot that fits `r` in the view with `pad` px of page around it. */
export function frame(r: Rect, pad = 8, view = VIEW): View {
  return {
    x: r.x + r.w / 2,
    y: r.y + r.h / 2,
    zoom: Math.min(view.width / (r.w + 2 * pad), view.height / (r.h + 2 * pad)),
  };
}

const inOut = (p: number) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2);

/** Where the camera is at `t`. Zoom eases geometrically, so a push-in reads even. */
export function viewAt(shots: Shot[], t: number): View {
  let from: View = shots[0];
  for (let i = 1; i < shots.length; i++) {
    const s = shots[i];
    const dur = s.dur ?? 700;
    if (t < s.at) {
      const p = inOut(progress(t, s.at - dur, dur));
      return {
        x: from.x + (s.x - from.x) * p,
        y: from.y + (s.y - from.y) * p,
        zoom: from.zoom * (s.zoom / from.zoom) ** p,
      };
    }
    from = s;
  }
  return from;
}

/**
 * The view: a window onto `children` (the page, drawn at its own size) as
 * the camera frames it at this moment. `cursor` is in page px and drawn over
 * the view at its true size, so the pointer never zooms with the page.
 */
export function Camera({
  shots,
  cursor,
  clicks,
  view = VIEW,
  className,
  style,
  children,
}: {
  shots: [Shot, ...Shot[]];
  cursor?: Waypoint[];
  clicks?: number[];
  view?: { width: number; height: number };
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const { x, y, zoom } = viewAt(shots, useSceneTime());
  const dx = view.width / 2 - x * zoom;
  const dy = view.height / 2 - y * zoom;
  return (
    <div
      className={cn('intro-mk intro-rv overflow-hidden', className)}
      style={{ ...rv(0), width: view.width, height: view.height, ...style }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ transform: `translate(${dx}px, ${dy}px) scale(${zoom})` }}
      >
        {children}
      </div>
      {cursor && (
        <Cursor
          path={cursor}
          clicks={clicks}
          project={(p) => ({ x: dx + p.x * zoom, y: dy + p.y * zoom })}
        />
      )}
    </div>
  );
}
